"""Value Objects и enum'ы домена Scheduling (Domain Model разд. 5).

Чистые dataclass'ы — ни Pydantic, ни SQLAlchemy (Backend_Architecture
разд. 3.1).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
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
class TimeInterval(ValueObject):
    """{начало, конец}; инвариант VO: начало строго раньше конца
    (Domain Model разд. 5.1).

    Полуоткрытый `[start, end)` — как `tstzrange(..., '[)')` в БД и как все
    остальные интервалы кодовой базы. Смена, кончающаяся в 08:00, и смена,
    начинающаяся в 08:00, не пересекаются: это пересменка, а не наложение.
    """

    start: datetime
    end: datetime

    def __post_init__(self) -> None:
        if self.end <= self.start:
            raise ValueError(f"начало {self.start} должно быть строго раньше конца {self.end}")
        if self.start.tzinfo is None or self.end.tzinfo is None:
            # tstzrange хранит момент времени, а не «стенные часы». Наивный
            # datetime здесь молча получил бы таймзону сервера — и смена,
            # заведённая в Калининграде и на Камчатке, оказалась бы в одном
            # и том же моменте.
            raise ValueError("границы смены должны быть с таймзоной (aware datetime)")

    def overlaps(self, other: TimeInterval) -> bool:
        return self.start < other.end and other.start < self.end

    def duration_hours(self) -> float:
        return (self.end - self.start).total_seconds() / 3600

    def gap_to(self, later: TimeInterval) -> float:
        """Часы между концом этой смены и началом следующей. Отрицательное
        значение означает пересечение — используется
        `RestPeriodPolicyService` (SD006) для проверки минимального
        межсменного отдыха."""
        return (later.start - self.end).total_seconds() / 3600


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
