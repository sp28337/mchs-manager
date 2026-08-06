"""LM002 — инвариант 9.1.1 и присоединение смежных отпусков.

DoD задачи назван точно: «смежные периоды не считаются пересечением».
Это не придирка к границам — Приказ МЧС России № 410 п. 12 прямо
допускает присоединение дополнительных дней отдыха к ежегодному отпуску,
а ФЗ-141 ст. 63 — соединение частей отпуска. Основной отпуск,
заканчивающийся 15 марта, и дополнительный, начинающийся 15 марта,
обязаны сосуществовать.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import uuid4

import pytest

from src.modules.leave_management.domain.errors import (
    LeaveImmutableError,
    LeaveNotRecallableError,
    RecallOutsideLeaveError,
)
from src.modules.leave_management.domain.events import (
    LeaveGrantCreated,
    LeaveGrantRecalled,
)
from src.modules.leave_management.domain.leave_grant import LeaveGrant
from src.modules.leave_management.domain.value_objects import (
    EntitlementBasis,
    LeavePeriod,
    LeaveStatus,
    LeaveType,
)

RULE_VERSION = uuid4()


def period(start: str, end: str) -> LeavePeriod:
    return LeavePeriod(start=date.fromisoformat(start), end=date.fromisoformat(end))


def basis(days: int = 30) -> EntitlementBasis:
    return EntitlementBasis(
        rule_version_id=RULE_VERSION, entitled_days=days, seniority_years=21
    )


def grant(
    start: str = "2026-03-01",
    end: str = "2026-03-21",
    leave_type: LeaveType = LeaveType.BASIC,
) -> LeaveGrant:
    return LeaveGrant.grant(
        employee_id=uuid4(),
        leave_type=leave_type,
        period=period(start, end),
        entitlement=basis(),
    )


# ------------------------------------------------------- инвариант 9.1.1


def test_adjacent_periods_do_not_overlap() -> None:
    """Присоединение: конец одного равен началу другого."""
    first = period("2026-03-01", "2026-03-15")
    second = period("2026-03-15", "2026-03-20")

    assert not first.overlaps(second)
    assert not second.overlaps(first)
    assert first.adjoins(second)


def test_a_single_shared_day_is_an_overlap() -> None:
    """Граница на день левее — уже наложение: 15 марта попадает в оба."""
    first = period("2026-03-01", "2026-03-16")
    second = period("2026-03-15", "2026-03-20")

    assert first.overlaps(second)
    assert second.overlaps(first)


def test_a_contained_period_overlaps() -> None:
    outer = period("2026-03-01", "2026-04-01")
    inner = period("2026-03-10", "2026-03-12")
    assert outer.overlaps(inner)
    assert inner.overlaps(outer)


def test_disjoint_periods_neither_overlap_nor_adjoin() -> None:
    first = period("2026-03-01", "2026-03-10")
    second = period("2026-03-20", "2026-03-25")
    assert not first.overlaps(second)
    assert not first.adjoins(second)


def test_an_empty_period_is_refused() -> None:
    with pytest.raises(ValueError, match="пуст"):
        period("2026-03-10", "2026-03-10")


def test_a_reversed_period_is_refused() -> None:
    with pytest.raises(ValueError, match="пуст"):
        period("2026-03-10", "2026-03-01")


def test_the_day_count_uses_the_exclusive_upper_bound() -> None:
    """Отпуск с 1 по 20 марта включительно — это `[01.03, 21.03)`, то есть
    20 дней."""
    assert period("2026-03-01", "2026-03-21").days == 20


# ------------------------------------------------------- инвариант 9.1.3


def test_a_recall_does_not_shorten_the_granted_period() -> None:
    """«Наличие `RecallEvent` не уменьшает `EntitlementBasis`... запрещено
    „тихое" аннулирование дней отпуска»."""
    subject = grant("2026-03-01", "2026-03-21")
    subject.recall(recall_date=date(2026, 3, 5), effective_from=date(2026, 3, 8))

    assert subject.period.start == date(2026, 3, 1)
    assert subject.period.end == date(2026, 3, 21)


def test_the_unused_remainder_is_computable_after_a_recall() -> None:
    subject = grant("2026-03-01", "2026-03-21")
    subject.recall(recall_date=date(2026, 3, 5), effective_from=date(2026, 3, 8))

    assert subject.used_days == 7
    assert subject.unused_days == 13
    assert subject.used_days + subject.unused_days == subject.period.days


def test_a_recall_moves_the_grant_to_recalled() -> None:
    subject = grant()
    subject.recall(recall_date=date(2026, 3, 5), effective_from=date(2026, 3, 8))
    assert subject.status is LeaveStatus.RECALLED
    assert subject.is_recalled


def test_a_recalled_grant_still_occupies_the_calendar() -> None:
    """Сотрудник в отпуске БЫЛ: перекрыть эти даты новым отпуском значило
    бы выдать их дважды. Зеркало `WHERE status IN ('active','recalled')`."""
    subject = grant()
    subject.recall(recall_date=date(2026, 3, 5), effective_from=date(2026, 3, 8))
    assert subject.status.occupies_calendar


def test_an_untouched_grant_has_no_unused_remainder() -> None:
    subject = grant("2026-03-01", "2026-03-21")
    assert subject.unused_days == 0
    assert subject.used_days == 20


