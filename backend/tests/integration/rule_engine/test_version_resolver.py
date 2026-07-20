"""RE015 — integration tests for `version_resolver.resolve_effective_version`
against a REAL PostgreSQL (not mocked): requires the DB from
`docker-compose.yml` migrated to head (`alembic upgrade head`).

Run with:
    FPS_DATABASE_DSN=postgresql+asyncpg://fps:fps@localhost:5432/fps_timekeeping \\
    pytest tests/integration -v

Skipped automatically if the DB isn't reachable, so `pytest tests/unit`
(no DB) stays the fast default and CI's `pytest tests/unit` step is
unaffected — this file is deliberately NOT under tests/unit/.
"""

from __future__ import annotations

import json
from datetime import date
from uuid import uuid4

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from src.composition.settings import get_settings
from src.rule_engine.interpreter.version_resolver import (
    NoApplicableRuleVersionError,
    resolve_effective_version,
)

pytestmark = pytest.mark.asyncio


async def _db_reachable() -> bool:
    try:
        engine = create_async_engine(get_settings().database_dsn)
        async with engine.connect():
            pass
        await engine.dispose()
        return True
    except OperationalError:
        return False


@pytest.fixture
async def connection() -> AsyncConnection:  # type: ignore[misc]
    if not await _db_reachable():
        pytest.skip(
            "PostgreSQL not reachable — start it with `make up` first (see docker-compose.yml)"
        )
    engine = create_async_engine(get_settings().database_dsn)
    async with engine.connect() as conn:
        # Every test runs in its own rolled-back transaction — no fixture
        # ever needs cleanup, and tests never see each other's rows even
        # though they share the same migrated database.
        trans = await conn.begin()
        yield conn
        await trans.rollback()
    await engine.dispose()


async def _seed_rule_version(
    connection: AsyncConnection,
    *,
    rule_code: str,
    scope: dict[str, str],
    valid_from: date,
    valid_to: date | None,
    status: str,
    actions: list[dict[str, object]],
) -> None:
    """Minimal seed helper: one normative_document + one document_node +
    one rule, reused across the module's rule_versions by rule_code."""
    from sqlalchemy import text

    doc_id = await connection.scalar(
        text("""
            INSERT INTO legal_rules.normative_document
                (doc_type, reg_number, adopted_date, title, valid_from)
            VALUES ('federal_law', :reg, '2016-05-23', 'test doc', '2016-05-23')
            RETURNING id
        """),
        {"reg": f"TEST-{uuid4()}"},
    )
    node_id = await connection.scalar(
        text("""
            INSERT INTO legal_rules.document_node (document_id, node_type, ordinal_number)
            VALUES (:doc_id, 'article', '1')
            RETURNING id
        """),
        {"doc_id": doc_id},
    )
    rule_id = await connection.scalar(
        text("""
            INSERT INTO legal_rules.rule (code, category, display_name)
            VALUES (:code, 'norm_calculation', 'test rule')
            ON CONFLICT (code) DO UPDATE SET display_name = EXCLUDED.display_name
            RETURNING id
        """),
        {"code": rule_code},
    )
    published_at = "now()" if status != "draft" else "NULL"
    await connection.execute(
        text(f"""
            INSERT INTO legal_rules.rule_version
                (rule_id, version_no, scope, legal_basis_node_id, formula_definition,
                 valid_from, valid_to, status, published_at)
            VALUES
                (:rule_id, :version_no, CAST(:scope AS jsonb), :node_id, CAST(:actions AS jsonb),
                 :valid_from, :valid_to, :status, {published_at})
        """),
        {
            "rule_id": rule_id,
            "version_no": int(uuid4().int % 100000),  # unique enough within a rolled-back test txn
            "scope": json.dumps(scope),
            "node_id": node_id,
            "actions": json.dumps(actions),
            "valid_from": valid_from,
            "valid_to": valid_to,
            "status": status,
        },
    )


LITERAL_40_ACTION = [
    {
        "node_type": "set_result",
        "field": "weekly_norm_hours",
        "formula": {"node_type": "literal", "value": 40},
    }
]


