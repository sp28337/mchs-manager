"""PE005 — write-side repositories for `personnel`.

One repository per aggregate root (`Unit`, `Position`, `Employee`), each
loading and saving its aggregate whole — `Employee` comes back with its
service record and secondments attached (`lazy="selectin"` in
`orm_mapping.py`), because a domain method like
`change_employment_status()` appends to that history as part of its own
work and cannot do so against a half-loaded aggregate.

Same Transactional-Outbox gap as `legal_rules`: `AggregateRoot.
pull_pending_events()` buffers `EmployeeRegistered`/`EmploymentStatusChanged`/
`EmployeeTransferred`, and nothing drains it here yet — the
`outbox_message` table (Architecture разд. 9.2) is not migrated. Flagged
rather than faked; this is where the drain will go once it exists.

`PersonnelAndOrganization` is explicitly NOT a CQRS module (Architecture
разд. 8.2: "классический справочный CRUD без асимметрии, оправдывающей
раздельные модели"), so the read paths below go through these same
repositories rather than a separate projection — the arrangement
Architecture разд. 6 names as this module's example.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.personnel.domain.employee import Employee
from src.modules.personnel.domain.position import Position
from src.modules.personnel.domain.unit import Unit
from src.modules.personnel.infrastructure.orm_mapping import (
    employee_table,
    position_table,
    unit_table,
)


class UnitRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, unit_id: UUID) -> Unit | None:
        return await self._session.get(Unit, unit_id)

    async def get_by_code(self, code: str) -> Unit | None:
        result = await self._session.execute(select(Unit).where(unit_table.c.code == code))
        return result.scalar_one_or_none()

    async def list_subtree(self, unit_id: UUID) -> list[Unit]:
        """Все подразделения под данным (включая его само) — one indexed
        query, not a recursive walk.

        This is the shape every `unit_scope` authorization check needs
        (API_Conventions разд. 2: the JWT carries `unit_scope[]` and the
        Application layer resolves row-level access from it), and it is
        the query the GiST index from migration 0008 exists for: `<@` is
        ltree's "is a descendant of", index-backed, versus the
        self-referencing recursive CTE that `parent_unit_id` alone would
        force.
        """
        root = await self.get(unit_id)
        if root is None:
            return []
        result = await self._session.execute(
            select(Unit)
            .where(unit_table.c.hierarchy_path.op("<@")(root.hierarchy_path.as_ltree()))
            .order_by(unit_table.c.hierarchy_path)
        )
        return list(result.scalars().all())

    def add(self, unit: Unit) -> None:
        self._session.add(unit)


class PositionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, position_id: UUID) -> Position | None:
        return await self._session.get(Position, position_id)

    async def get_by_code(self, code: str) -> Position | None:
        result = await self._session.execute(select(Position).where(position_table.c.code == code))
        return result.scalar_one_or_none()

    def add(self, position: Position) -> None:
        self._session.add(position)


class EmployeeRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, employee_id: UUID) -> Employee | None:
        return await self._session.get(Employee, employee_id)

    async def get_by_personnel_number(self, personnel_number: str) -> Employee | None:
        result = await self._session.execute(
            select(Employee).where(employee_table.c.personnel_number == personnel_number)
        )
        return result.scalar_one_or_none()

    async def list(
        self, *, unit_id: UUID | None, page: int, page_size: int
    ) -> tuple[list[Employee], int]:
        """`GET /personnel/employees` -> `EmployeeListEnvelope`
        (`items`, `page`, `pageSize`, `totalCount`).

        `unitId` filters on the employee's OWN unit, not on its subtree —
        the literal reading of openapi.yaml's "Список сотрудников
        подразделения". Listing a whole regional command's staff at once
        is a different question with different paging behaviour; when a
        screen needs it, it composes `UnitRepository.list_subtree()`
        rather than silently changing what this endpoint means.
        """
        filters = [employee_table.c.current_unit_id == unit_id] if unit_id is not None else []

        total_count = await self._session.scalar(
            select(func.count()).select_from(employee_table).where(*filters)
        )

        result = await self._session.execute(
            select(Employee)
            .where(*filters)
            .order_by(employee_table.c.full_name)
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
        return list(result.scalars().all()), int(total_count or 0)

    def add(self, employee: Employee) -> None:
        self._session.add(employee)
