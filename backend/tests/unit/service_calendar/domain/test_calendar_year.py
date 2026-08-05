"""SC001/SC004 — unit tests for the `CalendarYear` aggregate. Pure domain,
no DB.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from src.modules.service_calendar.domain.calendar_year import CalendarYear
from src.modules.service_calendar.domain.errors import (
    CalendarYearPublishedError,
    DayOutsideCalendarYearError,
    IncompleteCalendarYearError,
)
from src.modules.service_calendar.domain.events import CalendarYearPublished
from src.modules.service_calendar.domain.value_objects import DayType, days_in_year

NOW = datetime.now(UTC)


def _all_days(year: int, day_type: DayType = DayType.WORKING) -> list[tuple[date, DayType]]:
    start = date(year, 1, 1)
    return [(start + timedelta(days=i), day_type) for i in range(days_in_year(year))]


def _full_year(year: int = 2026) -> CalendarYear:
    calendar = CalendarYear.create(year=year)
    calendar.set_days(_all_days(year))
    return calendar


# ------------------------------------------------------------------- days


def test_set_days_records_the_day_type() -> None:
    calendar = CalendarYear.create(year=2026)
    calendar.set_days([(date(2026, 1, 1), DayType.HOLIDAY), (date(2026, 1, 2), DayType.WEEKEND)])

    assert calendar.day_type_of(date(2026, 1, 1)) == DayType.HOLIDAY
    assert calendar.day_type_of(date(2026, 1, 2)) == DayType.WEEKEND
    assert calendar.day_type_of(date(2026, 1, 3)) is None


def test_a_day_outside_the_year_is_rejected() -> None:
    """SC001's DoD verbatim."""
    calendar = CalendarYear.create(year=2026)
    with pytest.raises(DayOutsideCalendarYearError):
        calendar.set_days([(date(2027, 1, 1), DayType.WORKING)])


def test_setting_the_same_date_twice_replaces_rather_than_duplicates() -> None:
    """Инвариант 1's "без дублей" half, across repeated calls of a bulk
    endpoint — the case a naive append would get wrong."""
    calendar = CalendarYear.create(year=2026)
    calendar.set_days([(date(2026, 5, 1), DayType.WORKING)])
    calendar.set_days([(date(2026, 5, 1), DayType.HOLIDAY)])

    assert len(calendar.days) == 1
    assert calendar.day_type_of(date(2026, 5, 1)) == DayType.HOLIDAY


def test_counts_by_type_feed_the_norm_calculation() -> None:
    """Алгоритм Б шаг 6 reads exactly these two counts."""
    calendar = CalendarYear.create(year=2026)
    calendar.set_days(
        [
            (date(2026, 1, 8), DayType.WORKING),
            (date(2026, 1, 9), DayType.WORKING),
            (date(2026, 1, 10), DayType.WEEKEND),
            (date(2026, 2, 20), DayType.PRE_HOLIDAY),
        ]
    )
    assert calendar.count_of(DayType.WORKING) == 2
    assert calendar.count_of(DayType.WEEKEND) == 1
    assert calendar.count_of(DayType.PRE_HOLIDAY) == 1
    assert calendar.count_of(DayType.HOLIDAY) == 0


# ---------------------------------------------------------------- coverage


@pytest.mark.parametrize(("year", "expected"), [(2026, 365), (2028, 366)])
def test_completeness_requires_every_day_of_the_year(year: int, expected: int) -> None:
    calendar = CalendarYear.create(year=year)
    assert not calendar.is_complete

    calendar.set_days(_all_days(year))
    assert len(calendar.days) == expected
    assert calendar.is_complete
    assert calendar.missing_day_count() == 0


def test_publishing_an_incomplete_year_is_rejected() -> None:
    """Инвариант 1 is enforced at publication: a gap would make Алгоритм Б
    under-count `working_days_count` and produce a wrong norm silently."""
    calendar = CalendarYear.create(year=2026)
    calendar.set_days(_all_days(2026)[:-1])  # one day short

    with pytest.raises(IncompleteCalendarYearError, match="1 missing"):
        calendar.publish(now=NOW)

    assert not calendar.published


# ----------------------------------------------------------------- publish


def test_publish_freezes_the_year_and_raises_its_event() -> None:
    calendar = _full_year()
    calendar.publish(now=NOW)

    assert calendar.published
    assert calendar.published_at == NOW

    events = calendar.pull_pending_events()
    assert len(events) == 1
    event = events[0]
    assert isinstance(event, CalendarYearPublished)
    assert event.year == 2026


def test_a_published_year_refuses_further_edits() -> None:
    """SC004's DoD verbatim: "Изменение дня после публикации отклоняется"."""
    calendar = _full_year()
    calendar.publish(now=NOW)

    with pytest.raises(CalendarYearPublishedError):
        calendar.set_days([(date(2026, 5, 1), DayType.HOLIDAY)])


def test_publishing_twice_is_rejected() -> None:
    calendar = _full_year()
    calendar.publish(now=NOW)

    with pytest.raises(CalendarYearPublishedError):
        calendar.publish(now=NOW)


def test_a_published_year_cannot_be_un_published() -> None:
    """Un-publishing would re-open every day of a year that finalized
    periods already cite (Алгоритм М reads it to reproduce past results)."""
    calendar = _full_year()
    calendar.publish(now=NOW)

    with pytest.raises(CalendarYearPublishedError):
        calendar.published = False
