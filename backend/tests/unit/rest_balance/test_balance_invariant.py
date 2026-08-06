"""RB002 — инвариант 8.1.1: остаток не может стать отрицательным.

DoD задачи назван точно: «списание ровно равное остатку проходит, +0.01 —
падает». Граница здесь не педантизм: она отделяет «сотрудник использовал
всё, что заработал» от «система выдала то, чего не было».
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import uuid4

import pytest

from src.modules.rest_balance.domain.balance import RestDaysBalance
from src.modules.rest_balance.domain.errors import (
    AccrualWithoutGroundError,
    AlreadyReversedError,
    InsufficientBalanceError,
    MovementImmutableError,
    ReversalReasonRequiredError,
)
from src.modules.rest_balance.domain.value_objects import (
    BalancePeriod,
    MovementGround,
    MovementType,
    RestDays,
)

MARCH = date(2026, 3, 10)
APRIL = date(2026, 4, 10)


def balance(*accruals: str) -> RestDaysBalance:
    subject = RestDaysBalance.for_employee(uuid4())
    for days in accruals:
        subject.accrue(
            amount=RestDays(days=Decimal(days)),
            movement_date=MARCH,
            compensation_line_id=uuid4(),
        )
    return subject


# ------------------------------------------------------- инвариант 8.1.1


def test_consuming_exactly_the_balance_is_allowed() -> None:
    subject = balance("3.00")
    subject.consume(amount=RestDays(days=Decimal("3.00")), movement_date=APRIL)
    assert subject.balance_days == Decimal("0.00")


def test_consuming_a_hundredth_more_than_the_balance_is_refused() -> None:
    """Та самая сотая доли суток, ради которой часы и сутки считаются
    `Decimal`, а не `float`."""
    subject = balance("3.00")
    with pytest.raises(InsufficientBalanceError):
        subject.consume(amount=RestDays(days=Decimal("3.01")), movement_date=APRIL)


def test_the_refusal_names_the_balance_and_the_request() -> None:
    """DoD RB005: 422 обязан назвать текущий остаток — иначе сотруднику
    остаётся угадывать, на сколько суток подавать рапорт."""
    subject = balance("3.00")
    with pytest.raises(InsufficientBalanceError) as exc:
        subject.consume(amount=RestDays(days=Decimal("5.00")), movement_date=APRIL)

    assert exc.value.balance == Decimal("3.00")
    assert exc.value.requested == Decimal("5.00")


def test_a_refused_consumption_leaves_no_trace() -> None:
    """Проверка выполняется ДО создания движения (Domain Model 8.1.1), а
    не откатом после: отказавший агрегат обязан остаться в том же
    состоянии, в каком был."""
    subject = balance("3.00")
    with pytest.raises(InsufficientBalanceError):
        subject.consume(amount=RestDays(days=Decimal("4.00")), movement_date=APRIL)

    assert len(subject.movements) == 1
    assert subject.balance_days == Decimal("3.00")


def test_consumption_is_checked_against_the_running_balance() -> None:
    """Два списания подряд проверяются каждое по остатку НА СВОЙ момент, а
    не по изначальному начислению."""
    subject = balance("3.00")
    subject.consume(amount=RestDays(days=Decimal("2.00")), movement_date=APRIL)
    with pytest.raises(InsufficientBalanceError):
        subject.consume(amount=RestDays(days=Decimal("1.50")), movement_date=APRIL)


def test_accruals_accumulate_across_periods() -> None:
    """Агрегат не привязан к учётному периоду: сутки, начисленные за март
    и апрель, складываются в один остаток."""
    subject = balance("1.00", "2.50")
    assert subject.balance_days == Decimal("3.50")


def test_an_empty_balance_refuses_any_consumption() -> None:
    subject = RestDaysBalance.for_employee(uuid4())
    assert subject.balance_days == Decimal(0)
    with pytest.raises(InsufficientBalanceError):
        subject.consume(amount=RestDays(days=Decimal("0.50")), movement_date=APRIL)


# ------------------------------------------------------- инвариант 8.1.2


def test_an_accrual_carries_its_compensation_line() -> None:
    subject = RestDaysBalance.for_employee(uuid4())
    line_id = uuid4()
    movement = subject.accrue(
        amount=RestDays(days=Decimal("1.00")),
        movement_date=MARCH,
        compensation_line_id=line_id,
    )
    assert movement.ground.compensation_line_id == line_id
    assert movement.movement_type is MovementType.ACCRUAL


def test_a_repeated_accrual_for_the_same_line_changes_nothing() -> None:
    """`CompensationLineCreated` доставляется at-least-once: повторная
    доставка обязана быть безвредной, иначе один сбой сети удваивал бы
    сотруднику отдых."""
    subject = RestDaysBalance.for_employee(uuid4())
    line_id = uuid4()
    first = subject.accrue(
        amount=RestDays(days=Decimal("1.00")),
        movement_date=MARCH,
        compensation_line_id=line_id,
    )
    second = subject.accrue(
        amount=RestDays(days=Decimal("1.00")),
        movement_date=MARCH,
        compensation_line_id=line_id,
    )

    assert first.id == second.id
    assert len(subject.movements) == 1
    assert subject.balance_days == Decimal("1.00")


def test_an_accrual_without_a_ground_is_impossible_by_signature() -> None:
    """Инвариант 8.1.2 выражен типом: `compensation_line_id` —
    обязательный параметр, и начисление «из воздуха» нечем записать."""
    subject = RestDaysBalance.for_employee(uuid4())
    with pytest.raises(TypeError):
        subject.accrue(  # type: ignore[call-arg]
            amount=RestDays(days=Decimal("1.00")), movement_date=MARCH
        )


def test_a_ground_cannot_hold_two_sources() -> None:
    with pytest.raises(ValueError, match="ровно одно основание"):
        MovementGround(compensation_line_id=uuid4(), leave_grant_id=uuid4())


# ------------------------------------------------------- инвариант 8.1.3


def test_a_movement_is_immutable() -> None:
    subject = balance("3.00")
    movement = subject.movements[0]
    with pytest.raises(MovementImmutableError):
        movement.amount = RestDays(days=Decimal("99.00"))


def test_reversing_an_accrual_mirrors_it_as_a_consumption() -> None:
    subject = balance("3.00")
    original = subject.movements[0]

    storno = subject.reverse(
        movement_id=original.id, reason="ошибочно начислено по чужой строке"
    )

    assert storno.movement_type is MovementType.CONSUMPTION
    assert storno.amount.days == original.amount.days
    assert storno.reverses_movement_id == original.id
    assert subject.balance_days == Decimal("0.00")


def test_reversing_a_consumption_returns_the_days() -> None:
    subject = balance("3.00")
    consumption = subject.consume(amount=RestDays(days=Decimal("2.00")), movement_date=APRIL)

    subject.reverse(movement_id=consumption.id, reason="отгул отменён приказом")

    assert subject.balance_days == Decimal("3.00")


def test_the_original_movement_is_untouched_by_its_reversal() -> None:
    """DoD RB006 дословно: «сторно создаёт новую запись, исходная не
    изменяется»."""
    subject = balance("3.00")
    original = subject.movements[0]
    before = (original.movement_type, original.amount.days, original.movement_date)

    subject.reverse(movement_id=original.id, reason="ошибочно начислено дважды")

    assert (original.movement_type, original.amount.days, original.movement_date) == before
    assert original.reverses_movement_id is None
    assert len(subject.movements) == 2


def test_a_reversal_without_a_reason_is_refused() -> None:
    subject = balance("3.00")
    with pytest.raises(ReversalReasonRequiredError):
        subject.reverse(movement_id=subject.movements[0].id, reason="   ")


def test_a_movement_cannot_be_reversed_twice() -> None:
    subject = balance("3.00")
    original = subject.movements[0]
    subject.reverse(movement_id=original.id, reason="ошибочное начисление")

    with pytest.raises(AlreadyReversedError):
        subject.reverse(movement_id=original.id, reason="ещё раз то же самое")


def test_a_reversal_cannot_itself_be_reversed() -> None:
    subject = balance("3.00")
    storno = subject.reverse(
        movement_id=subject.movements[0].id, reason="ошибочное начисление"
    )
    with pytest.raises(AlreadyReversedError):
        subject.reverse(movement_id=storno.id, reason="передумали отменять")


def test_reversing_an_accrual_already_spent_is_refused() -> None:
    """Сторно начисления отнимает сутки — и не находит их, если сотрудник
    уже отгулял. Отказ правилен: это не запись в журнал, а требование
    вернуть прошедшие выходные, и решается оно отдельно."""
    subject = balance("3.00")
    accrual = subject.movements[0]
    subject.consume(amount=RestDays(days=Decimal("3.00")), movement_date=APRIL)

    with pytest.raises(InsufficientBalanceError):
        subject.reverse(movement_id=accrual.id, reason="начислено по ошибке")


# ------------------------------------------------------------ выборки


def test_the_balance_as_of_a_date_ignores_later_movements() -> None:
    subject = RestDaysBalance.for_employee(uuid4())
    subject.accrue(
        amount=RestDays(days=Decimal("1.00")),
        movement_date=MARCH,
        compensation_line_id=uuid4(),
    )
    subject.accrue(
        amount=RestDays(days=Decimal("2.00")),
        movement_date=APRIL,
        compensation_line_id=uuid4(),
    )

    assert subject.balance_as_of(MARCH) == Decimal("1.00")
    assert subject.balance_as_of(APRIL) == Decimal("3.00")


def test_movements_are_filtered_by_a_half_open_period() -> None:
    """Полуинтервал: движение 1 апреля принадлежит апрелю, а не марту, и
    ни одно движение не попадает в два периода сразу."""
    subject = RestDaysBalance.for_employee(uuid4())
    subject.accrue(
        amount=RestDays(days=Decimal("1.00")),
        movement_date=date(2026, 3, 31),
        compensation_line_id=uuid4(),
    )
    subject.accrue(
        amount=RestDays(days=Decimal("2.00")),
        movement_date=date(2026, 4, 1),
        compensation_line_id=uuid4(),
    )

    march = BalancePeriod(start=date(2026, 3, 1), end=date(2026, 4, 1))
    assert len(subject.movements_in(march)) == 1


# ----------------------------------------------------------- величина


def test_a_zero_day_movement_is_refused() -> None:
    with pytest.raises(ValueError, match="не имеет смысла"):
        RestDays(days=Decimal("0"))


def test_a_negative_movement_is_refused() -> None:
    """Направление задаёт тип движения, а не знак величины: списание,
    записанное отрицательным начислением, считалось бы дважды."""
    with pytest.raises(ValueError, match="не имеет смысла"):
        RestDays(days=Decimal("-1.00"))


def test_accrual_without_ground_error_exists_for_the_persistence_path() -> None:
    """Тип нужен репозиторию: агрегат основание требует сигнатурой, но
    строка, пришедшая из БД мимо агрегата, обязана быть отвергнута с
    объяснимой ошибкой, а не с `AttributeError`."""
    assert issubclass(AccrualWithoutGroundError, Exception)
