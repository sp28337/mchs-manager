"""Сверка с выданным табелем.

Проверяется не арифметика — она в `test_calculation.py`, — а то, ради
чего сверка существует: расхождение обязано быть названо, объяснено и
подкреплено нормой, иначе с ним не пойдёшь к начальнику.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from src.modules.shift_accounting.domain.calculation import (
    AbsencePeriod,
    CalendarFacts,
    calculate_period,
)
from src.modules.shift_accounting.domain.reconciliation import (
    EmployerFigures,
    reconcile,
)
from src.modules.shift_accounting.domain.value_objects import (
    EmploymentKind,
    Gender,
    GuardCycle,
    GuardNumber,
    WorkingConditions,
    derive_weekly_norm,
)

WEEKLY = derive_weekly_norm(
    employment=EmploymentKind.ATTESTED,
    gender=Gender.MALE,
    conditions=WorkingConditions.NORMAL,
    northern_locality=False,
)


def _march(absences: list[AbsencePeriod] | None = None):  # type: ignore[no-untyped-def]
    return calculate_period(
        period_start=date(2026, 3, 1),
        period_end=date(2026, 4, 1),
        cycle=GuardCycle(guard=GuardNumber.FIRST, first_shift_date=date(2026, 1, 1)),
        weekly=WEEKLY,
        calendar=CalendarFacts(working_days=21, pre_holiday_days=0),
        absences=absences or [],
        holiday_days=frozenset(),
    )


def test_a_matching_timesheet_yields_no_discrepancies() -> None:
    """«Всё сходится» — полноценный ответ, а не пустой экран."""
    calculation = _march()
    assert (
        reconcile(
            calculation,
            EmployerFigures(
                norm_hours=Decimal("168"),
                actual_hours=Decimal("192"),
                overtime_hours=Decimal("24"),
            ),
        )
        == []
    )


def test_rounding_within_half_an_hour_is_not_a_dispute() -> None:
    calculation = _march()
    assert (
        reconcile(calculation, EmployerFigures(norm_hours=Decimal("168.4"))) == []
    )
    assert reconcile(calculation, EmployerFigures(norm_hours=Decimal("169"))) != []


def test_an_unreduced_norm_is_named_together_with_its_cause() -> None:
    """Самый частый случай обмана.

    Человек был в отпуске 1-14 марта; норма должна была уменьшиться на 96
    часов, а в табеле стоит полная. Сверка обязана не просто заметить
    разницу, а сказать, ОТКУДА она взялась и какой нормой опровергается.
    """
    calculation = _march(
        [
            AbsencePeriod(
                start=date(2026, 3, 1),
                end_inclusive=date(2026, 3, 14),
                kind="annual_leave",
            )
        ]
    )
    assert calculation.norm_hours == Decimal("72")

    found = reconcile(calculation, EmployerFigures(norm_hours=Decimal("168")))
    assert len(found) == 1

    discrepancy = found[0]
    assert discrepancy.field == "norm_hours"
    assert discrepancy.delta == Decimal("96")
    assert discrepancy.favours_employer is True
    assert "96" in discrepancy.explanation
    assert "550-6-1" in discrepancy.basis, "довод обязан нести реквизиты"


def test_the_minus_twenty_four_trick_is_recognised_by_name() -> None:
    """«Минус 24 часа за смену в отпуске» — именно тот приём, о котором
    просили. Сверка должна объяснить, почему так нельзя, а не просто
    показать разницу."""
    calculation = _march(
        [
            AbsencePeriod(
                start=date(2026, 3, 1),
                end_inclusive=date(2026, 3, 14),
                kind="annual_leave",
            )
        ]
    )
    # Работодатель уменьшил факт ещё на одну «штрафную» смену.
    found = reconcile(
        calculation, EmployerFigures(actual_hours=calculation.actual_hours - Decimal("24"))
    )
    assert len(found) == 1
    assert found[0].field == "actual_hours"
    assert "24 часа" in found[0].explanation
    assert found[0].favours_employer is True


def test_an_error_in_the_employee_favour_is_reported_too() -> None:
    """Сверка честна в обе стороны. Инструмент, который находит только
    выгодные владельцу расхождения, не выдержит первого же разбора."""
    calculation = _march()
    found = reconcile(calculation, EmployerFigures(norm_hours=Decimal("100")))
    assert len(found) == 1
    assert found[0].favours_employer is False


def test_all_three_figures_are_compared_independently() -> None:
    """Ошибки в норме и факте могут скомпенсировать друг друга в итоговой
    переработке. Сверяя только её, мы объявили бы верным табель с двумя
    неверными числами."""
    calculation = _march()
    found = reconcile(
        calculation,
        EmployerFigures(
            norm_hours=calculation.norm_hours + Decimal("24"),
            actual_hours=calculation.actual_hours + Decimal("24"),
            overtime_hours=calculation.overtime_hours,
        ),
    )
    assert {item.field for item in found} == {"norm_hours", "actual_hours"}


def test_missing_figures_are_simply_not_compared() -> None:
    """Человек может знать из табеля не всё. Отсутствие числа — не ноль."""
    calculation = _march()
    assert reconcile(calculation, EmployerFigures()) == []
