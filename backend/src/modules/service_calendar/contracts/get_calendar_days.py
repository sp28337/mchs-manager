"""Public Contract for `service_calendar` (Architecture разд. 4.2).

This is the surface every calculation reads. Three consumers are already
specified in Calculation_Engine_Algorithms_FPS.md:

* **Алгоритм Б шаги 5-7** — `count_days_by_type()`: the period norm is
  `(weekly_norm_hours / 5) × working_days_count − 1 × pre_holiday_days_count`.
* **Алгоритм Д** — `get_day_types()`: hours falling on a `holiday` date.
* **Алгоритм Е** — `get_day_types()`: hours falling on a `weekend` date.

`rule_engine/function_registry/calendar_functions.py` (RE008) is the
intended caller of the first one; it is not written yet, and this contract
exists so that it can be written against a boundary rather than against
`service_calendar`'s tables.

--- Two deliberate design decisions ------------------------------------

**Only PUBLISHED years are visible through this contract, and a period
that is not fully covered by published calendars raises rather than
returning partial data.** A draft calendar is an editing surface, not a
fact; letting one reach Алгоритм Б would produce a norm that is wrong in a
way nothing downstream can detect — the calculation would succeed, just
with fewer working days than the year really has. Domain Model разд. 4.1
инвариант 2 makes the same point from the other side: a published calendar
is what расчёты are entitled to treat as "надёжная историческая основа".
`CalendarPeriodUnavailable` is therefore an expected, handled outcome for
a caller, not a bug.

**Периоды are half-open `[period_start, period_end)`**, matching every
other interval in this codebase (`EffectivePeriod.overlaps`,
`SecondaryAssignment.overlaps`, the DB's `daterange(..., '[)')`). A period
that ends on the 1st does not include the 1st.

Consumers depend on this file only — never on `service_calendar.domain` or
`.infrastructure`. Like `personnel`'s contract, this module's own adapter
reaches into its own infrastructure for table metadata; that is on this
side of the boundary.
"""

from __future__ import annotations

from datetime import date
from typing import Protocol

from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.service_calendar.infrastructure.orm_mapping import (
    DAY_TYPE_VALUES,
    calendar_day_table,
    calendar_year_table,
)

__all__ = [
    "CalendarDayDto",
    "CalendarPeriodUnavailable",
    "GetCalendarDays",
    "count_days_by_type",
    "get_calendar_days",
    "get_day_types",
]


class CalendarPeriodUnavailable(Exception):
    """The requested period is not fully covered by published calendar
    years. Mapped to 422 by a calling module's API boundary: the request is
    well-formed, but the reference data needed to answer it does not exist
    yet."""


class CalendarDayDto(BaseModel):
    """A projection, not `service_calendar.domain.CalendarDay` — Architecture
    разд. 4.2 п.3. `day_type` is a plain string for the same reason
    `personnel`'s snapshot uses strings: the enum is this module's
    vocabulary, and importing it would mean importing its domain package."""

    model_config = ConfigDict(frozen=True)

    day: date
    day_type: str


class GetCalendarDays(Protocol):
    async def __call__(
        self, *, period_start: date, period_end: date
    ) -> list[CalendarDayDto]: ...


async def _assert_period_published(
    session: AsyncSession, *, period_start: date, period_end: date
) -> None:
    """Every calendar year the period touches must exist AND be published.

    Checks by YEAR rather than by counting days: a published year is
    complete by construction (`CalendarYear.publish()` refuses an
    incomplete one), so "all touched years are published" is exactly
    equivalent to "every date in the period has a day type" — and costs one
    small query instead of a per-date comparison.
    """
    if period_end <= period_start:
        raise ValueError("period_end must be strictly after period_start")

    # `period_end` is exclusive, so a period ending on 1 Jan does not touch
    # that year at all.
    last_included = date.fromordinal(period_end.toordinal() - 1)
    needed = set(range(period_start.year, last_included.year + 1))

    rows = await session.execute(
        select(calendar_year_table.c.year).where(
            calendar_year_table.c.year.in_(needed),
            calendar_year_table.c.published.is_(True),
        )
    )
    published = {row.year for row in rows}
    missing = sorted(needed - published)
    if missing:
        raise CalendarPeriodUnavailable(
            f"no published service calendar for year(s) {missing} — "
            f"cannot answer for period [{period_start}, {period_end})"
        )


async def get_calendar_days(
    session: AsyncSession, *, period_start: date, period_end: date
) -> list[CalendarDayDto]:
    """All day types in `[period_start, period_end)`, ordered by date.

    Used by Алгоритм Д (holiday classification) and Алгоритм Е (weekend
    classification), both of which need per-date types rather than counts.
    """
    await _assert_period_published(session, period_start=period_start, period_end=period_end)

    rows = await session.execute(
        select(calendar_day_table.c.day, calendar_day_table.c.day_type)
        .where(
            calendar_day_table.c.day >= period_start,
            calendar_day_table.c.day < period_end,
        )
        .order_by(calendar_day_table.c.day)
    )
    return [CalendarDayDto(day=row.day, day_type=row.day_type) for row in rows]


async def get_day_types(
    session: AsyncSession, *, period_start: date, period_end: date
) -> dict[date, str]:
    """`get_calendar_days()` keyed by date — the lookup shape Алгоритмы Д/Е
    actually want, since both ask "what type is THIS date" per fact interval."""
    days = await get_calendar_days(session, period_start=period_start, period_end=period_end)
    return {entry.day: entry.day_type for entry in days}


async def count_days_by_type(
    session: AsyncSession, *, period_start: date, period_end: date
) -> dict[str, int]:
    """Counts per `day_type` over `[period_start, period_end)` — the exact
    input of Алгоритм Б шаг 6 (`working_days_count`,
    `pre_holiday_days_count`).

    Aggregated in SQL rather than by counting a fetched list: an annual
    accounting period is 365 rows to transfer for four numbers, and this
    runs once per employee per period.

    Every `DayType` is present in the result, zero-filled — a caller doing
    `counts["pre_holiday"]` must not have to care whether the period
    happened to contain one.
    """
    await _assert_period_published(session, period_start=period_start, period_end=period_end)

    rows = await session.execute(
        select(calendar_day_table.c.day_type, func.count().label("day_count"))
        .where(
            calendar_day_table.c.day >= period_start,
            calendar_day_table.c.day < period_end,
        )
        .group_by(calendar_day_table.c.day_type)
    )
    counts: dict[str, int] = dict.fromkeys(DAY_TYPE_VALUES, 0)
    for row in rows:
        counts[row.day_type] = row.day_count
    return counts
