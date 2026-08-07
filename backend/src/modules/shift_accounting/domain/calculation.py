"""Расчёт нормы и переработки при суммированном учёте.

--- Что здесь считается и зачем ----------------------------------------

Ровно то, вокруг чего возникают споры с работодателем. Порядок такой:

1. НОРМА УЧЁТНОГО ПЕРИОДА — сколько часов человек должен отработать,
   если бы работал по пятидневке: недельная норма, делённая на пять, на
   число рабочих дней производственного календаря, минус по часу за
   каждый предпраздничный день (ст. 95 ТК РФ).

2. ИСКЛЮЧЕНИЕ ОТСУТСТВИЙ — из нормы вычитаются часы ПО ГРАФИКУ,
   пришедшиеся на отпуск, больничный и иное освобождение с сохранением
   места работы (письмо Роструда от 01.03.2010 № 550-6-1).

3. ПЕРЕРАБОТКА — то, что отработано сверх уменьшенной нормы.

--- Ошибка, ради обнаружения которой всё это написано ------------------

Пункт 2 нарушают двумя способами, и оба дают одинаковый результат — у
человека отнимают часы, которые он не должен:

* норму оставляют полной, а из ФАКТА вычитают смены, попавшие в отпуск
  («минус 24 часа за смену»). Отпуск превращается в долг;
* норму оставляют полной и просто не отрабатывают отсутствие — тогда
  возникает недоработка, которой нет.

Обе ошибки видны только тогда, когда норма и факт показаны раздельно и
рядом названа величина исключённых часов. Поэтому результат расчёта
несёт все три числа, а не одну итоговую разницу.

--- Чего здесь нет -----------------------------------------------------

Компенсации. Приказ МЧС России № 410 п. 14 прямо говорит: при
суммированном учёте (должности с посменным несением дежурства) ночные,
выходные и праздничные часы В ПРЕДЕЛАХ нормы дополнительным временем
отдыха не компенсируются. Показывать их как «положено сверху» значило бы
обещать то, чего норма не даёт. Ночные часы считаются и показываются —
но как факт, а не как основание для доплаты.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from src.modules.shift_accounting.domain.value_objects import (
    NIGHT_HOURS_PER_SHIFT,
    SHIFT_DURATION_HOURS,
    SHIFT_START_HOUR,
    GuardCycle,
    WeeklyNorm,
)

WORKING_DAYS_PER_WEEK = Decimal("5")
PRE_HOLIDAY_REDUCTION_HOURS = Decimal("1")
"""Ст. 95 ТК РФ: рабочий день накануне праздника короче на час."""


@dataclass(frozen=True)
class CalendarFacts:
    """То, что даёт производственный календарь за период.

    Домен не ходит в базу: календарь передаётся сюда уже посчитанным.
    """

    working_days: int
    """Рабочие дни периода, ВКЛЮЧАЯ предпраздничные.

    Предпраздничный день — рабочий, сокращённый на час (ст. 95 ТК РФ), и
    производственный календарь считает его среди рабочих: в апреле 2026
    года 22 рабочих дня и 175 часов, то есть 22 × 8 − 1, а не 21 × 8.
    Исключить его отсюда значило бы вычесть за него девять часов вместо
    одного — по восемь часов нормы за каждый такой день в году.
    """

    pre_holiday_days: int
    """Сколько из `working_days` сокращены на час."""


@dataclass(frozen=True)
class AbsencePeriod:
    """Отсутствие с сохранением места службы или работы.

    Границы ВКЛЮЧИТЕЛЬНЫЕ — так их пишут в приказе об отпуске и в
    больничном листе. Полуинтервалы, принятые в остальном коде, здесь
    были бы источником ошибки на один день ровно там, где цена ошибки —
    сутки чужого отдыха.
    """

    start: date
    end_inclusive: date
    kind: str

    def covers(self, day: date) -> bool:
        return self.start <= day <= self.end_inclusive


@dataclass(frozen=True)
class ShiftRecord:
    """Одна смена в расчёте."""

    started_on: date
    hours: Decimal
    night_hours: Decimal
    holiday_hours: Decimal
    absence_kind: str | None = None

    @property
    def is_worked(self) -> bool:
        return self.absence_kind is None


@dataclass(frozen=True)
class PeriodCalculation:
    """Итог расчёта за учётный период."""

    period_start: date
    period_end: date

    weekly_norm: WeeklyNorm
    calendar: CalendarFacts

    base_norm_hours: Decimal
    """Норма периода без учёта отсутствий."""

    excluded_hours: Decimal
    """Часы по графику, пришедшиеся на отсутствия. Вычитаются из нормы."""

    norm_hours: Decimal
    """Норма к отработке: `base_norm_hours - excluded_hours`."""

    actual_hours: Decimal
    """Фактически отработано."""

    night_hours: Decimal
    holiday_hours: Decimal

    scheduled_shifts: int
    worked_shifts: int
    absent_shifts: int

    shifts: list[ShiftRecord] = field(default_factory=list)

    @property
    def overtime_hours(self) -> Decimal:
        """Переработка. Ноль, если её нет, — отрицательной переработки не бывает."""
        difference = self.actual_hours - self.norm_hours
        return difference if difference > 0 else Decimal("0")

    @property
    def undertime_hours(self) -> Decimal:
        """Недоработка."""
        difference = self.norm_hours - self.actual_hours
        return difference if difference > 0 else Decimal("0")

    @property
    def wrong_norm_undertime_hours(self) -> Decimal:
        """Недоработка, которая получилась бы при НЕуменьшенной норме.

        Это не наш расчёт, а воспроизведение чужой ошибки: столько
        «долга» увидит человек, если отсутствия из нормы не исключили.
        Величина нужна, чтобы назвать цену расхождения — не «считают
        неверно», а «неверно на столько-то часов».
        """
        difference = self.base_norm_hours - self.actual_hours
        return difference if difference > 0 else Decimal("0")


def base_norm_hours(weekly: WeeklyNorm, calendar: CalendarFacts) -> Decimal:
    """Норма периода по производственному календарю.

    `(недельная норма / 5) × рабочие дни − 1 час × предпраздничные дни`.

    Формула — общая для пятидневки и для сменного режима: при
    суммированном учёте норма СМЕННИКА равна норме обычной пятидневки за
    тот же период (ст. 104 ТК РФ). Это ровно то, что делает график
    «сутки через трое» пригодным к проверке: часы в нём другие, а норма
    та же.
    """
    daily = weekly.hours / WORKING_DAYS_PER_WEEK
    return daily * Decimal(calendar.working_days) - (
        PRE_HOLIDAY_REDUCTION_HOURS * Decimal(calendar.pre_holiday_days)
    )


def _hours_in_period(started_on: date, period_start: date, period_end: date) -> Decimal:
    """Часы смены, попадающие в полуинтервал `[period_start, period_end)`.

    Смена начинается в 08:00 и идёт сутки, поэтому 16 её часов лежат в
    сутках заступления, а 8 — в следующих. На границе месяца это
    существенно: смена, заступившая 31 марта, даёт марту 16 часов, а
    апрелю 8. Списывать все 24 на день заступления удобно, но неверно —
    и расхождение с табелем работодателя возникло бы на ровном месте.
    """
    first_day_hours = Decimal(24 - SHIFT_START_HOUR)  # 08:00 -> 24:00
    second_day_hours = SHIFT_DURATION_HOURS - first_day_hours  # 00:00 -> 08:00

    total = Decimal("0")
    if period_start <= started_on < period_end:
        total += first_day_hours
    next_day = started_on + timedelta(days=1)
    if period_start <= next_day < period_end:
        total += second_day_hours
    return total


def calculate_period(
    *,
    period_start: date,
    period_end: date,
    cycle: GuardCycle,
    weekly: WeeklyNorm,
    calendar: CalendarFacts,
    absences: list[AbsencePeriod],
    holiday_days: frozenset[date],
) -> PeriodCalculation:
    """Полный расчёт периода по графику караула.

    `period_end` — исключающая граница, как во всём коде. `holiday_days`
    — нерабочие праздничные дни календаря: часы, пришедшиеся на них,
    считаются и показываются отдельно, хотя при суммированном учёте в
    пределах нормы отдельной компенсации не дают (Приказ № 410 п. 14).
    """
    shifts: list[ShiftRecord] = []
    excluded = Decimal("0")
    actual = Decimal("0")
    night_total = Decimal("0")
    holiday_total = Decimal("0")

    # Просмотр начинается на СУТКИ РАНЬШЕ периода: смена, заступившая
    # накануне, отдаёт периоду свои последние 8 часов (с 00:00 до 08:00).
    # Начинать ровно с `period_start` значило бы терять их у каждого
    # месяца, чей первый день — второй день чужой смены.
    #
    # Но не раньше первой смены года: цикл объявлен человеком на год, и
    # достраивать его в прошлый год значило бы выдумать смену, которой в
    # этом графике нет.
    scan_from = max(period_start - timedelta(days=1), cycle.first_shift_date)

    for started_on in cycle.shift_dates(scan_from, period_end):
        hours = _hours_in_period(started_on, period_start, period_end)
        if hours == 0:
            continue

        absence = next((a for a in absences if a.covers(started_on)), None)

        # Ночные и праздничные часы считаются пропорционально той части
        # смены, что попала в период: иначе смена на стыке месяцев дала
        # бы 8 ночных часов дважды.
        share = hours / SHIFT_DURATION_HOURS
        night = NIGHT_HOURS_PER_SHIFT * share
        next_day = started_on + timedelta(days=1)
        holiday = Decimal("0")
        if started_on in holiday_days:
            holiday += Decimal(24 - SHIFT_START_HOUR)
        if next_day in holiday_days:
            holiday += SHIFT_DURATION_HOURS - Decimal(24 - SHIFT_START_HOUR)

        record = ShiftRecord(
            started_on=started_on,
            hours=hours,
            night_hours=night,
            holiday_hours=holiday,
            absence_kind=absence.kind if absence else None,
        )
        shifts.append(record)

        if absence is None:
            actual += hours
            night_total += night
            holiday_total += holiday
        else:
            excluded += hours

    base = base_norm_hours(weekly, calendar)
    # Норма не уходит в минус: длительное отсутствие может перекрыть
    # период целиком, и отрицательная норма означала бы, что человек
    # обязан «недоработать».
    norm = base - excluded
    if norm < 0:
        norm = Decimal("0")

    worked = sum(1 for shift in shifts if shift.is_worked)
    return PeriodCalculation(
        period_start=period_start,
        period_end=period_end,
        weekly_norm=weekly,
        calendar=calendar,
        base_norm_hours=base,
        excluded_hours=excluded,
        norm_hours=norm,
        actual_hours=actual,
        night_hours=night_total,
        holiday_hours=holiday_total,
        scheduled_shifts=len(shifts),
        worked_shifts=worked,
        absent_shifts=len(shifts) - worked,
        shifts=shifts,
    )
