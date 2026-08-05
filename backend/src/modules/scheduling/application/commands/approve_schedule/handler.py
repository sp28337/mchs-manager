"""Обработчик `ApproveScheduleCommand` (SD008)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.scheduling.application.commands.approve_schedule.command import (
    ApproveScheduleCommand,
)
from src.modules.scheduling.application.ports import DutyScheduleRepositoryPort
from src.modules.scheduling.domain.duty_schedule import DutySchedule
from src.modules.scheduling.domain.errors import ScheduleNotFoundError


class ApproveScheduleHandler:
    def __init__(
        self,
        session: AsyncSession,
        repo: DutyScheduleRepositoryPort,
        outbox: OutboxWriter,
    ) -> None:
        self._session = session
        self._repo = repo
        self._outbox = outbox

    async def handle(self, command: ApproveScheduleCommand) -> DutySchedule:
        schedule = await self._repo.get(command.schedule_id)
        if schedule is None:
            raise ScheduleNotFoundError(str(command.schedule_id))

        schedule.approve(approval_order_ref=command.approval_order_ref)
        # ScheduleApproved уходит той же транзакцией: табели периода
        # открываются по утверждённому графику, и утверждение без события
        # оставило бы TimeAccounting без сигнала.
        await self._outbox.enqueue(schedule)
        await self._session.commit()
        return schedule
