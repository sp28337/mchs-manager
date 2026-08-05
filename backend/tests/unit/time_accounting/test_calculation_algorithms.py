"""TA018/TA021/TA023/TA025 — юнит-тесты Алгоритмов Б, В, Г-Е, Ж, З.

Все пять сервисов — чистые функции своих входов, поэтому здесь нет ни БД,
ни HTTP: если бы для проверки расчёта понадобилась инфраструктура, это
означало бы, что инвариант 6.1.5 («повторный расчёт тех же данных обязан
дать идентичный результат») не выполняется по построению.

Числа в тестах Алгоритма Б сверены с производственным календарём вручную —
этого прямо требует DoD задачи TA018.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from src.building_blocks.domain.time_interval import TimeInterval
from src.modules.time_accounting.application.services.conflict_resolver import (
    ConflictResolutionService,
    UnresolvableCategoryError,
)
from src.modules.time_accounting.application.services.fact_collector import (
    FactCollectorService,
)
from src.modules.time_accounting.application.services.hours_classifier import (
    CalendarGapError,
    ClassifiedIntervals,
    HoursClassificationService,
)
from src.modules.time_accounting.application.services.norm_calculation import (
    NormCalculationService,
)
from src.modules.time_accounting.application.services.overtime_calculator import (
    OvertimeCalculationService,
)
from src.modules.time_accounting.domain.timesheet import Timesheet
from src.modules.time_accounting.domain.value_objects import (
    AccountingPeriod,
    AccountingPeriodType,
    ServiceTimeEventType,
)

MOSCOW = ZoneInfo("Europe/Moscow")
VLADIVOSTOK = ZoneInfo("Asia/Vladivostok")
RULE_VERSION = uuid4()
POLICY_VERSION = uuid4()

pytestmark = pytest.mark.asyncio


def _norm_service(
    weekly_norm: Decimal, counts: dict[str, int]
) -> NormCalculationService:
    async def resolve(_as_of: date, _scope: dict[str, str]) -> tuple[Decimal, object]:
        return weekly_norm, RULE_VERSION

    async def count(_start: date, _end: date) -> dict[str, int]:
        return counts

    return NormCalculationService(resolve, count)  # type: ignore[arg-type]


# ======================================================== Алгоритм Б


async def test_norm_of_a_plain_month_matches_the_production_calendar() -> None:
    """Март 2026: 21 рабочий день, предпраздничных нет.

    Ручная сверка: 40 / 5 × 21 = 168 ч — ровно норма марта 2026 по
    производственному календарю при 40-часовой неделе.
    """
    service = _norm_service(Decimal(40), {"working": 21, "pre_holiday": 0})
    result = await service.calculate(
        period_start=date(2026, 3, 1),
        period_end=date(2026, 4, 1),
        scope={},
        hired_at=date(2020, 1, 1),
    )
    assert result.norm_hours == Decimal("168.00")
    assert result.used_rule_version_id == RULE_VERSION


async def test_a_pre_holiday_day_takes_exactly_one_hour_off() -> None:
    """ТК РФ ст. 95. Февраль 2026: 19 рабочих + 1 предпраздничный (20-е,
    перед 23 февраля) → 40 / 5 × 19 − 1 = 151 ч."""
    service = _norm_service(Decimal(40), {"working": 19, "pre_holiday": 1})
    result = await service.calculate(
        period_start=date(2026, 2, 1),
        period_end=date(2026, 3, 1),
        scope={},
        hired_at=date(2020, 1, 1),
    )
    assert result.norm_hours == Decimal("151.00")


async def test_a_36_hour_week_gives_a_proportionally_smaller_norm() -> None:
    """Вредные и опасные условия — не более 36 ч (ТК РФ ст. 92, ФЗ-141
    ст. 54): 36 / 5 × 21 = 151.2 ч."""
    service = _norm_service(Decimal(36), {"working": 21, "pre_holiday": 0})
    result = await service.calculate(
        period_start=date(2026, 3, 1),
        period_end=date(2026, 4, 1),
        scope={"service_condition_category": "hazardous_or_dangerous"},
        hired_at=date(2020, 1, 1),
    )
    assert result.norm_hours == Decimal("151.20")


async def test_an_employee_hired_mid_period_gets_a_reduced_norm() -> None:
    """Шаг 8: норма считается только по пересечению занятости с периодом.

    Приём 16 марта — заглушка календаря вернёт 11 рабочих дней остатка:
    40 / 5 × 11 = 88 ч.
    """
    service = _norm_service(Decimal(40), {"working": 11, "pre_holiday": 0})
    result = await service.calculate(
        period_start=date(2026, 3, 1),
        period_end=date(2026, 4, 1),
        scope={},
        hired_at=date(2026, 3, 16),
    )
    assert result.norm_hours == Decimal("88.00")
    assert result.counted_from == date(2026, 3, 16)


async def test_the_day_of_dismissal_still_counts_as_service() -> None:
    """Граница берётся следующим днём после увольнения: последний
    служебный день — сам день увольнения, и отнимать его норму значило бы
    объявить этот день недоработкой."""
    service = _norm_service(Decimal(40), {"working": 10, "pre_holiday": 0})
    result = await service.calculate(
        period_start=date(2026, 3, 1),
        period_end=date(2026, 4, 1),
        scope={},
        hired_at=date(2020, 1, 1),
        dismissed_at=date(2026, 3, 13),
    )
    assert result.counted_to == date(2026, 3, 14)


async def test_an_employee_absent_for_the_whole_period_has_zero_norm() -> None:
    """Ноль, но с провенансом: «ноль, потому что не служил» обязан быть
    отличим от «ноль, потому что правило не нашлось»."""
    service = _norm_service(Decimal(40), {"working": 21, "pre_holiday": 0})
    result = await service.calculate(
        period_start=date(2026, 3, 1),
        period_end=date(2026, 4, 1),
        scope={},
        hired_at=date(2020, 1, 1),
        dismissed_at=date(2026, 1, 20),
    )
    assert result.norm_hours == Decimal(0)
    assert result.used_rule_version_id == RULE_VERSION


# ======================================================== Алгоритм В


def _march_timesheet() -> Timesheet:
    return Timesheet.open_for(
        employee_id=uuid4(),
        period=AccountingPeriod(
            period_type=AccountingPeriodType.MONTH,
            start=date(2026, 3, 1),
            end=date(2026, 4, 1),
        ),
    )


def _interval(day: int, hour: int, *, hours: int, month: int = 3) -> TimeInterval:
    start = datetime(2026, month, day, hour, tzinfo=MOSCOW)
    return TimeInterval(start=start, end=start + timedelta(hours=hours))


async def test_facts_are_split_into_the_two_groups_and_summed() -> None:
    sheet = _march_timesheet()
    sheet.register_event(
        event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=_interval(2, 8, hours=24)
    )
    sheet.register_event(
        event_type=ServiceTimeEventType.BUSINESS_TRIP,
        time_range=_interval(5, 8, hours=8),
        business_trip_place="Тверь",
    )
    sheet.register_event(
        event_type=ServiceTimeEventType.SICKNESS, time_range=_interval(10, 0, hours=48)
    )

    facts = FactCollectorService().collect(timesheet=sheet, planned_intervals=[])
    assert facts.actual_minutes_total == (24 + 8) * 60
    assert len(facts.service_intervals) == 2
    # Плановых смен нет — объяснять нечего.
    assert facts.explained_absence_minutes == 0


async def test_sickness_only_explains_the_part_overlapping_planned_shifts() -> None:
    """Ключевое место Алгоритма В шаг 6: болезнь в дни, когда сотрудник и
    так не дежурил, недоработки не объясняет — её там нет."""
    sheet = _march_timesheet()
    sheet.register_event(
        event_type=ServiceTimeEventType.SICKNESS, time_range=_interval(10, 0, hours=72)
    )
    # Плановая смена внутри болезни — сутки с 11-го 08:00.
    planned = [_interval(11, 8, hours=24)]

    facts = FactCollectorService().collect(timesheet=sheet, planned_intervals=planned)
    assert facts.explained_absence_minutes == 24 * 60


async def test_sickness_entirely_outside_the_schedule_explains_nothing() -> None:
    sheet = _march_timesheet()
    sheet.register_event(
        event_type=ServiceTimeEventType.SICKNESS, time_range=_interval(10, 0, hours=24)
    )
    facts = FactCollectorService().collect(
        timesheet=sheet, planned_intervals=[_interval(20, 8, hours=24)]
    )
    assert facts.explained_absence_minutes == 0


# ==================================================== Алгоритмы Г, Д, Е


def _day_types(**overrides: str) -> dict[date, str]:
    """Март 2026 целиком плюс запас в обе стороны — рабочие дни, если не
    сказано иное."""
    days: dict[date, str] = {}
    day = date(2026, 2, 25)
    while day <= date(2026, 4, 5):
        days[day] = "working"
        day += timedelta(days=1)
    for iso, day_type in overrides.items():
        days[date.fromisoformat(iso.replace("d", "").replace("_", "-"))] = day_type
    return days


async def test_a_24_hour_duty_gets_exactly_eight_night_hours() -> None:
    """Суточное дежурство с 08:00 2 марта до 08:00 3 марта пересекает
    ночное окно `[2 марта 22:00, 3 марта 06:00)` целиком — 8 часов."""
    classified = HoursClassificationService().classify(
        service_intervals=[_interval(2, 8, hours=24)],
        day_types=_day_types(),
        time_zone=MOSCOW,
    )
    assert _total_hours(classified.night) == 8


async def test_a_night_shift_crossing_midnight_is_split_correctly() -> None:
    """Смена 20:00-08:00 даёт 2 ч до полуночи (22:00-00:00) и 6 ч после
    (00:00-06:00) — ровно 8, а не 12: с 20:00 до 22:00 ещё не ночь."""
    classified = HoursClassificationService().classify(
        service_intervals=[_interval(2, 20, hours=12)],
        day_types=_day_types(),
        time_zone=MOSCOW,
    )
    assert _total_hours(classified.night) == 8


async def test_a_day_shift_has_no_night_hours() -> None:
    classified = HoursClassificationService().classify(
        service_intervals=[_interval(2, 8, hours=8)],
        day_types=_day_types(),
        time_zone=MOSCOW,
    )
    assert classified.night == []


async def test_night_hours_are_reckoned_in_the_units_own_time_zone() -> None:
    """То, ради чего пояс стал свойством подразделения: та же смена по
    московским часам ночная, по владивостокским — нет."""
    interval = TimeInterval(
        start=datetime(2026, 3, 2, 22, tzinfo=MOSCOW),
        end=datetime(2026, 3, 3, 2, tzinfo=MOSCOW),
    )
    in_moscow = HoursClassificationService().classify(
        service_intervals=[interval], day_types=_day_types(), time_zone=MOSCOW
    )
    in_vladivostok = HoursClassificationService().classify(
        service_intervals=[interval], day_types=_day_types(), time_zone=VLADIVOSTOK
    )
    assert _total_hours(in_moscow.night) == 4
    # Во Владивостоке это 3 марта 05:00-09:00: ночным считается только час
    # до 06:00.
    assert _total_hours(in_vladivostok.night) == 1


async def test_a_holiday_shift_is_classified_by_the_calendar() -> None:
    days = _day_types()
    days[date(2026, 3, 9)] = "holiday"
    classified = HoursClassificationService().classify(
        service_intervals=[_interval(9, 8, hours=24)],
        day_types=days,
        time_zone=MOSCOW,
    )
    # 16 ч приходится на 9 марта, 8 ч — на 10-е (рабочий).
    assert _total_hours(classified.holiday) == 16


async def test_a_pre_holiday_day_is_not_a_holiday() -> None:
    """Самая дорогая из возможных здесь ошибок: предпраздничный день
    влияет только на норму (Алгоритм Б), но праздничным не является."""
    days = _day_types()
    days[date(2026, 3, 6)] = "pre_holiday"
    classified = HoursClassificationService().classify(
        service_intervals=[_interval(6, 8, hours=8)],
        day_types=days,
        time_zone=MOSCOW,
    )
    assert classified.holiday == []


async def test_a_24_hour_duty_on_a_pre_holiday_day_is_classified_correctly() -> None:
    """DoD TA021: суточное дежурство в предпраздничный день. С 08:00
    предпраздничного 6 марта до 08:00 праздничного 7-го: праздничных 8 ч
    (полночь-08:00), ночных 8 ч (22:00-06:00), а предпраздничный статус на
    классификацию не влияет вовсе."""
    days = _day_types()
    days[date(2026, 3, 6)] = "pre_holiday"
    days[date(2026, 3, 7)] = "holiday"
    classified = HoursClassificationService().classify(
        service_intervals=[_interval(6, 8, hours=24)],
        day_types=days,
        time_zone=MOSCOW,
    )
    assert _total_hours(classified.holiday) == 8
    assert _total_hours(classified.night) == 8


async def test_a_weekend_shift_is_classified_by_the_calendar() -> None:
    days = _day_types()
    days[date(2026, 3, 7)] = "weekend"
    classified = HoursClassificationService().classify(
        service_intervals=[_interval(7, 8, hours=8)],
        day_types=days,
        time_zone=MOSCOW,
    )
    assert _total_hours(classified.weekend) == 8


async def test_a_fact_on_a_date_missing_from_the_calendar_is_refused() -> None:
    """Пробел в календаре — отсутствие нормативного основания, а не повод
    считать день рабочим."""
    with pytest.raises(CalendarGapError):
        HoursClassificationService().classify(
            service_intervals=[_interval(2, 8, hours=8)],
            day_types={},
            time_zone=MOSCOW,
        )


def _total_hours(intervals: list[TimeInterval]) -> float:
    return sum(i.duration_hours() for i in intervals)


# ======================================================== Алгоритм Ж


async def test_an_hour_that_is_both_night_and_holiday_goes_to_exactly_one() -> None:
    """DoD TA023: задвоение компенсации невозможно."""
    overlap = _interval(1, 0, hours=6)  # 00:00-06:00 — и ночь, и праздник
    resolved = ConflictResolutionService().resolve(
        classified=ClassifiedIntervals(night=[overlap], holiday=[overlap], weekend=[]),
        precedence_list=["holiday", "weekend", "night"],
        policy_version_id=POLICY_VERSION,
    )
    assert resolved.hours_of("holiday") == Decimal("6.00")
    assert resolved.hours_of("night") == Decimal("0.00")
    # Сумма компенсируемых часов равна фактической длительности, а не
    # удвоенной — в этом всё содержание Алгоритма Ж.
    assert sum(resolved.hours_by_category.values()) == Decimal("6.00")


async def test_precedence_order_decides_which_category_wins() -> None:
    overlap = _interval(1, 0, hours=6)
    resolved = ConflictResolutionService().resolve(
        classified=ClassifiedIntervals(night=[overlap], holiday=[overlap], weekend=[]),
        precedence_list=["night", "holiday"],
        policy_version_id=POLICY_VERSION,
    )
    assert resolved.hours_of("night") == Decimal("6.00")
    assert resolved.hours_of("holiday") == Decimal("0.00")


async def test_partially_overlapping_categories_are_split_at_the_boundary() -> None:
    """Смена с 22:00 1 марта до 06:00 2 марта, где 2 марта праздничное:
    ночная целиком, праздничная только после полуночи. Первые два часа
    остаются ночными, остальные шесть уходят празднику.

    Оба интервала ограничены фактом — так их и выдаёт классификатор: он
    возвращает пересечения факта с окнами, а не сами окна. Взять здесь
    праздничные сутки целиком значило бы проверять набор, которого
    пайплайн не производит.
    """
    night = TimeInterval(
        start=datetime(2026, 3, 1, 22, tzinfo=MOSCOW),
        end=datetime(2026, 3, 2, 6, tzinfo=MOSCOW),
    )
    holiday = TimeInterval(
        start=datetime(2026, 3, 2, 0, tzinfo=MOSCOW),
        end=datetime(2026, 3, 2, 6, tzinfo=MOSCOW),
    )
    resolved = ConflictResolutionService().resolve(
        classified=ClassifiedIntervals(night=[night], holiday=[holiday], weekend=[]),
        precedence_list=["holiday", "weekend", "night"],
        policy_version_id=POLICY_VERSION,
    )
    assert resolved.hours_of("night") == Decimal("2.00")
    assert resolved.hours_of("holiday") == Decimal("6.00")
    assert resolved.overlapping_hours == Decimal("6.00")


async def test_non_overlapping_categories_keep_their_own_hours() -> None:
    resolved = ConflictResolutionService().resolve(
        classified=ClassifiedIntervals(
            night=[_interval(2, 22, hours=8)],
            holiday=[_interval(9, 0, hours=24)],
            weekend=[],
        ),
        precedence_list=["holiday", "weekend", "night"],
        policy_version_id=POLICY_VERSION,
    )
    assert resolved.hours_of("night") == Decimal("8.00")
    assert resolved.hours_of("holiday") == Decimal("24.00")
    assert resolved.overlapping_hours == Decimal("0.00")


async def test_a_category_absent_from_the_policy_is_an_error_not_a_zero() -> None:
    resolved_with = ConflictResolutionService()
    with pytest.raises(UnresolvableCategoryError):
        resolved_with.resolve(
            classified=ClassifiedIntervals(
                night=[_interval(2, 22, hours=8)], holiday=[], weekend=[]
            ),
            precedence_list=["holiday", "weekend"],
            policy_version_id=POLICY_VERSION,
        )


async def test_overtime_in_the_precedence_list_is_ignored_here() -> None:
    """Переработка — свойство периода, а не часа: её позиция в списке на
    разбиение шкалы влиять не может."""
    overlap = _interval(1, 0, hours=6)
    resolved = ConflictResolutionService().resolve(
        classified=ClassifiedIntervals(night=[overlap], holiday=[overlap], weekend=[]),
        precedence_list=["overtime", "holiday", "night"],
        policy_version_id=POLICY_VERSION,
    )
    assert resolved.hours_of("holiday") == Decimal("6.00")


# ======================================================== Алгоритм З


async def test_working_more_than_the_norm_is_overtime() -> None:
    result = OvertimeCalculationService().calculate(
        norm_hours=Decimal("168.00"),
        actual_minutes_total=180 * 60,
        explained_absence_minutes=0,
    )
    assert result.overtime_hours == Decimal("12.00")
    assert result.underworked_hours == Decimal("0.00")


async def test_a_shortfall_fully_covered_by_sickness_is_explained() -> None:
    """DoD TA024: недоработка, покрытая больничным, помечена как
    explained — инвариант 6.1.3."""
    result = OvertimeCalculationService().calculate(
        norm_hours=Decimal("168.00"),
        actual_minutes_total=144 * 60,
        explained_absence_minutes=24 * 60,
    )
    assert result.underworked_hours == Decimal("24.00")
    assert result.underworked_explained_hours == Decimal("24.00")
    assert result.underworked_unexplained_hours == Decimal("0.00")


async def test_a_partially_explained_shortfall_is_split() -> None:
    """DoD TA025."""
    result = OvertimeCalculationService().calculate(
        norm_hours=Decimal("168.00"),
        actual_minutes_total=144 * 60,
        explained_absence_minutes=10 * 60,
    )
    assert result.underworked_hours == Decimal("24.00")
    assert result.underworked_explained_hours == Decimal("10.00")
    assert result.underworked_unexplained_hours == Decimal("14.00")


async def test_sickness_longer_than_the_shortfall_does_not_overshoot() -> None:
    """Больничный длиннее недоработки не превращает её в переработку и не
    уводит объяснённую часть выше самой недоработки."""
    result = OvertimeCalculationService().calculate(
        norm_hours=Decimal("168.00"),
        actual_minutes_total=160 * 60,
        explained_absence_minutes=100 * 60,
    )
    assert result.underworked_hours == Decimal("8.00")
    assert result.underworked_explained_hours == Decimal("8.00")


async def test_overtime_and_shortfall_are_never_both_positive() -> None:
    for actual in (100, 168, 200):
        result = OvertimeCalculationService().calculate(
            norm_hours=Decimal("168.00"),
            actual_minutes_total=actual * 60,
            explained_absence_minutes=0,
        )
        assert result.overtime_hours == 0 or result.underworked_hours == 0


async def test_utc_input_gives_the_same_answer_as_moscow_input() -> None:
    """Инвариант 6.1.5 в самой прямой форме: результат зависит от моментов
    времени, а не от того, в каком представлении их записали."""
    in_moscow = [_interval(2, 8, hours=24)]
    in_utc = [
        TimeInterval(
            start=datetime(2026, 3, 2, 5, tzinfo=UTC), end=datetime(2026, 3, 3, 5, tzinfo=UTC)
        )
    ]
    service = HoursClassificationService()
    assert _total_hours(
        service.classify(
            service_intervals=in_moscow, day_types=_day_types(), time_zone=MOSCOW
        ).night
    ) == _total_hours(
        service.classify(
            service_intervals=in_utc, day_types=_day_types(), time_zone=MOSCOW
        ).night
    )
