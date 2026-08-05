"""Value Objects и enum'ы домена Scheduling (Domain Model разд. 5).

Чистые dataclass'ы — ни Pydantic, ни SQLAlchemy (Backend_Architecture
разд. 3.1).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import StrEnum

from src.building_blocks.domain.value_object import ValueObject


class AccountingPeriodType(StrEnum):
    """Mirrors scheduling.accounting_period_type (миграция 0012)."""

    MONTH = "month"
    QUARTER = "quarter"
    YEAR = "year"


class ScheduleStatus(StrEnum):
    DRAFT = "draft"
    APPROVED = "approved"
    CLOSED = "closed"


class DutyType(StrEnum):
    """ВНИМАНИЕ: это НЕ то же самое, что `personnel.RegimeType`, хотя
    значения похожи. У режима должности четыре варианта, включая
    `unstandardized`; у плановой смены — три, и `shift` вместо
    `shift_schedule` (миграция 0012 и openapi `DutyType`). Совпадение
    названий обманчиво: режим — свойство ДОЛЖНОСТИ по умолчанию, тип
    дежурства — свойство КОНКРЕТНОЙ смены, и ненормированный режим
    плановой сменой не выражается вовсе."""

    FIVE_DAY_WEEK = "five_day_week"
    SHIFT = "shift"
    TWENTY_FOUR_HOUR_DUTY = "twenty_four_hour_duty"


@dataclass(frozen=True, kw_only=True)
class AccountingPeriod(ValueObject):
    """{PeriodType, начало, конец} — Domain Model разд. 5.1."""

    period_type: AccountingPeriodType
    start: date
    end: date

    def __post_init__(self) -> None:
        if self.end <= self.start:
            raise ValueError("period_end должен быть строго позже period_start")

    def contains(self, moment: date) -> bool:
        return self.start <= moment < self.end

    def __composite_values__(self) -> tuple[str, date, date]:
        """Требуется SQLAlchemy `composite()`, чтобы разложить VO обратно
        по колонкам при записи (та же роль, что у
        `EffectivePeriod.__composite_values__` в `legal_rules`).

        `period_type` отдаётся строкой, а не членом enum: колонка — нативный
        PostgreSQL enum, и он ждёт значение, а не объект. Порядок кортежа
        обязан совпадать с порядком колонок в `composite()`
        (`orm_mapping._accounting_period_factory`).
        """
        return self.period_type.value, self.start, self.end
