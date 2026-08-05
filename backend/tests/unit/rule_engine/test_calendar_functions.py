"""RE009 — юнит-тесты календарных функций. Без БД: функции чистые, а
календарь строится тем же чистым кодом, что и seed (SC008).

DoD RE009 — «Тест сверяет результат с ручным расчётом по производственному
календарю». Ручной расчёт января 2026 приведён ниже полностью, чтобы
проверяемое число можно было пересчитать глазами, не запуская код.
"""

from __future__ import annotations

from datetime import date

import pytest

from scripts.seed_calendar_2026 import compute_day_types
from src.rule_engine.function_registry.calendar_functions import (
    IncompleteCalendarError,
    calendar_facts,
    holiday_days_count,
    pre_holiday_days_count,
    weekend_days_count,
    working_days_count,
)

# Тот же статутный базис, что кладёт в БД seed-скрипт. ВАЖНО: постановление
# Правительства о переносе выходных на 2026 год в нём не применено (см.
# docstring скрипта), поэтому числа ниже — статутные, а не официальные.
CALENDAR_2026 = compute_day_types(2026)

JAN_START = date(2026, 1, 1)
JAN_END = date(2026, 2, 1)


# --- Ручной расчёт января 2026 -----------------------------------------
#
# 1 января 2026 — четверг.
#
#   1-8   чт-чт   праздники (ТК РФ ст. 112: новогодние каникулы + Рождество)
#   9     пт      рабочий                                              → 1
#   10-11 сб-вс   выходные
#   12-16 пн-пт   рабочие                                              → 5
#   17-18 сб-вс   выходные
#   19-23 пн-пт   рабочие                                              → 5
#   24-25 сб-вс   выходные
#   26-30 пн-пт   рабочие                                              → 5
#   31    сб      выходной
#
#   рабочих:        1 + 5 + 5 + 5 = 16
#   выходных:       10,11,17,18,24,25,31 = 7
#   праздников:     1-8 = 8
#   предпраздничных: 0 (ближайший праздник — 23 февраля, до него далеко)
#   всего:          16 + 7 + 8 = 31 ✓
#
JAN_WORKING = 16
JAN_WEEKEND = 7
JAN_HOLIDAY = 8
JAN_PRE_HOLIDAY = 0


def test_working_days_count_january_2026() -> None:
    """DoD RE008 — «working_days_count(январь 2026) возвращает верное число
    по seed-календарю»."""
    assert (
        working_days_count(CALENDAR_2026, period_start=JAN_START, period_end=JAN_END)
        == JAN_WORKING
    )


def test_all_january_2026_counts_match_the_manual_tally() -> None:
    assert weekend_days_count(CALENDAR_2026, period_start=JAN_START, period_end=JAN_END) == (
        JAN_WEEKEND
    )
    assert holiday_days_count(CALENDAR_2026, period_start=JAN_START, period_end=JAN_END) == (
        JAN_HOLIDAY
    )
    assert pre_holiday_days_count(CALENDAR_2026, period_start=JAN_START, period_end=JAN_END) == (
        JAN_PRE_HOLIDAY
    )
    assert JAN_WORKING + JAN_WEEKEND + JAN_HOLIDAY + JAN_PRE_HOLIDAY == 31


def test_norm_for_january_2026_matches_algorithm_b_step_7() -> None:
    """Алгоритм Б шаг 7 целиком, на числах января:

        norm = (weekly_norm_hours / 5) × working_days − 1 × pre_holiday_days

    40 ч/нед (общая норма, ст. 54 ФЗ-141) → 8 × 16 − 0 = 128 ч
    36 ч/нед (вредные/опасные условия)    → 7.2 × 16 − 0 = 115.2 ч
    """
    facts = calendar_facts(CALENDAR_2026, period_start=JAN_START, period_end=JAN_END)

    def norm(weekly: float) -> float:
        return (weekly / 5) * facts["working_days_count"] - facts["pre_holiday_days_count"]

    assert norm(40) == 128.0
    assert norm(36) == pytest.approx(115.2)


def test_pre_holiday_days_are_counted_where_they_exist() -> None:
    """Апрель 2026: 30-е — четверг перед 1 мая, то есть предпраздничный.
    Норма апреля укорачивается ровно на один час."""
    facts = calendar_facts(
        CALENDAR_2026, period_start=date(2026, 4, 1), period_end=date(2026, 5, 1)
    )
    assert facts["pre_holiday_days_count"] == 1.0
    assert (40 / 5) * facts["working_days_count"] - facts["pre_holiday_days_count"] == (
        8 * facts["working_days_count"] - 1
    )


def test_a_transferred_day_off_lowers_the_working_day_count() -> None:
    """Март 2026: 8-е воскресенье, выходной перенесён на понедельник 9-е
    (ТК РФ ст. 112 ч. 2). 9 марта не рабочий, хотя это будний день."""
    assert CALENDAR_2026[date(2026, 3, 9)] == "weekend"
    march = calendar_facts(
        CALENDAR_2026, period_start=date(2026, 3, 1), period_end=date(2026, 4, 1)
    )
    # В марте 2026 22 будних дня, из которых 9-е стало выходным по переносу.
    weekdays_in_march = sum(
        1 for d in CALENDAR_2026 if d.month == 3 and d.year == 2026 and d.weekday() < 5
    )
    assert march["working_days_count"] == weekdays_in_march - 1


def test_a_whole_year_adds_up() -> None:
    facts = calendar_facts(
        CALENDAR_2026, period_start=date(2026, 1, 1), period_end=date(2027, 1, 1)
    )
    assert facts["calendar_days_count"] == 365.0
    assert (
        facts["working_days_count"]
        + facts["weekend_days_count"]
        + facts["holiday_days_count"]
        + facts["pre_holiday_days_count"]
        == 365.0
    )


# --- границы периода ---------------------------------------------------


def test_period_is_half_open() -> None:
    """`[1 янв, 8 янв)` — семь дней, не восемь. Та же семантика, что у
    контракта `service_calendar` и у всех интервалов в кодовой базе."""
    facts = calendar_facts(
        CALENDAR_2026, period_start=date(2026, 1, 1), period_end=date(2026, 1, 8)
    )
    assert facts["calendar_days_count"] == 7.0


def test_an_inverted_period_is_rejected() -> None:
    with pytest.raises(ValueError, match="period_end"):
        working_days_count(
            CALENDAR_2026, period_start=date(2026, 2, 1), period_end=date(2026, 1, 1)
        )


def test_a_gap_in_the_calendar_is_an_error_not_a_zero() -> None:
    """Пропущенный день занизил бы норму молча, поэтому это ошибка, а не
    ноль. В рабочем пути недостижимо: контракт отдаёт только
    опубликованные, а значит полные, годы."""
    holed = {d: t for d, t in CALENDAR_2026.items() if d != date(2026, 1, 15)}

    with pytest.raises(IncompleteCalendarError, match="2026-01-15"):
        working_days_count(holed, period_start=JAN_START, period_end=JAN_END)

    with pytest.raises(IncompleteCalendarError):
        calendar_facts(holed, period_start=JAN_START, period_end=JAN_END)
