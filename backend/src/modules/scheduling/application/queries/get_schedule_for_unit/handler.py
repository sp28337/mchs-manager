"""Обработчик `GetScheduleForUnitQuery` (SD010)."""

from __future__ import annotations

from src.modules.scheduling.application.ports import DutyScheduleRepositoryPort
from src.modules.scheduling.application.queries.get_schedule_for_unit.query import (
    GetScheduleForUnitQuery,
)
from src.modules.scheduling.domain.duty_schedule import DutySchedule


class GetScheduleForUnitHandler:
    def __init__(self, repo: DutyScheduleRepositoryPort) -> None:
        self._repo = repo

    async def handle(self, query: GetScheduleForUnitQuery) -> list[DutySchedule]:
        return await self._repo.list_for_unit(
            unit_id=query.unit_id,
            period_start=query.period_start,
            period_end=query.period_end,
        )
