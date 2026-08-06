"""Value Objects и enum'ы домена Compensation (Domain Model разд. 7.1)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from src.building_blocks.domain.value_object import ValueObject


class CaseStatus(StrEnum):
    """Mirrors compensation.case_status (миграция 0017)."""

    DRAFT = "draft"
    FINALIZED = "finalized"


class CompensationForm(StrEnum):
    """Mirrors compensation.compensation_form.

    Две формы, и выбор между ними — не техническая настройка, а право
    сотрудника: ТК РФ ст. 152 даёт работнику выбор между повышенной
    оплатой и дополнительным временем отдыха за сверхурочную работу,
    ст. 153 — то же за работу в выходной или праздник. ФЗ-141 ст. 55
    устанавливает аналогичный порядок для сотрудников ФПС.

    Отсюда `EmployeeElection` в модели: система не вправе выбрать за
    человека там, где закон оставляет выбор ему.

    Формы при этом НЕ равноправны. Приказ МЧС России № 410 п. 11
    устанавливает компенсацию в виде дополнительного времени отдыха, а
    п. 18 делает денежную выплату заменой «по просьбе сотрудника»;
    Приказ МЧС России от 27.06.2024 № 539 п. 103 подтверждает это со
    стороны выплаты — «по рапорту сотрудника и на основании решения
    руководителя». `MONETARY` без волеизъявления невозможна, и агрегат
    такую строку отвергает.
    """

    MONETARY = "monetary"
    ADDITIONAL_REST_TIME = "additional_rest_time"


class HourCategory(StrEnum):
    """Mirrors compensation.hour_category (миграция 0017).

    Те же значения, что у `legal_rules.HourCategory` и у категорий
    классификатора в `time_accounting`. Три физически раздельных
    перечисления с общим словарём — как `scheduling.DutyType` и
    `personnel.RegimeType`: общий язык, независимые схемы (разд. 10).

    Domain Model разд. 7.1 называет это поле `RuleCategory`
    («Overtime/Night/Holiday»), но перечисленные там значения —
    категории ЧАСОВ, а не правил; см. п. 1 докстринга миграции 0017.
    """

    NIGHT = "night"
    HOLIDAY = "holiday"
    WEEKEND = "weekend"
    OVERTIME = "overtime"


@dataclass(frozen=True, kw_only=True)
class AccountingPeriod(ValueObject):
    """{начало, конец} — период, за который считается компенсация.

    Без `period_type`, в отличие от `time_accounting`: дело о компенсации
    всегда относится к периоду УТВЕРЖДЁННОГО табеля и берёт его границы
    как есть. Дублировать тип периода значило бы завести второй источник
    истины о том, месячный он или квартальный.
    """

    start: date
    end: date

    def __post_init__(self) -> None:
        if self.end <= self.start:
            raise ValueError("period_end должен быть строго позже period_start")

    def __composite_values__(self) -> tuple[date, date]:
        """Требуется SQLAlchemy `composite()`, чтобы разложить VO обратно
        по колонкам при записи. Порядок обязан совпадать с порядком
        колонок в `composite()` (`orm_mapping._period_factory`)."""
        return self.start, self.end


@dataclass(frozen=True, kw_only=True)
class EmployeeElection(ValueObject):
    """{выбранная форма, дата волеизъявления} — Domain Model разд. 7.1.

    Дата обязательна вместе с формой, а не «полезна»: волеизъявление —
    юридический факт (рапорт сотрудника), и без даты невозможно проверить,
    подан ли он в установленный срок (Алгоритм К шаг 5). Форма без даты
    была бы не выбором сотрудника, а решением системы, записанным его
    именем.
    """

    form: CompensationForm
    elected_at: datetime

    def __post_init__(self) -> None:
        if self.elected_at.tzinfo is None:
            raise ValueError("дата волеизъявления должна быть с таймзоной")


@dataclass(frozen=True, kw_only=True)
class CompensableHours(ValueObject):
    """Часы утверждённого `HoursBreakdown`, доступные для компенсации.

    Проекция чужого расчёта, а не его копия: сюда попадают ровно четыре
    категории Алгоритма К шаг 2, и ничего больше. Норма, факт и
    недоработка компенсации не подлежат и потому отсутствуют — включить
    их значило бы дать возможность начислить компенсацию за норму.
    """

    night_hours: Decimal
    holiday_hours: Decimal
    weekend_hours: Decimal
    overtime_hours: Decimal

    def of(self, category: HourCategory) -> Decimal:
        return {
            HourCategory.NIGHT: self.night_hours,
            HourCategory.HOLIDAY: self.holiday_hours,
            HourCategory.WEEKEND: self.weekend_hours,
            HourCategory.OVERTIME: self.overtime_hours,
        }[category]

    def non_empty_categories(self) -> list[HourCategory]:
        """Алгоритм К шаг 2: «для каждой НЕПУСТОЙ категории часов»."""
        return [c for c in HourCategory if self.of(c) > 0]
