"""Handler for `RegisterEmployeeCommand` (PE007).

Validates the two references the DB has real FKs for (`current_position_id`,
`current_unit_id`, migration 0007) before constructing the aggregate, so a
mistyped id comes back as a 404 naming which one was wrong rather than as
an opaque FK violation.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.clock import Clock, SystemClock
from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.personnel.application.commands.register_employee.command import (
    RegisterEmployeeCommand,
)
from src.modules.personnel.application.ports import (
    EmployeeRepositoryPort,
    PositionRepositoryPort,
    UnitRepositoryPort,
)
from src.modules.personnel.domain.employee import Employee
from src.modules.personnel.domain.errors import (
    PersonnelNumberAlreadyExistsError,
    PositionNotFoundError,
    UnitNotFoundError,
)


class RegisterEmployeeHandler:
    def __init__(
        self,
        session: AsyncSession,
        employees: EmployeeRepositoryPort,
        units: UnitRepositoryPort,
        positions: PositionRepositoryPort,
        outbox: OutboxWriter,
        clock: Clock | None = None,
    ) -> None:
        self._session = session
        self._employees = employees
        self._units = units
        self._positions = positions
        self._outbox = outbox
        self._clock = clock or SystemClock()

    async def handle(self, command: RegisterEmployeeCommand) -> Employee:
        if await self._employees.get_by_personnel_number(command.personnel_number) is not None:
            raise PersonnelNumberAlreadyExistsError(command.personnel_number)
        if await self._units.get(command.current_unit_id) is None:
            raise UnitNotFoundError(str(command.current_unit_id))
        if await self._positions.get(command.current_position_id) is None:
            raise PositionNotFoundError(str(command.current_position_id))

        # `Employee.register()` — not a bare constructor: it also opens the
        # service record with the initial `assignment` entry, so the
        # history has no hole at day one (see the aggregate).
        employee = Employee.register(
            personnel_number=command.personnel_number,
            full_name=command.full_name,
            rank=command.rank,
            legal_base=command.legal_base,
            service_condition_category=command.service_condition_category,
            position_id=command.current_position_id,
            unit_id=command.current_unit_id,
            hired_at=command.hired_at,
            now=self._clock.now(),
        )
        self._employees.add(employee)
        await self._outbox.enqueue(employee)
        await self._session.commit()
        return employee
