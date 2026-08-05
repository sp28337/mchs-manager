"""Обработчик `DraftScheduleCommand` (SD004)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.scheduling.application.commands.draft_schedule.command import DraftScheduleCommand
from src.modules.scheduling.application.ports import DutyScheduleRepositoryPort
from src.modules.scheduling.domain.duty_schedule import DutySchedule
from src.modules.scheduling.domain.errors import SchedulePeriodAlreadyExistsError
from src.modules.scheduling.domain.value_objects import AccountingPeriod


class DraftScheduleHandler:
    def __init__(self, session: AsyncSession, repo: DutyScheduleRepositoryPort) -> None:
        self._session = session
        self._repo = repo

    async def handle(self, command: DraftScheduleCommand) -> DutySchedule:
        # Проверяется ДЕЙСТВУЮЩАЯ версия: закрытые остаются историей и
        # созданию нового графика не мешают (частичный индекс
        # `uq_duty_schedule_unit_period_active`, миграция 0013).
        existing = await self._repo.get_active_for_period(
            unit_id=command.unit_id,
            period_start=command.period_start,
            period_end=command.period_end,
        )
        if existing is not None:
            raise SchedulePeriodAlreadyExistsError(
                f"у подразделения {command.unit_id} уже есть действующий график на "
                f"[{command.period_start}, {command.period_end}): {existing.id}"
            )

        schedule = DutySchedule.draft(
            unit_id=command.unit_id,
            period=AccountingPeriod(
                period_type=command.period_type,
                start=command.period_start,
                end=command.period_end,
            ),
        )
        self._repo.add(schedule)
        await self._session.commit()
        return schedule
