"""Обработчик `ReviseScheduleCommand` (SD009).

Единственное место в кодовой базе, где проверка ограничения откладывается
до коммита. Причина в миграции 0013: пересмотр в одной транзакции и
помечает старые смены `superseded`, и вставляет новые копии, а порядок
UPDATE/INSERT у ORM не гарантирован — при немедленной проверке вставка
могла бы упасть на ещё не помеченной старой смене.

`SET CONSTRAINTS ... DEFERRED` действует только до конца текущей
транзакции, поэтому обычные вставки смен (`AddPlannedShiftHandler`)
продолжают падать сразу, на своём операторе, и отдают 409 с внятным телом.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.scheduling.application.commands.revise_schedule.command import (
    ReviseScheduleCommand,
)
from src.modules.scheduling.application.ports import DutyScheduleRepositoryPort
from src.modules.scheduling.domain.duty_schedule import DutySchedule
from src.modules.scheduling.domain.errors import ScheduleNotFoundError


class ReviseScheduleHandler:
    def __init__(
        self,
        session: AsyncSession,
        repo: DutyScheduleRepositoryPort,
        outbox: OutboxWriter,
    ) -> None:
        self._session = session
        self._repo = repo
        self._outbox = outbox

    async def handle(self, command: ReviseScheduleCommand) -> DutySchedule:
        schedule = await self._repo.get(command.schedule_id)
        if schedule is None:
            raise ScheduleNotFoundError(str(command.schedule_id))

        await self._session.execute(
            text("SET CONSTRAINTS scheduling.excl_planned_shift_no_overlap DEFERRED")
        )

        successor = schedule.revise(reason=command.reason)
        self._repo.add(successor)
        await self._outbox.enqueue(schedule)
        await self._session.commit()
        return successor
