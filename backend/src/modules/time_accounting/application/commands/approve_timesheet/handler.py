"""Обработчик `ApproveTimesheetCommand` (TA015).

Пока утверждение — только смена статуса и событие. Сборка полного
`HoursBreakdown` внутри этого обработчика — отдельная задача TA026,
зависящая от Алгоритмов Б, Г-Е, Ж и З, которых ещё нет; делать её
наполовину означало бы записать в проекцию числа, посчитанные не по
всем правилам, и получить «утверждённый» табель с неверным расчётом.

`TimesheetApproved` уходит той же транзакцией: на него подписаны
построитель read-проекции (TA027) и Compensation (фаза 8).
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.time_accounting.application.commands.approve_timesheet.command import (
    ApproveTimesheetCommand,
)
from src.modules.time_accounting.application.ports import TimesheetRepositoryPort
from src.modules.time_accounting.domain.errors import TimesheetNotFoundError
from src.modules.time_accounting.domain.timesheet import Timesheet


class ApproveTimesheetHandler:
    def __init__(
        self, session: AsyncSession, repo: TimesheetRepositoryPort, outbox: OutboxWriter
    ) -> None:
        self._session = session
        self._repo = repo
        self._outbox = outbox

    async def handle(self, command: ApproveTimesheetCommand) -> Timesheet:
        timesheet = await self._repo.get(command.timesheet_id)
        if timesheet is None:
            raise TimesheetNotFoundError(str(command.timesheet_id))

        timesheet.approve()
        await self._outbox.enqueue(timesheet)
        await self._session.commit()
        return timesheet
