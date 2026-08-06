"""Handler for `AddServiceRecordEntryCommand` (PE009).

Checks the optional `position_id`/`unit_id` references when present —
they are real FKs on `service_record_entry` (migration 0008), so an
unknown id would otherwise surface as an opaque constraint violation
rather than a 404 naming what was not found.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.clock import Clock, SystemClock
from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.personnel.application.commands.add_service_record_entry.command import (
    AddServiceRecordEntryCommand,
)
from src.modules.personnel.application.ports import (
    EmployeeRepositoryPort,
    PositionRepositoryPort,
    UnitRepositoryPort,
)
from src.modules.personnel.domain.errors import (
    EmployeeNotFoundError,
    PositionNotFoundError,
    UnitNotFoundError,
)
from src.modules.personnel.domain.service_record import ServiceRecordEntry


class AddServiceRecordEntryHandler:
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

    async def handle(self, command: AddServiceRecordEntryCommand) -> ServiceRecordEntry:
        employee = await self._employees.get(command.employee_id)
        if employee is None:
            raise EmployeeNotFoundError(str(command.employee_id))
        if command.unit_id is not None and await self._units.get(command.unit_id) is None:
            raise UnitNotFoundError(str(command.unit_id))
        if (
            command.position_id is not None
            and await self._positions.get(command.position_id) is None
        ):
            raise PositionNotFoundError(str(command.position_id))

        # `add_service_record_entry` dispatches a `transfer`/`rank_change`
        # to the corresponding domain method, so posting one through this
        # generic endpoint actually MOVES the employee rather than merely
        # narrating that they moved (see the aggregate).
        entry = employee.add_service_record_entry(
            event_type=command.event_type,
            effective_date=command.effective_date,
            position_id=command.position_id,
            unit_id=command.unit_id,
            rank=command.rank,
            legal_base=command.legal_base,
            now=self._clock.now(),
        )
        # `transfer` поднимает EmployeeTransferred — оно должно уйти вместе
        # с самим переводом, а не отдельно от него.
        await self._outbox.enqueue(employee)
        await self._session.commit()
        return entry
