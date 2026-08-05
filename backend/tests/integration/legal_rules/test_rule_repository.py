"""LR004/LR005 — integration test: the `Rule` aggregate persists and
reloads correctly through the imperative ORM mapping + `RuleRepository`,
against a REAL PostgreSQL (migrations 0001-0005 applied). Not mocked —
this is the actual proof that `registry.map_imperatively()` (SQLAlchemy 2)
plus the `_ScopeType`/`_OpaqueJsonType` TypeDecorators round-trip the
domain's Value Objects correctly through jsonb columns.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    async_sessionmaker,
    create_async_engine,
)

from src.composition.settings import get_settings
from src.modules.legal_rules.domain.errors import RuleVersionImmutableError
from src.modules.legal_rules.domain.rule import Rule
from src.modules.legal_rules.domain.value_objects import LegalBasis, RuleCategory, RuleStatus, Scope
from src.modules.legal_rules.infrastructure.write.orm_mapping import start_mappers
from src.modules.legal_rules.infrastructure.write.rule_repository import RuleRepository

pytestmark = pytest.mark.asyncio

# start_mappers() must run exactly once per process (see orm_mapping.py
# docstring) — module import time is the right place, mirroring how
# Composition Root would call it once at app startup.
try:
    start_mappers()
except Exception:  # noqa: BLE001 — already-mapped is fine if pytest re-imports this module
    pass


async def _db_reachable() -> bool:
    try:
        engine = create_async_engine(get_settings().database_dsn)
        async with engine.connect():
            pass
        await engine.dispose()
        return True
    except (OperationalError, OSError):
        # OSError matters: asyncpg raises a bare ConnectionRefusedError when the
        # port is closed, and SQLAlchemy does not wrap OS-level errors in
        # OperationalError — catching only the latter made this check a no-op
        # in exactly the case it exists for. See tests/integration/conftest.py.
        return False


@pytest.fixture
async def engine() -> AsyncEngine:  # type: ignore[misc]
    if not await _db_reachable():
        pytest.skip(
            "PostgreSQL not reachable — start it with `make up` first (see docker-compose.yml)"
        )
    eng = create_async_engine(get_settings().database_dsn)
    yield eng
    await eng.dispose()


@pytest.fixture
async def legal_basis_node_id(engine: AsyncEngine) -> object:
    """Seeds one normative_document + document_node so rule_version's FK
    (`legal_basis_node_id`) has somewhere real to point.

    Must actually COMMIT: the test body opens its own separate session/
    connection (via `async_sessionmaker`), which — under normal read-
    committed isolation — cannot see rows from another connection's
    still-open, uncommitted transaction. An earlier version of this
    fixture used `engine.begin()` + rollback-after-yield and the seeded
    row was invisible to the test, failing with a FK violation. Cleaned up
    explicitly afterwards instead.
    """
    async with engine.begin() as conn:
        doc_id = await conn.scalar(
            text("""
                INSERT INTO legal_rules.normative_document
                    (doc_type, reg_number, adopted_date, title, valid_from)
                VALUES ('federal_law', :reg, '2016-05-23', 'test doc', '2016-05-23')
                RETURNING id
            """),
            {"reg": f"TEST-{uuid4()}"},
        )
        node_id = await conn.scalar(
            text("""
                INSERT INTO legal_rules.document_node (document_id, node_type, ordinal_number)
                VALUES (:doc_id, 'article', '1')
                RETURNING id
            """),
            {"doc_id": doc_id},
        )

    yield node_id

    async with engine.begin() as conn:
        await conn.execute(
            text("DELETE FROM legal_rules.document_node WHERE id = :id"), {"id": node_id}
        )
        await conn.execute(
            text("DELETE FROM legal_rules.normative_document WHERE id = :id"), {"id": doc_id}
        )


async def test_round_trips_a_published_rule_version(
    engine: AsyncEngine, legal_basis_node_id: object
) -> None:
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    rule_id = uuid4()
    scope = Scope.from_dict({"category": "hazardous"})

    async with session_factory() as session:
        rule = Rule(
            id=rule_id,
            code=f"TEST.ROUNDTRIP.{uuid4()}",
            category=RuleCategory.NORM_CALCULATION,
            display_name="Test rule",
            description="A rule for round-trip testing",
        )
        version = rule.draft_new_version(
            scope=scope,
            legal_basis=LegalBasis(node_id=legal_basis_node_id),  # type: ignore[arg-type]
            formula_definition=[
                {
                    "node_type": "set_result",
                    "field": "weekly_norm_hours",
                    "formula": {"node_type": "literal", "value": 36},
                }
            ],
            valid_from=date(2024, 1, 1),
        )
        rule.publish_version(version.id, published_by=uuid4(), now=datetime.now(UTC))

        repo = RuleRepository(session)
        repo.add(rule)
        await session.commit()

    # Fresh session, fresh identity map — this is a REAL reload, not the
    # same Python object handed back.
    async with session_factory() as session:
        repo = RuleRepository(session)
        loaded = await repo.get(rule_id)

        assert loaded is not None
        assert loaded.code.startswith("TEST.ROUNDTRIP.")
        assert loaded.description == "A rule for round-trip testing"
        assert len(loaded.versions) == 1

        loaded_version = loaded.versions[0]
        assert loaded_version.status == RuleStatus.PUBLISHED
        assert loaded_version.scope == scope  # Scope VO round-trips through jsonb correctly
        assert loaded_version.legal_basis.node_id == legal_basis_node_id
        assert loaded_version.formula_definition[0]["field"] == "weekly_norm_hours"
        assert loaded_version.valid_from == date(2024, 1, 1)

        # The immutability guard must still hold on an object reloaded
        # from the DB, not just on one built fresh in memory this process.
        with pytest.raises(RuleVersionImmutableError):
            loaded_version.formula_definition = {"tampered": True}

    async with engine.begin() as conn:
        await conn.execute(
            text("DELETE FROM legal_rules.rule_version WHERE rule_id = :id"), {"id": rule_id}
        )
        await conn.execute(text("DELETE FROM legal_rules.rule WHERE id = :id"), {"id": rule_id})


async def test_get_by_code_finds_the_rule(engine: AsyncEngine, legal_basis_node_id: object) -> None:
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    code = f"TEST.BYCODE.{uuid4()}"
    rule_id = uuid4()

    async with session_factory() as session:
        rule = Rule(id=rule_id, code=code, category=RuleCategory.NORM_CALCULATION, display_name="x")
        RuleRepository(session).add(rule)
        await session.commit()

    async with session_factory() as session:
        found = await RuleRepository(session).get_by_code(code)
        assert found is not None
        assert found.id == rule_id

        missing = await RuleRepository(session).get_by_code("NO.SUCH.CODE")
        assert missing is None

    async with engine.begin() as conn:
        await conn.execute(text("DELETE FROM legal_rules.rule WHERE id = :id"), {"id": rule_id})
