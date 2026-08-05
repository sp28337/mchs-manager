"""Handler for `ChangeEmploymentStatusCommand` (PE008).

Whether the transition is legal is `Employee`'s decision, not this
handler's — `_ALLOWED_TRANSITIONS` lives in the aggregate and the handler
merely lets the resulting `InvalidEmploymentStatusTransitionError`
propagate to the API layer, which maps it to 422 (API_Conventions разд. 3).
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.clock import Clock, SystemClock
from src.modules.personnel.application.commands.change_employment_status.command import (
    ChangeEmploymentStatusCommand,
)
from src.modules.personnel.application.ports import EmployeeRepositoryPort
from src.modules.personnel.domain.employee import Employee
from src.modules.personnel.domain.errors import EmployeeNotFoundError


class ChangeEmploymentStatusHandler:
    def __init__(
        self, session: AsyncSession, repo: EmployeeRepositoryPort, clock: Clock | None = None
    ) -> None:
        self._session = session
        self._repo = repo
        self._clock = clock or SystemClock()

    async def handle(self, command: ChangeEmploymentStatusCommand) -> Employee:
        employee = await self._repo.get(command.employee_id)
        if employee is None:
            raise EmployeeNotFoundError(str(command.employee_id))

        employee.change_employment_status(
            new_status=command.new_status,
            effective_date=command.effective_date,
            reason=command.reason,
            now=self._clock.now(),
        )
        await self._session.commit()
        return employee
