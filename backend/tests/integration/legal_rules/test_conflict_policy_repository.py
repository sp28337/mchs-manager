"""Integration test: `ConflictResolutionPolicy` persists and reloads
correctly through the imperative ORM mapping, against a REAL PostgreSQL —
proves `_PrecedenceListType` (jsonb array <-> tuple[RuleCategory, ...])
round-trips in the correct order (a precedence list is ordered, not a set)."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from src.composition.settings import get_settings
from src.modules.legal_rules.domain.conflict_policy import ConflictResolutionPolicy
from src.modules.legal_rules.domain.errors import PolicyVersionImmutableError
from src.modules.legal_rules.domain.value_objects import HourCategory, RuleStatus
from src.modules.legal_rules.infrastructure.write.orm_mapping import start_mappers

pytestmark = pytest.mark.asyncio

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


async def test_precedence_list_round_trips_in_order(engine: AsyncEngine) -> None:
    from datetime import date

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    policy_id = uuid4()
    ordered = (
        HourCategory.HOLIDAY,
        HourCategory.NIGHT,
        HourCategory.OVERTIME,
    )

    async with session_factory() as session:
        policy = ConflictResolutionPolicy(id=policy_id, code=f"TEST-{uuid4()}")
        version = policy.draft_new_version(precedence_list=ordered, valid_from=date(2024, 1, 1))
        policy.publish_version(version.id, now=datetime.now(UTC))
        session.add(policy)
        await session.commit()

    async with session_factory() as session:
        loaded = await session.get(ConflictResolutionPolicy, policy_id)
        assert loaded is not None
        assert len(loaded.versions) == 1
        loaded_version = loaded.versions[0]

        # Order matters — this is a PRECEDENCE list, not a set. A naive
        # jsonb array <-> set round-trip would silently scramble it.
        assert loaded_version.precedence_list == ordered
        assert loaded_version.status == RuleStatus.PUBLISHED

        with pytest.raises(PolicyVersionImmutableError):
            loaded_version.precedence_list = (HourCategory.NIGHT,)

    async with engine.begin() as conn:
        await conn.execute(
            text(
                "DELETE FROM legal_rules.conflict_resolution_policy_version WHERE policy_id = :id"
            ),
            {"id": policy_id},
        )
        await conn.execute(
            text("DELETE FROM legal_rules.conflict_resolution_policy WHERE id = :id"),
            {"id": policy_id},
        )
