"""SD002 — юнит-тесты инварианта непересечения смен, включая стык двух
графиков. Чистый домен, без БД."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

import pytest

from src.modules.scheduling.domain.duty_schedule import DutySchedule
from src.modules.scheduling.domain.errors import (
    OverlappingShiftError,
    ScheduleApprovedError,
    ShiftOutsideSchedulePeriodError,
)
from src.modules.scheduling.domain.events import ScheduleApproved
from src.modules.scheduling.domain.value_objects import (
    AccountingPeriod,
    AccountingPeriodType,
    DutyType,
    ScheduleStatus,
    TimeInterval,
)

UNIT = uuid4()
EMPLOYEE = uuid4()


def _period(start: date, end: date) -> AccountingPeriod:
    return AccountingPeriod(period_type=AccountingPeriodType.MONTH, start=start, end=end)


def _march() -> DutySchedule:
    return DutySchedule.draft(unit_id=UNIT, period=_period(date(2026, 3, 1), date(2026, 4, 1)))


def _at(day: int, hour: int, *, month: int = 3) -> datetime:
    return datetime(2026, month, day, hour, tzinfo=UTC)


def _shift(schedule: DutySchedule, start: datetime, hours: int, employee=EMPLOYEE):  # type: ignore[no-untyped-def]
    return schedule.add_shift(
        employee_id=employee,
        time_range=TimeInterval(start=start, end=start + timedelta(hours=hours)),
        duty_type=DutyType.TWENTY_FOUR_HOUR_DUTY,
    )


# --- инвариант 5.1.1 ---------------------------------------------------


def test_two_non_overlapping_shifts_are_accepted() -> None:
    schedule = _march()
    _shift(schedule, _at(2, 8), 24)
    _shift(schedule, _at(6, 8), 24)
    assert len(schedule.shifts) == 2


def test_overlapping_shifts_of_one_employee_are_rejected() -> None:
    schedule = _march()
    _shift(schedule, _at(2, 8), 24)
    with pytest.raises(OverlappingShiftError):
        _shift(schedule, _at(2, 20), 24)


def test_shifts_touching_at_the_handover_do_not_overlap() -> None:
    """Полуоткрытый [start, end): смена, кончающаяся в 08:00, и смена,
    начинающаяся в 08:00, — это пересменка, а не наложение."""
    schedule = _march()
    _shift(schedule, _at(2, 8), 24)
    _shift(schedule, _at(3, 8), 24)
    assert len(schedule.shifts) == 2


def test_different_employees_may_work_at_the_same_time() -> None:
    schedule = _march()
    _shift(schedule, _at(2, 8), 24)
    _shift(schedule, _at(2, 8), 24, employee=uuid4())
    assert len(schedule.shifts) == 2


def test_overlap_across_two_schedules_is_invisible_to_the_aggregate() -> None:
    """Стык двух графиков — тот случай, ради которого EXCLUDE в миграции
    0012 сделан ГЛОБАЛЬНЫМ по сотруднику.

    Агрегат видит только свои смены, поэтому здесь он пересечение НЕ
    ловит — и это не дефект, а граница его компетенции. Тест фиксирует
    именно это: домен молчит, а отказывает БД (проверяется интеграционным
    тестом). Если когда-нибудь агрегат научится видеть соседний период,
    этот тест упадёт и заставит пересмотреть распределение проверок.
    """
    march = _march()
    april = DutySchedule.draft(unit_id=UNIT, period=_period(date(2026, 4, 1), date(2026, 5, 1)))

    _shift(march, _at(31, 20), 24)          # 31 марта 20:00 → 1 апреля 20:00
    april_shift = _shift(april, _at(1, 8, month=4), 24)  # 1 апреля 08:00 → 2 апреля 08:00

    assert march.shifts[0].time_range.overlaps(april_shift.time_range), (
        "смены действительно пересекаются во времени"
    )
    assert len(april.shifts) == 1, "но агрегат апреля об этом знать не может"


def test_a_shift_must_start_inside_its_schedule_period() -> None:
    schedule = _march()
    with pytest.raises(ShiftOutsideSchedulePeriodError):
        _shift(schedule, _at(2, 8, month=4), 24)


def test_a_twenty_four_hour_duty_may_end_in_the_next_period() -> None:
    """Алгоритм И (`assign_by_start`): проверяется начало, а не вложенность
    целиком — иначе дежурство на стыке периодов было бы запрещено."""
    schedule = _march()
    shift = _shift(schedule, _at(31, 20), 24)
    assert shift.time_range.end.month == 4
    assert len(schedule.shifts) == 1


# --- инвариант 5.1.3 ---------------------------------------------------


def test_approve_freezes_the_schedule_and_raises_its_event() -> None:
    schedule = _march()
    _shift(schedule, _at(2, 8), 24)

    schedule.approve(approval_order_ref="Приказ № 17 от 25.02.2026")

    assert schedule.status == ScheduleStatus.APPROVED
    assert not schedule.is_editable

    events = schedule.pull_pending_events()
    assert len(events) == 1
    assert isinstance(events[0], ScheduleApproved)
    assert events[0].approval_order_ref == "Приказ № 17 от 25.02.2026"


def test_an_approved_schedule_refuses_new_shifts() -> None:
    schedule = _march()
    schedule.approve(approval_order_ref="Приказ № 17")
    with pytest.raises(ScheduleApprovedError):
        _shift(schedule, _at(5, 8), 24)


def test_approving_twice_is_rejected() -> None:
    schedule = _march()
    schedule.approve(approval_order_ref="Приказ № 17")
    with pytest.raises(ScheduleApprovedError):
        schedule.approve(approval_order_ref="Приказ № 18")


def test_approval_requires_an_order_reference() -> None:
    """Зеркало `ck_duty_schedule_approved_has_order` (миграция 0012):
    утверждение без документа-основания невозможно (SRS разд. 8 п.11)."""
    schedule = _march()
    with pytest.raises(ScheduleApprovedError):
        schedule.approve(approval_order_ref="   ")


def test_status_cannot_be_set_to_approved_bypassing_the_method() -> None:
    schedule = _march()
    with pytest.raises(ScheduleApprovedError):
        schedule.status = ScheduleStatus.APPROVED


# --- VO ----------------------------------------------------------------


def test_time_interval_requires_start_before_end() -> None:
    with pytest.raises(ValueError, match="строго раньше"):
        TimeInterval(start=_at(2, 8), end=_at(2, 8))


def test_time_interval_requires_timezone_aware_bounds() -> None:
    """tstzrange хранит момент времени, а не «стенные часы»: наивный
    datetime молча получил бы таймзону сервера."""
    with pytest.raises(ValueError, match="таймзон"):
        TimeInterval(start=datetime(2026, 3, 2, 8), end=datetime(2026, 3, 3, 8))


def test_shifts_of_returns_one_employees_shifts_in_order() -> None:
    schedule = _march()
    _shift(schedule, _at(10, 8), 24)
    _shift(schedule, _at(2, 8), 24)
    _shift(schedule, _at(6, 8), 24, employee=uuid4())

    mine = schedule.shifts_of(EMPLOYEE)
    assert [s.time_range.start.day for s in mine] == [2, 10]
