"""Порты Application-слоя `scheduling`.

Та же инверсия, что и в остальных модулях: `.importlinter` запрещает
`application -> infrastructure`, поэтому обработчики зависят от Protocol,
а конкретные реализации подставляет вызывающий.

Два порта здесь — межмодульные, и это главное, что стоит заметить: и
`EmployeeAvailabilityPort`, и `MinimumRestPeriodPort` описывают ФАКТЫ из
чужих контекстов (`personnel` и `legal_rules`). Модуль не импортирует ни
тот, ни другой — он объявляет форму вопроса, а связать её с чужим
`Contracts/` — работа Composition/API-слоя (Architecture разд. 4.2).
"""

from __future__ import annotations

from datetime import date
from typing import Protocol
from uuid import UUID

from src.building_blocks.domain.time_interval import TimeInterval
from src.modules.scheduling.domain.duty_schedule import DutySchedule


class DutyScheduleRepositoryPort(Protocol):
    async def get(self, schedule_id: UUID) -> DutySchedule | None: ...
    async def get_active_for_period(
        self, *, unit_id: UUID, period_start: date, period_end: date
    ) -> DutySchedule | None: ...
    async def list_for_unit(
        self, *, unit_id: UUID, period_start: date, period_end: date
    ) -> list[DutySchedule]: ...
    async def active_shift_intervals_of(self, employee_id: UUID) -> list[TimeInterval]: ...
    def add(self, schedule: DutySchedule) -> None: ...


class EmployeeAvailabilityPort(Protocol):
    """Domain Model инвариант 5.1.4 — плановую смену нельзя назначить
    сотруднику, чей `EmploymentStatus` не `active`.

    Возвращает статус строкой: enum принадлежит `personnel`, и импортировать
    его сюда значило бы тянуть чужой домен.
    """

    async def employment_status_of(self, employee_id: UUID) -> str | None: ...


class MinimumRestPeriodPort(Protocol):
    """Domain Model инвариант 5.1.2 — величина минимального межсменного
    отдыха на дату, из `RuleVersion` категории `minimum_rest_period`."""

    async def minimum_rest_hours(self, *, as_of: date, scope: dict[str, str]) -> float: ...
