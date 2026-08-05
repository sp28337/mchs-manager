"""Value Objects и enum'ы домена Time Accounting (Domain Model разд. 6.1).

Чистые dataclass'ы — ни Pydantic, ни SQLAlchemy (Backend_Architecture
разд. 3.1). `TimeInterval` здесь не объявлен: он общий для всех модулей и
живёт в `building_blocks.domain.time_interval` (см. его докстринг о том,
почему именно он — законный случай Shared Kernel).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from src.building_blocks.domain.value_object import ValueObject


class TimesheetStatus(StrEnum):
    """Mirrors time_accounting.timesheet_status (миграция 0014).

    `PENDING_APPROVAL` объявлен в логической модели и в openapi
    (`TimesheetStatus`), но ни одна операция openapi в него не переводит:
    эндпоинтов ровно два — `approve` и `reopen`. То есть значение
    зарезервировано под будущий шаг «табельщик сдал табель командиру», а
    сегодня недостижимо.

    Оно оставлено в перечислении, а не выброшено: enum зеркалит тип БД, и
    расхождение состава значений между Python и PostgreSQL — это отказ при
    чтении строки, которую кто-то завёл миграцией или руками. Ровно так же
    в `scheduling` некоторое время жил неиспользуемый `CLOSED`, пока SD009
    не дал ему смысл.
    """

    OPEN = "open"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REOPENED = "reopened"


class ServiceTimeEventType(StrEnum):
    """Mirrors time_accounting.service_time_event_type (миграция 0014).

    Деление на две группы — не свойство перечисления, а свойство расчёта
    (Алгоритм В шаг 2), поэтому оно выражено методами, а не двумя
    отдельными enum'ами: одно и то же событие обязано иметь один тип и в
    БД, и в API, и в расчёте.
    """

    ACTUAL_SHIFT = "actual_shift"
    SICKNESS = "sickness"
    SUSPENSION = "suspension"
    OVERTIME_ATTRACTION = "overtime_attraction"
    BUSINESS_TRIP = "business_trip"

    @property
    def counts_as_service_time(self) -> bool:
        """Алгоритм В шаг 2, первая группа: «засчитываемые как факт
        службы/работы». Командировка входит: сотрудник исполняет
        обязанности, просто не по месту службы."""
        return self in {
            ServiceTimeEventType.ACTUAL_SHIFT,
            ServiceTimeEventType.OVERTIME_ATTRACTION,
            ServiceTimeEventType.BUSINESS_TRIP,
        }

    @property
    def is_explained_absence(self) -> bool:
        """Алгоритм В шаг 2, вторая группа: исключается из факта, но
        объясняет недоработку (Domain Model инвариант 6.1.3 — недоработка
        не вменяется по событиям, не зависящим от сотрудника)."""
        return self in {ServiceTimeEventType.SICKNESS, ServiceTimeEventType.SUSPENSION}


class AccountingPeriodType(StrEnum):
    """Mirrors time_accounting.accounting_period_type (миграция 0014).

    Состав значений совпадает со `scheduling.AccountingPeriodType`, а тип
    в БД — собственный: см. п. 3(б) докстринга миграции 0014 о том, почему
    схема не ссылается на тип чужой схемы.
    """

    MONTH = "month"
    QUARTER = "quarter"
    YEAR = "year"


@dataclass(frozen=True, kw_only=True)
class AccountingPeriod(ValueObject):
    """{PeriodType, начало, конец} — полуоткрытый `[start, end)`."""

    period_type: AccountingPeriodType
    start: date
    end: date

    def __post_init__(self) -> None:
        if self.end <= self.start:
            raise ValueError("period_end должен быть строго позже period_start")

    def contains(self, moment: date) -> bool:
        return self.start <= moment < self.end

    def __composite_values__(self) -> tuple[str, date, date]:
        """Требуется SQLAlchemy `composite()`. `period_type` отдаётся
        строкой: колонка — нативный PostgreSQL enum, он ждёт значение, а
        не объект. Порядок обязан совпадать с порядком колонок в
        `composite()` (`orm_mapping._accounting_period_factory`)."""
        return self.period_type.value, self.start, self.end


@dataclass(frozen=True, kw_only=True)
class HoursBreakdown(ValueObject):
    """Результат расчёта периода (Domain Model разд. 6.1).

    «Вычисляемый, невладеющий (produced, not stored as source of truth)» —
    источник истины остаётся набором `ServiceTimeEvent`, а это VO лишь
    итог применения к нему правил. Отсюда два следствия, заложенные прямо
    в тип:

    * **VO, а не сущность.** У него нет идентичности и нет сеттеров: его
      не «правят», его пересчитывают. Инвариант 6.1.5 требует, чтобы
      повторный расчёт тех же входных данных давал идентичный результат, —
      изменяемый объект это требование бы обессмыслил.
    * **Провенанс внутри значения, а не рядом с ним.** `used_*` и
      `legal_base` — такие же поля VO, как сами часы. Без них два
      одинаковых набора цифр, посчитанных по разным редакциям закона,
      неразличимы, и «пересчитать переработку за любой год» (SRS разд. 4)
      превращается в «посчитать заново по сегодняшним правилам», что не
      одно и то же.

    `Decimal`, а не `float`: колонки проекции — `numeric(8,2)`, а часы
    попадают в расчёт компенсации, то есть в деньги. Двоичная дробь здесь
    дала бы 7.199999999999999 ч там, где закон говорит о 7,2.
    """

    norm_hours: Decimal
    actual_hours: Decimal
    night_hours: Decimal
    holiday_hours: Decimal
    weekend_hours: Decimal
    overtime_hours: Decimal
    underworked_hours: Decimal
    underworked_explained_hours: Decimal
    used_rule_version_id: UUID
    used_conflict_policy_version_id: UUID | None
    legal_base: str

    def __post_init__(self) -> None:
        negative = [
            name
            for name, value in (
                ("norm_hours", self.norm_hours),
                ("actual_hours", self.actual_hours),
                ("night_hours", self.night_hours),
                ("holiday_hours", self.holiday_hours),
                ("weekend_hours", self.weekend_hours),
                ("overtime_hours", self.overtime_hours),
                ("underworked_hours", self.underworked_hours),
                ("underworked_explained_hours", self.underworked_explained_hours),
            )
            if value < 0
        ]
        if negative:
            raise ValueError(f"часы не бывают отрицательными: {', '.join(negative)}")

        # Алгоритм З шаги 2-3: переработка и недоработка — разные знаки
        # одной разности. Ненулевыми одновременно они могут стать только
        # если расчёт собран из несогласованных частей.
        if self.overtime_hours > 0 and self.underworked_hours > 0:
            raise ValueError(
                f"переработка ({self.overtime_hours} ч) и недоработка "
                f"({self.underworked_hours} ч) не могут быть положительными одновременно"
            )

        # Алгоритм З шаг 5: объяснённая часть — доля недоработки, а не
        # слагаемое рядом с ней.
        if self.underworked_explained_hours > self.underworked_hours:
            raise ValueError(
                f"объяснённая недоработка ({self.underworked_explained_hours} ч) больше "
                f"всей недоработки ({self.underworked_hours} ч)"
            )

    @property
    def underworked_unexplained_hours(self) -> Decimal:
        """Необъяснённый остаток (Алгоритм З шаг 6) — сигнал к проверке
        корректности учёта, а не автоматическое финансовое последствие."""
        return self.underworked_hours - self.underworked_explained_hours