async def test_resolves_published_version_covering_the_date(connection: AsyncConnection) -> None:
    rule_code = f"TEST.NORM.{uuid4()}"
    await _seed_rule_version(
        connection,
        rule_code=rule_code,
        scope={"category": "normal"},
        valid_from=date(2024, 1, 1),
        valid_to=date(2025, 1, 1),
        status="published",
        actions=LITERAL_40_ACTION,
    )

    resolved = await resolve_effective_version(
        connection, rule_code=rule_code, scope={"category": "normal"}, as_of=date(2024, 6, 1)
    )

    assert resolved.actions[0].field == "weekly_norm_hours"  # type: ignore[union-attr]
    assert resolved.actions[0].formula.value == 40  # type: ignore[union-attr]


async def test_raises_when_no_version_covers_the_date(connection: AsyncConnection) -> None:
    rule_code = f"TEST.NORM.{uuid4()}"
    await _seed_rule_version(
        connection,
        rule_code=rule_code,
        scope={"category": "normal"},
        valid_from=date(2024, 1, 1),
        valid_to=date(2025, 1, 1),
        status="published",
        actions=LITERAL_40_ACTION,
    )

    with pytest.raises(NoApplicableRuleVersionError):
        await resolve_effective_version(
            connection, rule_code=rule_code, scope={"category": "normal"}, as_of=date(2026, 1, 1)
        )


async def test_draft_versions_are_never_resolved(connection: AsyncConnection) -> None:
    """Domain Model 2.2.1 only governs published/superseded versions —
    a draft must never be picked up even if its period covers as_of."""
    rule_code = f"TEST.NORM.{uuid4()}"
    await _seed_rule_version(
        connection,
        rule_code=rule_code,
        scope={"category": "normal"},
        valid_from=date(2024, 1, 1),
        valid_to=None,
        status="draft",
        actions=LITERAL_40_ACTION,
    )

    with pytest.raises(NoApplicableRuleVersionError):
        await resolve_effective_version(
            connection, rule_code=rule_code, scope={"category": "normal"}, as_of=date(2024, 6, 1)
        )


async def test_superseded_version_still_resolves_for_a_past_date(
    connection: AsyncConnection,
) -> None:
    """Calculation Engine Алгоритм М (retroactive recalculation): a
    superseded version must remain resolvable for dates within its own
    (now-closed) validity window — that's the entire point of versioning."""
    rule_code = f"TEST.NORM.{uuid4()}"
    old_action = [
        {
            "node_type": "set_result",
            "field": "weekly_norm_hours",
            "formula": {"node_type": "literal", "value": 36},
        }
    ]
    await _seed_rule_version(
        connection,
        rule_code=rule_code,
        scope={"category": "normal"},
        valid_from=date(2020, 1, 1),
        valid_to=date(2024, 1, 1),
        status="superseded",
        actions=old_action,
    )
    await _seed_rule_version(
        connection,
        rule_code=rule_code,
        scope={"category": "normal"},
        valid_from=date(2024, 1, 1),
        valid_to=None,
        status="published",
        actions=LITERAL_40_ACTION,
    )

    resolved_past = await resolve_effective_version(
        connection, rule_code=rule_code, scope={"category": "normal"}, as_of=date(2022, 1, 1)
    )
    resolved_now = await resolve_effective_version(
        connection, rule_code=rule_code, scope={"category": "normal"}, as_of=date(2025, 1, 1)
    )

    assert resolved_past.actions[0].formula.value == 36  # type: ignore[union-attr]
    assert resolved_now.actions[0].formula.value == 40  # type: ignore[union-attr]


async def test_scope_is_matched_exactly_not_by_prefix(connection: AsyncConnection) -> None:
    """A rule_version scoped to {"category": "hazardous"} must not be
    picked up when the caller asks for {"category": "normal"}, even though
    both are 'the same rule_code' — scope is part of the lookup key
    (Domain Model 2.2.1: "для одной и той же комбинации (RuleCategory,
    Scope)")."""
    rule_code = f"TEST.NORM.{uuid4()}"
    await _seed_rule_version(
        connection,
        rule_code=rule_code,
        scope={"category": "hazardous"},
        valid_from=date(2024, 1, 1),
        valid_to=None,
        status="published",
        actions=LITERAL_40_ACTION,
    )

    with pytest.raises(NoApplicableRuleVersionError):
        await resolve_effective_version(
            connection, rule_code=rule_code, scope={"category": "normal"}, as_of=date(2024, 6, 1)
        )