def test_the_earliest_recall_decides_the_effective_end() -> None:
    """Вернуть сотрудника в отпуск после отзыва можно только новым
    приказом, поэтому второй отзыв того же предоставления невозможен, а
    `effective_end` определяется первым."""
    subject = grant("2026-03-01", "2026-03-21")
    subject.recall(recall_date=date(2026, 3, 5), effective_from=date(2026, 3, 8))

    with pytest.raises(LeaveNotRecallableError):
        subject.recall(recall_date=date(2026, 3, 10), effective_from=date(2026, 3, 12))

    assert subject.effective_end == date(2026, 3, 8)


# ------------------------------------------------------------ отзыв


def test_a_recall_effective_before_the_order_is_refused() -> None:
    """Приказ не действует раньше, чем издан."""
    subject = grant()
    with pytest.raises(ValueError, match="раньше, чем издан"):
        subject.recall(recall_date=date(2026, 3, 10), effective_from=date(2026, 3, 5))


def test_a_recall_outside_the_leave_is_refused() -> None:
    subject = grant("2026-03-01", "2026-03-21")
    with pytest.raises(RecallOutsideLeaveError):
        subject.recall(recall_date=date(2026, 3, 25), effective_from=date(2026, 3, 25))


def test_a_recall_on_the_exclusive_upper_bound_is_refused() -> None:
    """21 марта сотрудник уже вышел: прерывать нечего."""
    subject = grant("2026-03-01", "2026-03-21")
    with pytest.raises(RecallOutsideLeaveError):
        subject.recall(recall_date=date(2026, 3, 21), effective_from=date(2026, 3, 21))


def test_a_recall_on_the_first_day_leaves_no_used_days() -> None:
    subject = grant("2026-03-01", "2026-03-21")
    subject.recall(recall_date=date(2026, 3, 1), effective_from=date(2026, 3, 1))
    assert subject.used_days == 0
    assert subject.unused_days == 20


def test_a_cancelled_grant_cannot_be_recalled() -> None:
    subject = grant()
    subject.cancel()
    with pytest.raises(LeaveNotRecallableError):
        subject.recall(recall_date=date(2026, 3, 5), effective_from=date(2026, 3, 8))


def test_a_recalled_grant_cannot_be_cancelled() -> None:
    """Отпуск состоялся частично, и объявить его небывшим значило бы
    стереть дни, которые сотрудник уже использовал."""
    subject = grant()
    subject.recall(recall_date=date(2026, 3, 5), effective_from=date(2026, 3, 8))
    with pytest.raises(LeaveNotRecallableError):
        subject.cancel()


def test_a_cancelled_grant_frees_both_the_calendar_and_the_one_time_right() -> None:
    subject = grant(leave_type=LeaveType.PERSONAL_CIRCUMSTANCES_20Y)
    subject.cancel()
    assert not subject.status.occupies_calendar
    assert not subject.status.consumes_once_per_service_right


# ---------------------------------------------------------- неизменяемость


def test_the_period_is_immutable() -> None:
    subject = grant()
    with pytest.raises(LeaveImmutableError):
        subject.period = period("2026-04-01", "2026-04-10")


def test_the_leave_type_is_immutable() -> None:
    subject = grant()
    with pytest.raises(LeaveImmutableError):
        subject.leave_type = LeaveType.ADDITIONAL


# ---------------------------------------------------------------- события


def test_granting_raises_its_event() -> None:
    subject = grant()
    events = subject.pull_pending_events()
    assert len(events) == 1
    assert isinstance(events[0], LeaveGrantCreated)
    assert events[0].entitlement_basis_rule_version_id == RULE_VERSION


def test_a_recall_event_carries_the_unused_remainder() -> None:
    """Инвариант 9.1.3 через границу модуля: число, по которому кадровая
    служба заведёт остаток, едет вместе с фактом."""
    subject = grant("2026-03-01", "2026-03-21")
    subject.pull_pending_events()
    subject.recall(recall_date=date(2026, 3, 5), effective_from=date(2026, 3, 8))

    events = subject.pull_pending_events()
    assert len(events) == 1
    recalled = events[0]
    assert isinstance(recalled, LeaveGrantRecalled)
    assert recalled.unused_days == 13
    assert recalled.used_days == 7


# ------------------------------------------------------- право и его вид


def test_only_personal_circumstances_is_once_per_service() -> None:
    """ФЗ-141 ст. 64 ч. 1 п. 2 — один раз за весь период службы."""
    assert LeaveType.PERSONAL_CIRCUMSTANCES_20Y.is_once_per_service
    for other in (
        LeaveType.BASIC,
        LeaveType.ADDITIONAL,
        LeaveType.MATERNITY,
        LeaveType.CHILD_CARE,
        LeaveType.EDUCATIONAL,
    ):
        assert not other.is_once_per_service


def test_an_entitlement_of_zero_days_is_refused() -> None:
    with pytest.raises(ValueError, match="не является правом"):
        EntitlementBasis(rule_version_id=RULE_VERSION, entitled_days=0)


def test_attached_rest_days_are_recorded_on_the_grant() -> None:
    """Приказ № 410 п. 12: дополнительные дни отдыха могут быть
    присоединены к ежегодному отпуску."""
    subject = LeaveGrant.grant(
        employee_id=uuid4(),
        leave_type=LeaveType.BASIC,
        period=period("2026-03-01", "2026-03-21"),
        entitlement=basis(),
        attached_rest_days=Decimal("3.00"),
    )
    assert subject.attached_rest_days == Decimal("3.00")
    assert subject.pull_pending_events()[0].attached_rest_days == Decimal("3.00")
