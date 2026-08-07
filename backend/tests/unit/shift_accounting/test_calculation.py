"""Расчёт нормы и переработки — то, ради чего система существует.

Числа в тестах взяты не из головы: производственный календарь 2026 года
подставляется явными значениями, а ожидаемые нормы пересчитаны по
формуле ст. 104 ТК РФ вручную.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from src.modules.shift_accounting.domain.calculation import (
    AbsencePeriod,
    CalendarFacts,
    base_norm_hours,
    calculate_period,
)
from src.modules.shift_accounting.domain.value_objects import (
    EmploymentKind,
    Gender,
    GuardCycle,
    GuardNumber,
    WorkingConditions,
    derive_weekly_norm,
)

NO_HOLIDAYS: frozenset[date] = frozenset()


def _norm(**overrides):  # type: ignore[no-untyped-def]
    kwargs = {
        "employment": EmploymentKind.ATTESTED,
        "gender": Gender.MALE,
        "conditions": WorkingConditions.NORMAL,
        "northern_locality": False,
    }
    kwargs.update(overrides)
    return derive_weekly_norm(**kwargs)  # type: ignore[arg-type]


# ------------------------------------------------------- недельная норма


def test_normal_conditions_give_forty_hours() -> None:
    assert _norm().hours == Decimal("40")
    assert "308" in _norm().basis, "основание — приказ о СМЕННОЙ работе"


def test_harmful_conditions_give_thirty_six_for_both_kinds() -> None:
    """Вредность сокращает неделю и служащему, и работнику — но по разным
    пунктам, и основание обязано это различать: человек понесёт его
    начальнику."""
    attested = _norm(conditions=WorkingConditions.HARMFUL_OR_DANGEROUS)
    civilian = _norm(
        employment=EmploymentKind.CIVILIAN,
        conditions=WorkingConditions.HARMFUL_OR_DANGEROUS,
    )
    assert attested.hours == civilian.hours == Decimal("36")
    assert "308" in attested.basis and "ФЗ-141" in attested.basis
    assert "307" in civilian.basis and "92 ТК РФ" in civilian.basis


def test_northern_women_get_thirty_six_under_both_orders() -> None:
    """Приказ № 308 п. 1 даёт сокращение и СОТРУДНИЦАМ — по ч. 4 ст. 54
    ФЗ-141, а не только работницам по ст. 320 ТК РФ.

    Это исправление: пока приказов 307 и 308 не было, аттестованной
    женщине здесь считалась полная сорокачасовая неделя, то есть норма
    завышалась на 4 часа в неделю — около двухсот часов в год.
    """
    attested = _norm(gender=Gender.FEMALE, northern_locality=True)
    civilian = _norm(
        employment=EmploymentKind.CIVILIAN, gender=Gender.FEMALE, northern_locality=True
    )
    assert attested.hours == civilian.hours == Decimal("36")
    assert "ч. 4 ст. 54 ФЗ-141" in attested.basis
    assert "320 ТК РФ" in civilian.basis


def test_northern_reduction_does_not_apply_to_men() -> None:
    """Оба приказа говорят о женщинах. Распространить сокращение на всех
    значило бы занизить норму — то есть выдумать переработку."""
    assert _norm(gender=Gender.MALE, northern_locality=True).hours == Decimal("40")


def test_disability_gives_thirty_five_and_only_to_workers() -> None:
    """Приказ № 307 п. 5 — 35 часов инвалидам I или II группы. Приказ
    № 308 такого пункта не содержит, и это не пробел: службу в ФПС ГПС
    инвалид I или II группы не проходит."""
    civilian = _norm(employment=EmploymentKind.CIVILIAN, disability_group_i_or_ii=True)
    assert civilian.hours == Decimal("35")
    assert "307 п. 5" in civilian.basis

    attested = _norm(employment=EmploymentKind.ATTESTED, disability_group_i_or_ii=True)
    assert attested.hours == Decimal("40")


def test_disability_wins_over_harmful_conditions() -> None:
    """35 короче 36. Проверь вредность первой — и работник с
    инвалидностью во вредных условиях получил бы 36 вместо 35."""
    both = _norm(
        employment=EmploymentKind.CIVILIAN,
        disability_group_i_or_ii=True,
        conditions=WorkingConditions.HARMFUL_OR_DANGEROUS,
    )
    assert both.hours == Decimal("35")


def test_reductions_do_not_stack() -> None:
    """Два основания по 36 часов дают 36, а не 32."""
    both = _norm(
        employment=EmploymentKind.CIVILIAN,
        gender=Gender.FEMALE,
        northern_locality=True,
        conditions=WorkingConditions.HARMFUL_OR_DANGEROUS,
    )
    assert both.hours == Decimal("36")


# ----------------------------------------------------------- норма периода


def test_period_norm_follows_the_production_calendar() -> None:
    """`(40 / 5) × 20 − 1 × 1 = 159` — формула ст. 104 и ст. 95 ТК РФ."""
    assert base_norm_hours(
        _norm(), CalendarFacts(working_days=20, pre_holiday_days=1)
    ) == Decimal("159")


def test_reduced_week_lowers_the_period_norm_proportionally() -> None:
    assert base_norm_hours(
        _norm(conditions=WorkingConditions.HARMFUL_OR_DANGEROUS),
        CalendarFacts(working_days=20, pre_holiday_days=0),
    ) == Decimal("144")


# ---------------------------------------------------------- график караула


def test_the_cycle_repeats_every_four_days() -> None:
    cycle = GuardCycle(guard=GuardNumber.FIRST, first_shift_date=date(2026, 1, 1))
    dates = cycle.shift_dates(date(2026, 1, 1), date(2026, 2, 1))
    assert dates[:4] == [
        date(2026, 1, 1),
        date(2026, 1, 5),
        date(2026, 1, 9),
        date(2026, 1, 13),
    ]
    assert len(dates) == 8


def test_a_period_starting_after_the_first_shift_keeps_the_phase() -> None:
    """Расчёт за март не должен зависеть от того, что цикл начался в
    январе: фаза цикла — свойство караула, а не периода."""
    cycle = GuardCycle(guard=GuardNumber.THIRD, first_shift_date=date(2026, 1, 3))
    march = cycle.shift_dates(date(2026, 3, 1), date(2026, 4, 1))
    assert march[0] == date(2026, 3, 4), march[:3]
    for day in march:
        assert (day - date(2026, 1, 3)).days % 4 == 0


def test_four_guards_together_cover_every_day() -> None:
    """Проверка самого режима: четыре караула сутки через трое обязаны
    закрывать каждые сутки ровно один раз."""
    covered: list[date] = []
    for offset, guard in enumerate(GuardNumber):
        cycle = GuardCycle(
            guard=guard, first_shift_date=date(2026, 1, 1 + offset)
        )
        covered.extend(cycle.shift_dates(date(2026, 1, 1), date(2026, 2, 1)))

    assert sorted(covered) == [date(2026, 1, day) for day in range(1, 32)]


# ------------------------------------------------------------ полный расчёт


def _calculate(absences: list[AbsencePeriod], **overrides):  # type: ignore[no-untyped-def]
    kwargs = {
        "period_start": date(2026, 3, 1),
        "period_end": date(2026, 4, 1),
        "cycle": GuardCycle(guard=GuardNumber.FIRST, first_shift_date=date(2026, 1, 1)),
        "weekly": _norm(),
        "calendar": CalendarFacts(working_days=21, pre_holiday_days=0),
        "absences": absences,
        "holiday_days": NO_HOLIDAYS,
    }
    kwargs.update(overrides)
    return calculate_period(**kwargs)  # type: ignore[arg-type]


def test_a_month_without_absences_counts_every_shift() -> None:
    result = _calculate([])
    assert result.base_norm_hours == Decimal("168")  # (40/5) × 21
    assert result.excluded_hours == Decimal("0")
    assert result.norm_hours == Decimal("168")
    # Караул заступает 2, 6, 10, 14, 18, 22, 26 и 30 марта — восемь смен,
    # и каждая укладывается в месяц целиком (последняя кончается 31-го).
    assert result.scheduled_shifts == 8
    assert result.actual_hours == Decimal("192")
    assert result.overtime_hours == Decimal("24")


def test_an_absence_reduces_the_norm_and_not_the_fact() -> None:
    """Главный тест этого модуля.

    Смена, попавшая в отпуск, не отработана — значит, её нет в факте. Но
    и вычитать её из факта нельзя: её часы уходят ИЗ НОРМЫ. Именно это
    правило нарушают, ставя «минус 24 часа за смену в отпуске».
    """
    clean = _calculate([])
    with_leave = _calculate(
        [
            AbsencePeriod(
                start=date(2026, 3, 1),
                end_inclusive=date(2026, 3, 14),
                kind="annual_leave",
            )
        ]
    )

    # За 1-14 марта у первого караула четыре заступления: 2, 6, 10, 14.
    assert with_leave.absent_shifts == 4
    assert with_leave.excluded_hours == Decimal("96")
    assert with_leave.norm_hours == clean.base_norm_hours - Decimal("96")

    # Факт уменьшился ровно на неотработанные часы — и ни на час больше.
    assert with_leave.actual_hours == clean.actual_hours - Decimal("96")

    # А переработка при этом НЕ ИЗМЕНИЛАСЬ: отпуск не создаёт долга.
    assert with_leave.overtime_hours == clean.overtime_hours


def test_the_wrong_norm_shows_the_debt_that_would_be_invented() -> None:
    """Величина чужой ошибки, названная числом.

    Если норму не уменьшить, у человека возникнет недоработка, которой
    нет. Система обязана показать не только правильный ответ, но и цену
    неправильного — иначе спорить не с чем.
    """
    result = _calculate(
        [
            AbsencePeriod(
                start=date(2026, 3, 1),
                end_inclusive=date(2026, 3, 31),
                kind="annual_leave",
            )
        ]
    )
    assert result.actual_hours == Decimal("0")
    assert result.norm_hours == Decimal("0"), "отпуск на весь месяц снимает норму"
    assert result.undertime_hours == Decimal("0")
    # А вот столько «долга» покажет табель, в котором норму не тронули.
    assert result.wrong_norm_undertime_hours == Decimal("168")


def test_a_shift_across_the_month_boundary_splits_its_hours() -> None:
    """Смена с 31 марта отдаёт марту 16 часов, апрелю — 8."""
    first_day = _calculate([], period_start=date(2026, 3, 30), period_end=date(2026, 3, 31))
    second_day = _calculate([], period_start=date(2026, 3, 31), period_end=date(2026, 4, 1))

    assert first_day.shifts[-1].started_on == date(2026, 3, 30)
    assert first_day.actual_hours == Decimal("16"), "с 08:00 до полуночи"

    # Смена заступила накануне периода — и всё же отдаёт ему свой хвост.
    # Без просмотра на сутки назад эти 8 часов терялись бы у каждого
    # месяца, начинающегося со вторых суток чужой смены.
    assert second_day.shifts[0].started_on == date(2026, 3, 30)
    assert second_day.actual_hours == Decimal("8"), "с полуночи до 08:00"


def test_night_hours_are_split_with_the_shift() -> None:
    """Иначе смена на стыке дала бы 8 ночных часов дважды."""
    first_day = _calculate([], period_start=date(2026, 3, 30), period_end=date(2026, 3, 31))
    second_day = _calculate([], period_start=date(2026, 3, 31), period_end=date(2026, 4, 1))
    total = first_day.shifts[-1].night_hours + second_day.shifts[0].night_hours
    assert total == Decimal("8"), "ночные часы одной смены не удваиваются"


def test_norm_never_goes_negative() -> None:
    """Отсутствие длиннее периода не делает человека должным «недоработать»."""
    result = _calculate(
        [
            AbsencePeriod(
                start=date(2026, 1, 1),
                end_inclusive=date(2026, 12, 31),
                kind="sick_leave",
            )
        ],
        calendar=CalendarFacts(working_days=1, pre_holiday_days=0),
    )
    assert result.norm_hours == Decimal("0")
    assert result.overtime_hours == Decimal("0")


def test_holiday_hours_are_counted_but_not_promised() -> None:
    """Праздничные часы считаются как факт.

    Приказ № 410 п. 14: при суммированном учёте они в пределах нормы
    дополнительным отдыхом не компенсируются. Показать их как «положено
    сверху» значило бы пообещать то, чего норма не даёт, — поэтому они
    просто есть в разбивке.
    """
    # Новогодние каникулы: 1-8 января нерабочие праздничные дни
    # (ст. 112 ТК РФ). Первый караул заступает 1 и 5 января — обе смены
    # целиком внутри каникул.
    new_year = frozenset(date(2026, 1, day) for day in range(1, 9))
    result = _calculate(
        [],
        period_start=date(2026, 1, 1),
        period_end=date(2026, 2, 1),
        holiday_days=new_year,
    )
    assert result.holiday_hours == Decimal("48"), "две смены по 24 ч в каникулы"


@pytest.mark.parametrize("guard_index", range(4))
def test_every_guard_gets_a_comparable_yearly_norm(guard_index: int) -> None:
    """Норма за год у всех четырёх караулов одна и та же.

    Это следствие ст. 104 ТК РФ и одновременно проверка на здравый
    смысл: номер караула не может менять норму, он меняет только даты.
    """
    cycle = GuardCycle(
        guard=list(GuardNumber)[guard_index],
        first_shift_date=date(2026, 1, 1 + guard_index),
    )
    result = calculate_period(
        period_start=date(2026, 1, 1),
        period_end=date(2027, 1, 1),
        cycle=cycle,
        weekly=_norm(),
        calendar=CalendarFacts(working_days=247, pre_holiday_days=6),
        absences=[],
        holiday_days=NO_HOLIDAYS,
    )
    assert result.base_norm_hours == Decimal("1970")  # (40/5) × 247 − 6
    assert result.scheduled_shifts in (91, 92)
