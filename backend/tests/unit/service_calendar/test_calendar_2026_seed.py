"""SC008 — unit tests for the статутный baseline computed by
`scripts/seed_calendar_2026.py`. Pure function, no DB.

These pin the legal rules the seed encodes (ТК РФ ст. 95, 112), because a
wrong `day_type` here does not fail anywhere — it quietly changes every
норма computed from the year (Алгоритм Б шаги 6-7).
"""

from __future__ import annotations

from datetime import date

import pytest

from scripts.seed_calendar_2026 import DECREE_TRANSFERS, compute_day_types
from src.modules.service_calendar.domain.value_objects import DayType, days_in_year

TYPES = compute_day_types(2026)


def test_every_day_of_the_year_is_covered_exactly_once() -> None:
    assert len(TYPES) == days_in_year(2026) == 365


@pytest.mark.parametrize(
    ("day", "expected"),
    [
        # ст. 112 ч. 1 — новогодние каникулы и Рождество
        (date(2026, 1, 1), DayType.HOLIDAY),
        (date(2026, 1, 8), DayType.HOLIDAY),
        (date(2026, 1, 9), DayType.WORKING),
        # ст. 112 ч. 1 — остальные праздники
        (date(2026, 2, 23), DayType.HOLIDAY),
        (date(2026, 3, 8), DayType.HOLIDAY),
        (date(2026, 5, 1), DayType.HOLIDAY),
        (date(2026, 5, 9), DayType.HOLIDAY),
        (date(2026, 6, 12), DayType.HOLIDAY),
        (date(2026, 11, 4), DayType.HOLIDAY),
    ],
)
def test_statutory_holidays(day: date, expected: DayType) -> None:
    assert TYPES[day] == expected


@pytest.mark.parametrize(
    ("holiday", "transferred_to"),
    [
        # 8 марта 2026 — воскресенье; выходной переносится на понедельник.
        (date(2026, 3, 8), date(2026, 3, 9)),
        # 9 мая 2026 — суббота; 10-е воскресенье, значит на понедельник 11-е.
        (date(2026, 5, 9), date(2026, 5, 11)),
    ],
)
def test_a_holiday_on_a_weekend_pushes_a_day_off_to_the_next_working_day(
    holiday: date, transferred_to: date
) -> None:
    """ст. 112 ч. 2."""
    assert holiday.weekday() >= 5, "precondition: this holiday falls on a weekend in 2026"
    assert TYPES[holiday] == DayType.HOLIDAY
    assert TYPES[transferred_to] == DayType.WEEKEND


def test_new_year_weekends_are_not_transferred_automatically() -> None:
    """The 1-8 January block is governed by the annual Government decree,
    not by ст. 112 ч. 2 — so with `DECREE_TRANSFERS` empty, 3 and 4 January
    (Saturday and Sunday in 2026) get no compensating day off. This test
    documents the KNOWN GAP rather than endorsing it; see the script's
    module docstring."""
    assert DECREE_TRANSFERS == {}, "update this test when the 2026 decree is entered"

    assert TYPES[date(2026, 1, 3)] == DayType.HOLIDAY
    assert TYPES[date(2026, 1, 4)] == DayType.HOLIDAY
    # No transferred day off appears in the days right after the block.
    assert TYPES[date(2026, 1, 9)] == DayType.WORKING
    assert TYPES[date(2026, 1, 12)] == DayType.WORKING


@pytest.mark.parametrize(
    "day",
    [
        date(2026, 4, 30),  # перед 1 мая (пятница)
        date(2026, 5, 8),   # перед 9 мая (суббота)
        date(2026, 6, 11),  # перед 12 июня (пятница)
        date(2026, 11, 3),  # перед 4 ноября (среда)
        date(2026, 12, 31), # перед 1 января следующего года
    ],
)
def test_pre_holidays(day: date) -> None:
    """ст. 95 — рабочий день, непосредственно предшествующий нерабочему
    праздничному дню. Each subtracts an hour from the norm (Алгоритм Б шаг 7)."""
    assert TYPES[day] == DayType.PRE_HOLIDAY


@pytest.mark.parametrize(
    "day",
    [
        date(2026, 2, 22),  # воскресенье перед 23 февраля — не рабочий день
        date(2026, 3, 7),   # суббота перед 8 марта — не рабочий день
    ],
)
def test_a_non_working_day_before_a_holiday_is_not_a_pre_holiday(day: date) -> None:
    """ст. 95 shortens a WORKING day; a weekend before a holiday has no hour
    to lose."""
    assert TYPES[day] == DayType.WEEKEND


def test_counts_are_internally_consistent() -> None:
    counts = {day_type: sum(1 for t in TYPES.values() if t == day_type) for day_type in DayType}
    assert sum(counts.values()) == 365
    # 14 statutory holidays: 8 (Jan 1-8) + 6 others.
    assert counts[DayType.HOLIDAY] == 14
    assert counts[DayType.PRE_HOLIDAY] == 5
