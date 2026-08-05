"""PE015 — dev/test seed: a sample org structure and a staff of 20.

    python -m scripts.seed_personnel_dev

Creates a three-level unit tree (МЧС России → 2 региональных центра → 3
пожарные части), five positions covering every `PositionCategory`, and 20
employees spread across the units, the two `LegalBase` values, both
non-trivial `ServiceConditionCategory` values, and every
`EmploymentStatus` — including dismissed ones, which are the case most
likely to be missing from hand-made test data and the one most likely to
break a query (`ix_employee_unit_active` exists precisely because they
accumulate).

Deliberately goes through the DOMAIN (`Unit.create_child`,
`Employee.register`, `change_employment_status`) rather than issuing
INSERTs. Two consequences, both wanted: the seeded data cannot violate an
invariant the aggregates enforce, and the service record of every employee
is real history built by the same code path production uses — a seeded
`sick` employee has an actual status-change behind them, not a status
column set to a string.

Idempotent by `personnel_number` / `code`: re-running tops the data set up
instead of failing or duplicating. Safe to run against a dev database
repeatedly; it is not intended for, and makes no attempt to be safe in, a
production one.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, date, datetime

from src.building_blocks.infrastructure.db import dispose_engine, get_session, init_engine
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

NOW = datetime.now(UTC)

_POSITIONS: list[tuple[str, str, PositionCategory, RegimeType]] = [
    ("POS.GUARD_CHIEF", "Начальник караула", PositionCategory.OPERATIONAL,
     RegimeType.TWENTY_FOUR_HOUR_DUTY),
    ("POS.FIREFIGHTER", "Пожарный", PositionCategory.OPERATIONAL, RegimeType.SHIFT_SCHEDULE),
    ("POS.INSPECTOR", "Инспектор ГПН", PositionCategory.ADMINISTRATIVE,
     RegimeType.FIVE_DAY_WEEK),
    ("POS.INSTRUCTOR", "Преподаватель", PositionCategory.PEDAGOGICAL, RegimeType.FIVE_DAY_WEEK),
    ("POS.ENGINEER", "Инженер по эксплуатации", PositionCategory.HAZARDOUS_TECHNICAL,
     RegimeType.UNSTANDARDIZED),
]

_SURNAMES = [
    "Иванов", "Петров", "Сидоров", "Кузнецов", "Смирнов", "Попов", "Васильев", "Новиков",
    "Фёдоров", "Морозов", "Волков", "Алексеев", "Лебедев", "Семёнов", "Егоров", "Павлов",
    "Козлов", "Степанов", "Николаев", "Орлов",
]

# Roughly the shape of a real roster: mostly on duty, a few away, a couple
# gone. Cycled over the 20 employees.
_STATUS_CYCLE: list[EmploymentStatus] = [
    EmploymentStatus.ACTIVE,
    EmploymentStatus.ACTIVE,
    EmploymentStatus.ACTIVE,
    EmploymentStatus.ON_LEAVE,
    EmploymentStatus.ACTIVE,
    EmploymentStatus.SICK,
    EmploymentStatus.ACTIVE,
    EmploymentStatus.SUSPENDED,
    EmploymentStatus.ACTIVE,
    EmploymentStatus.DISMISSED,
]


@dataclass
class SeedResult:
    units: int
    positions: int
    employees: int


async def seed() -> SeedResult:
    start_mappers()
    settings = get_settings()
    init_engine(dsn=settings.database_dsn, pool_size=settings.database_pool_size)

    try:
        async for session in get_session():
            units_repo = UnitRepository(session)
            positions_repo = PositionRepository(session)
            employees_repo = EmployeeRepository(session)

            # --- units: three levels (Architecture разд. 12.2 names the unit
            # hierarchy as the natural partitioning key, so dev data that is
            # flat would exercise none of it).
            root = await units_repo.get_by_code("MCHS")
            if root is None:
                root = Unit.create_root(code="MCHS", name="МЧС России")
                units_repo.add(root)

            regions: list[Unit] = []
            for code, name in (
                ("RC.CENTRAL", "Центральный региональный центр"),
                ("RC.URAL", "Уральский региональный центр"),
            ):
                region = await units_repo.get_by_code(code)
                if region is None:
                    region = Unit.create_child(code=code, name=name, parent=root)
                    units_repo.add(region)
                regions.append(region)

            stations: list[Unit] = []
            for index, (code, name) in enumerate(
                (
                    ("PCH.12", "Пожарная часть № 12"),
                    ("PCH.34", "Пожарная часть № 34"),
                    ("PCH.56", "Пожарная часть № 56"),
                )
            ):
                station = await units_repo.get_by_code(code)
                if station is None:
                    station = Unit.create_child(
                        code=code, name=name, parent=regions[index % len(regions)]
                    )
                    units_repo.add(station)
                stations.append(station)

            await session.commit()

            # --- positions
            positions: list[Position] = []
            for code, title, category, regime in _POSITIONS:
                position = await positions_repo.get_by_code(code)
                if position is None:
                    position = Position.create(
                        code=code, title=title, category=category, default_regime_type=regime
                    )
                    positions_repo.add(position)
                positions.append(position)
            await session.commit()

            # --- employees
            created = 0
            for index, surname in enumerate(_SURNAMES):
                personnel_number = f"{100000 + index}"
                if await employees_repo.get_by_personnel_number(personnel_number) is not None:
                    continue

                station = stations[index % len(stations)]
                position = positions[index % len(positions)]
                employee = Employee.register(
                    personnel_number=personnel_number,
                    full_name=f"{surname} Сотрудник {index + 1}",
                    rank=(
                        "майор внутренней службы"
                        if index % 3 == 0
                        else "капитан внутренней службы"
                    ),
                    legal_base=LegalBase.FPS_SERVICE if index % 4 else LegalBase.LABOR_CODE,
                    service_condition_category=(
                        ServiceConditionCategory.HAZARDOUS_OR_DANGEROUS
                        if position.category == PositionCategory.OPERATIONAL
                        else ServiceConditionCategory.NORMAL
                    ),
                    position_id=position.id,
                    unit_id=station.id,
                    hired_at=date(2018 + (index % 6), 1 + (index % 12), 1),
                    now=NOW,
                )

                target = _STATUS_CYCLE[index % len(_STATUS_CYCLE)]
                if target != EmploymentStatus.ACTIVE:
                    # Goes through the real state machine, so the seeded
                    # employee carries the service-record entries that the
                    # transition genuinely produces.
                    employee.change_employment_status(
                        new_status=target,
                        effective_date=date(2024, 1 + (index % 12), 15),
                        reason="seed-данные для разработки",
                        now=NOW,
                    )

                employees_repo.add(employee)
                created += 1

            await session.commit()
            return SeedResult(
                units=1 + len(regions) + len(stations),
                positions=len(positions),
                employees=created,
            )
        raise RuntimeError("session dependency yielded nothing")
    finally:
        await dispose_engine()


async def _main() -> None:
    result = await seed()
    print(
        f"personnel seed complete: {result.units} units, "
        f"{result.positions} positions, {result.employees} new employees"
    )


if __name__ == "__main__":
    asyncio.run(_main())
