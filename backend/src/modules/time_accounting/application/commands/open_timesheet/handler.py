"""Обработчик `OpenTimesheetCommand` (TA007).

DoD задачи: «повторное открытие того же (employeeId, period) возвращает
409». Проверка сделана ЗАПРОСОМ, а не отловом `IntegrityError` от
`uq_timesheet_employee_period`, по той же причине, что в остальных
модулях: у отказа должно быть внятное тело ответа с указанием
существующего табеля, а не расшифровка текста ограничения БД. Само
ограничение при этом остаётся последним рубежом на случай гонки.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.time_accounting.application.commands.open_timesheet.command import (
    OpenTimesheetCommand,
)
from src.modules.time_accounting.application.ports import (
    EmployeeExistencePort,
    TimesheetRepositoryPort,
)
from src.modules.time_accounting.domain.errors import (
    TimesheetNotFoundError,
    TimesheetPeriodAlreadyOpenError,
)
from src.modules.time_accounting.domain.timesheet import Timesheet
from src.modules.time_accounting.domain.value_objects import AccountingPeriod


class OpenTimesheetHandler:
    def __init__(
        self,
        session: AsyncSession,
        repo: TimesheetRepositoryPort,
        employees: EmployeeExistencePort,
    ) -> None:
        self._session = session
        self._repo = repo
        self._employees = employees

    async def handle(self, command: OpenTimesheetCommand) -> Timesheet:
        if not await self._employees.exists(command.employee_id):
            raise TimesheetNotFoundError(
                f"сотрудник {command.employee_id} не найден: табель открывается на "
                f"существующего сотрудника (PostgreSQL_Logical_Model разд. 10 — "
                f"межсхемной ссылочной целостности нет, проверяет Application)"
            )

        existing = await self._repo.get_for_period(
            employee_id=command.employee_id,
            period_start=command.period_start,
            period_end=command.period_end,
        )
        if existing is not None:
            raise TimesheetPeriodAlreadyOpenError(
                f"табель сотрудника {command.employee_id} за период "
                f"[{command.period_start}, {command.period_end}) уже существует: {existing.id}"
            )

        period = AccountingPeriod(
            period_type=command.period_type,
            start=command.period_start,
            end=command.period_end,
        )
        timesheet = Timesheet.open_for(employee_id=command.employee_id, period=period)
        self._repo.add(timesheet)
        await self._session.commit()
        return timesheet
