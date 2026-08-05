"""PE004/PE005 — round-trip integration tests for the `personnel` Data
Mapper and repositories against a REAL PostgreSQL.

Skips (rather than fails) when Postgres is unreachable, matching every
other integration test in this suite — `make up` starts it.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, InternalError, OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.composition.settings import get_settings
from src.modules.personnel.domain.employee import Employee
from src.modules.personnel.domain.position import Position
from src.modules.personnel.domain.unit import Unit
from src.modules.personnel.domain.value_objects import (
    EmploymentStatus,
    LegalBase,
    PositionCategory,
    RegimeType,
    ServiceConditionCategory,
)
from src.modules.personnel.infrastructure.orm_mapping import start_mappers
from src.modules.personnel.infrastructure.repositories import (
    EmployeeRepository,
    PositionRepository,
    UnitRepository,
)

pytestmark = pytest.mark.asyncio

NOW = datetime.now(UTC)

start_mappers()


@pytest.fixture
async def session():  # type: ignore[misc]
    engine = create_async_engine(get_settings().database_dsn)
    try:
        async with engine.connect():
            pass
    except OperationalError:
        await engine.dispose()
        pytest.skip("PostgreSQL not reachable — start it with `make up` first")

    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db_session:
        yield db_session
    await engine.dispose()


async def _seed_position(session, code_suffix: str) -> Position:  # type: ignore[no-untyped-def]
    position = Position.create(
        code=f"POS.{code_suffix}",
        title="Начальник караула",
        category=PositionCategory.OPERATIONAL,
        default_regime_type=RegimeType.TWENTY_FOUR_HOUR_DUTY,
    )
    PositionRepository(session).add(position)
    await session.commit()
    return position


async def _seed_unit(session, code_suffix: str) -> Unit:  # type: ignore[no-untyped-def]
    unit = Unit.create_root(code=f"UNIT.{code_suffix}", name="ПЧ-тест")
    UnitRepository(session).add(unit)
    await session.commit()
    return unit


# ------------------------------------------------------------------- Unit


async def test_unit_round_trip_preserves_the_ltree_path(session) -> None:  # type: ignore[no-untyped-def]
    """The `ltree` column crosses the wire as text in both directions
    (`orm_mapping._HierarchyPathType`) — this is what proves it."""
    repo = UnitRepository(session)
    root = Unit.create_root(code=f"ROOT.{uuid4().hex[:8]}", name="МЧС России")
    child = Unit.create_child(code=f"CHILD.{uuid4().hex[:8]}", name="Центральный РЦ", parent=root)
    repo.add(root)
    repo.add(child)
    await session.commit()
    session.expunge_all()

    loaded = await repo.get(child.id)
    assert loaded is not None
    assert loaded.hierarchy_path == child.hierarchy_path
    assert loaded.hierarchy_path.depth == 2
    assert loaded.parent_unit_id == root.id


async def test_list_subtree_returns_the_whole_branch(session) -> None:  # type: ignore[no-untyped-def]
    repo = UnitRepository(session)
    root = Unit.create_root(code=f"ROOT.{uuid4().hex[:8]}", name="МЧС России")
    region = Unit.create_child(code=f"RC.{uuid4().hex[:8]}", name="РЦ", parent=root)
    station = Unit.create_child(code=f"PCH.{uuid4().hex[:8]}", name="ПЧ", parent=region)
    other = Unit.create_child(code=f"OTHER.{uuid4().hex[:8]}", name="Другой РЦ", parent=root)
    for unit in (root, region, station, other):
        repo.add(unit)
    await session.commit()
    session.expunge_all()

    subtree_ids = {u.id for u in await repo.list_subtree(region.id)}
    assert subtree_ids == {region.id, station.id}, "ltree `<@` includes self, excludes siblings"


async def test_subtree_query_uses_the_gist_index(session) -> None:  # type: ignore[no-untyped-def]
    """DB008's DoD verbatim: "Запрос по ltree-иерархии использует
    gist-индекс (EXPLAIN)".

    Planner choice is cost-based, so on a nearly-empty table a sequential
    scan is genuinely cheaper and would be the correct plan. `SET LOCAL
    enable_seqscan = off` asks the planner whether it CAN use the index —
    which is the property the migration is responsible for — instead of
    asserting it always will.
    """
    root = await _seed_unit(session, uuid4().hex[:8])
    await session.execute(text("SET LOCAL enable_seqscan = off"))
    plan = await session.execute(
        text(
            "EXPLAIN SELECT id FROM personnel.unit "
            "WHERE hierarchy_path <@ CAST(:path AS ltree)"
        ),
        {"path": root.hierarchy_path.as_ltree()},
    )
    plan_text = "\n".join(row[0] for row in plan)
    assert "ix_unit_hierarchy_gist" in plan_text, plan_text


async def test_root_path_check_constraint_rejects_a_mismatched_depth(session) -> None:  # type: ignore[no-untyped-def]
    """`ck_unit_root_path` (migration 0006) ties `parent_unit_id` and
    `nlevel(hierarchy_path)` together. The domain cannot produce a
    violating pair, so this goes around it via raw SQL — the point is that
    the DB refuses independently."""
    with pytest.raises(IntegrityError):
        await session.execute(
            text(
                "INSERT INTO personnel.unit (id, code, name, parent_unit_id, hierarchy_path) "
                "VALUES (gen_random_uuid(), :code, 'bad', NULL, CAST('a.b' AS ltree))"
            ),
            {"code": f"BAD.{uuid4().hex[:8]}"},
        )
    await session.rollback()


# --------------------------------------------------------------- Position


async def test_position_round_trip(session) -> None:  # type: ignore[no-untyped-def]
    """Also proves the reserved-word table name `personnel."position"` is
    quoted correctly by SQLAlchemy (see `orm_mapping` docstring)."""
    repo = PositionRepository(session)
    position = await _seed_position(session, uuid4().hex[:8])
    session.expunge_all()

    loaded = await repo.get(position.id)
    assert loaded is not None
    assert loaded.code == position.code
    assert loaded.category == PositionCategory.OPERATIONAL
    assert loaded.default_regime_type == RegimeType.TWENTY_FOUR_HOUR_DUTY
    assert await repo.get_by_code(position.code) is not None


# --------------------------------------------------------------- Employee


async def _register(session, *, personnel_number: str) -> Employee:  # type: ignore[no-untyped-def]
    position = await _seed_position(session, uuid4().hex[:8])
    unit = await _seed_unit(session, uuid4().hex[:8])
    employee = Employee.register(
        personnel_number=personnel_number,
        full_name="Иванов Иван Иванович",
        rank="майор внутренней службы",
        legal_base=LegalBase.FPS_SERVICE,
        service_condition_category=ServiceConditionCategory.HAZARDOUS_OR_DANGEROUS,
        position_id=position.id,
        unit_id=unit.id,
        hired_at=date(2020, 3, 1),
        now=NOW,
    )
    EmployeeRepository(session).add(employee)
    await session.commit()
    return employee


async def test_employee_round_trip_brings_the_service_record_with_it(session) -> None:  # type: ignore[no-untyped-def]
    """The aggregate is loaded whole — `change_employment_status()` appends
    to this history and cannot run against a partially-loaded root."""
    employee = await _register(session, personnel_number=str(uuid4().int)[:9])
    session.expunge_all()

    loaded = await EmployeeRepository(session).get(employee.id)
    assert loaded is not None
    assert loaded.personnel_number == employee.personnel_number
    assert loaded.employment_status == EmploymentStatus.ACTIVE
    assert len(loaded.service_record) == 1
    assert loaded.service_record[0].effective_date == date(2020, 3, 1)


async def test_dismissal_persists_status_and_date_together(session) -> None:  # type: ignore[no-untyped-def]
    """`ck_employee_dismissed` (migration 0007) is bidirectional: this
    round-trip would fail to flush at all if the aggregate set only one of
    the two."""
    employee = await _register(session, personnel_number=str(uuid4().int)[:9])
    repo = EmployeeRepository(session)

    loaded = await repo.get(employee.id)
    assert loaded is not None
    loaded.change_employment_status(
        new_status=EmploymentStatus.DISMISSED,
        effective_date=date(2024, 5, 1),
        reason="по собственному желанию",
        now=NOW,
    )
    await session.commit()
    session.expunge_all()

    reloaded = await repo.get(employee.id)
    assert reloaded is not None
    assert reloaded.employment_status == EmploymentStatus.DISMISSED
    assert reloaded.dismissed_at == date(2024, 5, 1)
    assert len(reloaded.service_record) == 2


async def test_service_record_is_append_only_at_the_database_level(session) -> None:  # type: ignore[no-untyped-def]
    """DB011's DoD. The guard is a trigger, not a REVOKE, precisely so that
    it also holds for the table's owner — which is the role this test
    connects as (see migration 0008's docstring)."""
    employee = await _register(session, personnel_number=str(uuid4().int)[:9])
    entry_id = employee.service_record[0].id

    with pytest.raises((InternalError, IntegrityError)) as exc_info:
        await session.execute(
            text(
                "UPDATE personnel.service_record_entry SET rank = 'подделка' WHERE id = :id"
            ),
            {"id": entry_id},
        )
    assert "append-only" in str(exc_info.value)
    await session.rollback()


async def test_overlapping_secondments_are_rejected_by_the_exclude_constraint(session) -> None:  # type: ignore[no-untyped-def]
    """The aggregate rejects this too (unit-tested); this proves the DB
    would refuse independently, which is what protects against two
    concurrent requests each passing the in-memory check."""
    employee = await _register(session, personnel_number=str(uuid4().int)[:9])
    position_a = await _seed_position(session, uuid4().hex[:8])
    position_b = await _seed_position(session, uuid4().hex[:8])

    stmt = text(
        "INSERT INTO personnel.secondary_assignment "
        "(id, employee_id, position_id, unit_id, valid_from, valid_to) "
        "VALUES (gen_random_uuid(), :emp, :pos, :unit, :start, :end)"
    )

    def _params(position_id, start):  # type: ignore[no-untyped-def]
        return {
            "emp": employee.id,
            "pos": position_id,
            "unit": employee.current_unit_id,
            "start": start,
            "end": date(2024, 9, 1),
        }

    await session.execute(stmt, _params(position_a.id, date(2024, 1, 1)))
    with pytest.raises(IntegrityError):
        # Different position, same employee, overlapping period — the
        # EXCLUDE keys on `employee_id` alone precisely so this is refused
        # (see migration 0008's docstring).
        await session.execute(stmt, _params(position_b.id, date(2024, 5, 1)))
    await session.rollback()


async def test_list_filters_by_unit_and_pages(session) -> None:  # type: ignore[no-untyped-def]
    employee = await _register(session, personnel_number=str(uuid4().int)[:9])
    repo = EmployeeRepository(session)

    items, total = await repo.list(unit_id=employee.current_unit_id, page=1, page_size=50)
    assert total == 1
    assert [e.id for e in items] == [employee.id]

    _, total_other = await repo.list(unit_id=uuid4(), page=1, page_size=50)
    assert total_other == 0
