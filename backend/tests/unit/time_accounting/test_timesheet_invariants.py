"""TA002 — инварианты агрегата `Timesheet` (Domain Model разд. 6.1).

Ни БД, ни фикстур: агрегат обязан отказывать сам, до всякого SQL.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from src.building_blocks.domain.time_interval import TimeInterval
from src.modules.time_accounting.application.services.daily_service_time_limit import (
    DailyServiceTimeLimitService,
    minutes_per_day,
)
from src.modules.time_accounting.domain.errors import (
    BusinessTripWithoutPlaceError,
    CorrectionTargetNotFoundError,
    DailyServiceTimeLimitExceededError,
    EventOutsideTimesheetPeriodError,
    OverlappingServiceTimeEventError,
    TimesheetApprovedError,
    TimesheetReopenError,
)
from src.modules.time_accounting.domain.events import (
    ShiftActuallyPerformed,
    SicknessRegistered,
    TimesheetApproved,
    TimesheetReopened,
)
from src.modules.time_accounting.domain.timesheet import Timesheet
from src.modules.time_accounting.domain.value_objects import (
    AccountingPeriod,
    AccountingPeriodType,
    ServiceTimeEventType,
    TimesheetStatus,
)

MOSCOW = ZoneInfo("Europe/Moscow")
VLADIVOSTOK = ZoneInfo("Asia/Vladivostok")


def march_2026() -> AccountingPeriod:
    return AccountingPeriod(
        period_type=AccountingPeriodType.MONTH,
        start=date(2026, 3, 1),
        end=date(2026, 4, 1),
    )


def timesheet() -> Timesheet:
    return Timesheet.open_for(employee_id=uuid4(), period=march_2026())


def moment(day: int, hour: int) -> datetime:
    return datetime(2026, 3, day, hour, tzinfo=MOSCOW)


def shift(day: int, hour: int, *, hours: int = 8) -> TimeInterval:
    start = moment(day, hour)
    return TimeInterval(start=start, end=start + timedelta(hours=hours))


# ------------------------------------------------------- инвариант 6.1.1


def test_two_non_overlapping_events_are_both_registered() -> None:
    sheet = timesheet()
    sheet.register_event(event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(2, 8))
    sheet.register_event(event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(3, 8))
    assert len(sheet.events) == 2


def test_a_third_overlapping_event_is_refused() -> None:
    sheet = timesheet()
    sheet.register_event(event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(2, 8))
    sheet.register_event(event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(3, 8))

    with pytest.raises(OverlappingServiceTimeEventError):
        sheet.register_event(
            event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(3, 12)
        )
    assert len(sheet.events) == 2


def test_events_of_different_types_may_not_overlap_either() -> None:
    """Инвариант 6.1.1 не про тип: один момент не бывает одновременно и
    болезнью, и сменой. «Смена прервана болезнью» — это разбиение."""
    sheet = timesheet()
    sheet.register_event(event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(2, 8))

    with pytest.raises(OverlappingServiceTimeEventError):
        sheet.register_event(
            event_type=ServiceTimeEventType.SICKNESS, time_range=shift(2, 12, hours=48)
        )


def test_an_interrupted_shift_is_recorded_as_two_adjacent_events() -> None:
    """Тот же случай, оформленный правильно: смена 08:00-12:00, дальше
    болезнь с 12:00. Стык не считается пересечением — интервалы
    полуоткрытые."""
    sheet = timesheet()
    sheet.register_event(
        event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(2, 8, hours=4)
    )
    sheet.register_event(
        event_type=ServiceTimeEventType.SICKNESS, time_range=shift(2, 12, hours=12)
    )
    assert len(sheet.events) == 2


# ------------------------------------------------------- инвариант 6.1.6


def test_a_day_over_24_hours_is_refused_by_the_domain_service() -> None:
    """Два табеля одного сотрудника: мартовский держит суточное дежурство
    с 31-го, апрельский пытается добавить смену, накрывающую его хвост."""
    service = DailyServiceTimeLimitService()
    employee = uuid4()

    march_31 = TimeInterval(
        start=datetime(2026, 3, 31, 8, tzinfo=MOSCOW), end=datetime(2026, 4, 1, 8, tzinfo=MOSCOW)
    )
    overlapping = TimeInterval(
        start=datetime(2026, 4, 1, 0, tzinfo=MOSCOW), end=datetime(2026, 4, 1, 20, tzinfo=MOSCOW)
    )

    with pytest.raises(DailyServiceTimeLimitExceededError) as excinfo:
        service.ensure_within_daily_limit(
            employee_id=employee,
            candidate=overlapping,
            existing_shifts=[march_31],
            time_zone=MOSCOW,
        )
    assert "2026-04-01" in str(excinfo.value)


def test_a_shift_starting_exactly_when_the_previous_ends_is_allowed() -> None:
    """Ровно 24 ч за сутки — предел, а не превышение."""
    service = DailyServiceTimeLimitService()
    first = TimeInterval(
        start=datetime(2026, 4, 1, 0, tzinfo=MOSCOW), end=datetime(2026, 4, 1, 12, tzinfo=MOSCOW)
    )
    second = TimeInterval(
        start=datetime(2026, 4, 1, 12, tzinfo=MOSCOW), end=datetime(2026, 4, 2, 0, tzinfo=MOSCOW)
    )
    service.ensure_within_daily_limit(
        employee_id=uuid4(), candidate=second, existing_shifts=[first], time_zone=MOSCOW
    )


def test_within_one_timesheet_the_limit_cannot_be_violated_at_all() -> None:
    """Смысл проверки — в том, что внутри одного табеля она бессодержательна:
    любой набор, который мог бы её нарушить, уже отклонён инвариантом 6.1.1."""
    sheet = timesheet()
    sheet.register_event(
        event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(2, 0, hours=20)
    )
    with pytest.raises(OverlappingServiceTimeEventError):
        sheet.register_event(
            event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(2, 10, hours=10)
        )

    service = DailyServiceTimeLimitService()
    service.ensure_within_daily_limit(
        employee_id=sheet.employee_id,
        candidate=shift(2, 20, hours=4),
        existing_shifts=[e.time_range for e in sheet.actual_shift_events()],
        time_zone=MOSCOW,
    )


def test_a_24_hour_duty_is_split_across_two_days() -> None:
    duty = TimeInterval(
        start=datetime(2026, 3, 31, 8, tzinfo=MOSCOW), end=datetime(2026, 4, 1, 8, tzinfo=MOSCOW)
    )
    per_day = minutes_per_day([duty], time_zone=MOSCOW)
    assert per_day[date(2026, 3, 31)] == 16 * 60
    assert per_day[date(2026, 4, 1)] == 8 * 60


def test_the_same_duty_splits_differently_in_another_time_zone() -> None:
    """Ровно то, ради чего пояс стал свойством подразделения (миграция
    0016): те же 24 часа во Владивостоке приходятся на другие сутки."""
    duty = TimeInterval(
        start=datetime(2026, 3, 31, 8, tzinfo=MOSCOW), end=datetime(2026, 4, 1, 8, tzinfo=MOSCOW)
    )
    per_day = minutes_per_day([duty], time_zone=VLADIVOSTOK)
    assert per_day[date(2026, 3, 31)] == 9 * 60
    assert per_day[date(2026, 4, 1)] == 15 * 60


# ---------------------------------------------------------- границы периода


def test_an_event_starting_before_the_period_is_refused() -> None:
    sheet = timesheet()
    with pytest.raises(EventOutsideTimesheetPeriodError):
        sheet.register_event(
            event_type=ServiceTimeEventType.ACTUAL_SHIFT,
            time_range=TimeInterval(
                start=datetime(2026, 2, 28, 8, tzinfo=MOSCOW),
                end=datetime(2026, 3, 1, 8, tzinfo=MOSCOW),
            ),
        )


def test_an_event_starting_inside_the_period_may_end_outside_it() -> None:
    """Алгоритм И шаг 4: табель периода может содержать событие,
    физически заканчивающееся уже в следующем месяце."""
    sheet = timesheet()
    event = sheet.register_event(
        event_type=ServiceTimeEventType.ACTUAL_SHIFT,
        time_range=TimeInterval(
            start=datetime(2026, 3, 31, 8, tzinfo=MOSCOW),
            end=datetime(2026, 4, 1, 8, tzinfo=MOSCOW),
        ),
    )
    assert event.time_range.end.date() == date(2026, 4, 1)


# ------------------------------------------------- командировка и место


def test_a_business_trip_without_a_place_is_refused() -> None:
    sheet = timesheet()
    with pytest.raises(BusinessTripWithoutPlaceError):
        sheet.register_event(
            event_type=ServiceTimeEventType.BUSINESS_TRIP, time_range=shift(2, 8)
        )


def test_a_blank_place_does_not_count_as_a_place() -> None:
    sheet = timesheet()
    with pytest.raises(BusinessTripWithoutPlaceError):
        sheet.register_event(
            event_type=ServiceTimeEventType.BUSINESS_TRIP,
            time_range=shift(2, 8),
            business_trip_place="   ",
        )


def test_a_business_trip_with_a_place_is_registered() -> None:
    sheet = timesheet()
    event = sheet.register_event(
        event_type=ServiceTimeEventType.BUSINESS_TRIP,
        time_range=shift(2, 8),
        business_trip_place="Пожарно-спасательный центр, г. Тверь",
    )
    assert event.counts_as_service_time


# ------------------------------------------------------- инвариант 6.1.4


def test_an_approved_timesheet_refuses_new_events() -> None:
    sheet = timesheet()
    sheet.register_event(event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(2, 8))
    sheet.approve()

    with pytest.raises(TimesheetApprovedError):
        sheet.register_event(event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(4, 8))


def test_approving_twice_is_refused_rather_than_idempotent() -> None:
    sheet = timesheet()
    sheet.approve()
    with pytest.raises(TimesheetApprovedError):
        sheet.approve()


def test_reopening_requires_a_meaningful_reason() -> None:
    sheet = timesheet()
    sheet.approve()
    with pytest.raises(TimesheetReopenError):
        sheet.reopen(reason="ошибка")


def test_reopening_an_open_timesheet_is_refused() -> None:
    with pytest.raises(TimesheetReopenError):
        timesheet().reopen(reason="исправление данных за период")


def test_a_reopened_timesheet_accepts_events_and_can_be_approved_again() -> None:
    sheet = timesheet()
    sheet.approve()
    sheet.reopen(reason="обнаружена незарегистрированная смена 15 марта")

    assert sheet.status == TimesheetStatus.REOPENED
    sheet.register_event(event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(15, 8))
    sheet.approve()
    assert sheet.status == TimesheetStatus.APPROVED


def test_the_period_of_a_timesheet_cannot_be_changed() -> None:
    sheet = timesheet()
    with pytest.raises(TimesheetApprovedError):
        sheet.period = AccountingPeriod(
            period_type=AccountingPeriodType.MONTH,
            start=date(2026, 4, 1),
            end=date(2026, 5, 1),
        )


def test_the_employee_of_a_timesheet_cannot_be_changed() -> None:
    sheet = timesheet()
    with pytest.raises(TimesheetApprovedError):
        sheet.employee_id = uuid4()


# ------------------------------------------------------------ исправления


def test_a_correction_points_at_an_event_of_this_timesheet() -> None:
    sheet = timesheet()
    event = sheet.register_event(
        event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(2, 8)
    )
    entry = sheet.correct(
        original_event_id=event.id,
        reason="смена зарегистрирована с ошибкой во времени окончания",
        created_by=uuid4(),
    )
    assert entry.original_event_id == event.id
    # Исходная запись не изменена и не удалена — append-only.
    assert sheet.events == [event]


def test_a_correction_of_a_foreign_event_is_refused() -> None:
    sheet = timesheet()
    with pytest.raises(CorrectionTargetNotFoundError):
        sheet.correct(
            original_event_id=uuid4(),
            reason="исправление чужого события",
            created_by=uuid4(),
        )


def test_a_correction_needs_a_meaningful_reason() -> None:
    sheet = timesheet()
    event = sheet.register_event(
        event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(2, 8)
    )
    with pytest.raises(ValueError, match="минимум"):
        sheet.correct(original_event_id=event.id, reason="ошибка", created_by=uuid4())


def test_an_approved_timesheet_refuses_corrections() -> None:
    sheet = timesheet()
    event = sheet.register_event(
        event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(2, 8)
    )
    sheet.approve()
    with pytest.raises(TimesheetApprovedError):
        sheet.correct(
            original_event_id=event.id,
            reason="исправление после утверждения без переоткрытия",
            created_by=uuid4(),
        )


# ---------------------------------------------------------- TA004 события


def test_registering_a_shift_raises_shift_actually_performed() -> None:
    sheet = timesheet()
    event = sheet.register_event(
        event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(2, 8)
    )
    raised = [e for e in sheet.pull_pending_events() if isinstance(e, ShiftActuallyPerformed)]
    assert len(raised) == 1
    assert raised[0].event_id_of_record == event.id
    assert raised[0].planned_shift_id is None


def test_registering_sickness_raises_sickness_registered() -> None:
    sheet = timesheet()
    sheet.register_event(event_type=ServiceTimeEventType.SICKNESS, time_range=shift(2, 8))
    assert any(isinstance(e, SicknessRegistered) for e in sheet.pull_pending_events())


def test_suspension_raises_no_event_because_the_model_names_none() -> None:
    sheet = timesheet()
    sheet.register_event(event_type=ServiceTimeEventType.SUSPENSION, time_range=shift(2, 8))
    assert sheet.pull_pending_events() == []


def test_approve_and_reopen_raise_their_events() -> None:
    sheet = timesheet()
    sheet.approve()
    sheet.reopen(reason="повторная проверка данных периода")

    kinds = [type(e) for e in sheet.pull_pending_events()]
    assert kinds == [TimesheetApproved, TimesheetReopened]


def test_pull_events_empties_the_buffer() -> None:
    sheet = timesheet()
    sheet.register_event(event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(2, 8))
    assert sheet.pull_pending_events() != []
    assert sheet.pull_pending_events() == []


# ------------------------------------------------------- группы Алгоритма В


def test_events_are_split_into_the_two_groups_of_algorithm_v() -> None:
    sheet = timesheet()
    sheet.register_event(event_type=ServiceTimeEventType.ACTUAL_SHIFT, time_range=shift(2, 8))
    sheet.register_event(event_type=ServiceTimeEventType.SICKNESS, time_range=shift(4, 8))
    sheet.register_event(
        event_type=ServiceTimeEventType.BUSINESS_TRIP,
        time_range=shift(6, 8),
        business_trip_place="Тверь",
    )
    sheet.register_event(event_type=ServiceTimeEventType.SUSPENSION, time_range=shift(8, 8))

    assert [e.event_type for e in sheet.service_time_events()] == [
        ServiceTimeEventType.ACTUAL_SHIFT,
        ServiceTimeEventType.BUSINESS_TRIP,
    ]
    assert [e.event_type for e in sheet.explained_absence_events()] == [
        ServiceTimeEventType.SICKNESS,
        ServiceTimeEventType.SUSPENSION,
    ]


def test_naive_datetimes_are_refused_at_the_value_object() -> None:
    """`tstzrange` хранит момент, а не «стенные часы»."""
    with pytest.raises(ValueError, match="таймзоной"):
        TimeInterval(start=datetime(2026, 3, 2, 8), end=datetime(2026, 3, 2, 20))


def test_utc_and_moscow_describe_the_same_moment() -> None:
    """Проверка того, что сравнение интервалов идёт по моменту времени, а
    не по представлению: 08:00 MSK и 05:00 UTC — одно и то же."""
    msk = TimeInterval(
        start=datetime(2026, 3, 2, 8, tzinfo=MOSCOW), end=datetime(2026, 3, 2, 20, tzinfo=MOSCOW)
    )
    utc = TimeInterval(
        start=datetime(2026, 3, 2, 5, tzinfo=UTC), end=datetime(2026, 3, 2, 17, tzinfo=UTC)
    )
    assert msk == utc
