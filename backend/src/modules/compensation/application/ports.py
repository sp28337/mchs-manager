"""Порты Application-слоя `compensation`.

Та же инверсия, что во всех модулях: `.importlinter` запрещает
`application -> infrastructure`, поэтому обработчики зависят от Protocol.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from src.modules.compensation.application.services.compensation_allocation import (
    CompensationRule,
)
from src.modules.compensation.domain.compensation_case import CompensationCase


class ApprovedPeriod(BaseModel):
    """Ответ `time_accounting` на вопрос «что зафиксировано за период».

    Собственный тип, а не `ApprovedBreakdown` чужого модуля: порт
    описывает ФОРМУ ВОПРОСА, и она наша. Изменение чужого DTO должно
    ломать один адаптер, а не все обработчики.
    """

    model_config = ConfigDict(frozen=True)

    timesheet_id: UUID
    employee_id: UUID
    period_start: date
    period_end: date
    is_approved: bool
    night_hours: Decimal
    holiday_hours: Decimal
    weekend_hours: Decimal
    overtime_hours: Decimal
    legal_base: str


class CompensationCaseRepositoryPort(Protocol):
    async def get(self, case_id: UUID) -> CompensationCase | None: ...
    async def get_with_limits(self, case_id: UUID) -> CompensationCase | None: ...
    async def get_active_for_period(
        self, *, employee_id: UUID, period_start: date, period_end: date
    ) -> CompensationCase | None: ...
    async def list_for_employee(
        self, *, employee_id: UUID, page: int = 1, page_size: int = 20
    ) -> list[CompensationCase]: ...
    def add(self, case: CompensationCase) -> None: ...


class ApprovedPeriodPort(Protocol):
    """Domain Model инвариант 7.1.1 плюс предел инварианта 7.1.2 — одним
    вопросом, потому что оба ответа обязаны быть согласованы между собой
    (см. докстринг контракта `get_approved_breakdown`)."""

    async def approved_period(
        self, *, employee_id: UUID, period_start: date, period_end: date
    ) -> ApprovedPeriod | None: ...


class CompensationRulePort(Protocol):
    """Алгоритм К шаги 3-4: форма компенсации и допустимость выбора для
    категории часов на дату."""

    async def rule_for(
        self, *, as_of: date, scope: dict[str, str]
    ) -> CompensationRule: ...
