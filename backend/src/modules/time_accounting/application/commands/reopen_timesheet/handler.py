"""Обработчик `ReopenTimesheetCommand` (TA016).

DoD: «переоткрытие требует обязательной причины». Требование живёт в
агрегате (`Timesheet.reopen`), а не здесь: это инвариант 6.1.4, а не
правило оркестрации, и обработчик, проверяющий его сам, дал бы второе
место, где написано то же самое, — и первое же расхождение между ними
осталось бы незамеченным.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.time_accounting.application.commands.reopen_timesheet.command import (
    ReopenTimesheetCommand,
)
from src.modules.time_accounting.application.ports import TimesheetRepositoryPort
from src.modules.time_accounting.domain.errors import TimesheetNotFoundError
from src.modules.time_accounting.domain.timesheet import Timesheet


class ReopenTimesheetHandler:
    def __init__(
        self, session: AsyncSession, repo: TimesheetRepositoryPort, outbox: OutboxWriter
    ) -> None:
        self._session = session
        self._repo = repo
        self._outbox = outbox

    async def handle(self, command: ReopenTimesheetCommand) -> Timesheet:
        timesheet = await self._repo.get(command.timesheet_id)
        if timesheet is None:
            raise TimesheetNotFoundError(str(command.timesheet_id))

        timesheet.reopen(reason=command.reason)
        await self._outbox.enqueue(timesheet)
        await self._session.commit()
        return timesheet
