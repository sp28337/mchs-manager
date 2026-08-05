"""SC008 — производственный календарь на 2026 год (STATUTORY BASELINE).

    python -m scripts.seed_calendar_2026

--- READ THIS BEFORE USING THE RESULT FOR ANY REAL CALCULATION ---------

SC008's DoD asks for day types "по официальному производственному
календарю РФ". What this script produces is the **statutory baseline** —
everything derivable from the law itself:

* нерабочие праздничные дни (ТК РФ ст. 112 ч. 1);
* Saturdays and Sundays as выходные;
* the automatic transfer of ст. 112 ч. 2 — a выходной coinciding with a
  нерабочий праздничный день moves to the next working day;
* предпраздничные дни (ст. 95) — a working day immediately preceding a
  нерабочий праздничный день.

What it does **not** contain is the annual Government decree "О переносе
выходных дней в 2026 году". That decree is what moves the New Year
weekends (in 2026: Saturday 3 and Sunday 4 January, both of which fall
inside the 1-8 January holiday block) to other dates, and it is issued
separately each year. It is not derivable from the law, and this file
does not guess at it: `DECREE_TRANSFERS` below is deliberately EMPTY, with
the exact shape a maintainer needs to fill in.

Consequence, stated plainly: until the decree is entered, this calendar
has **two fewer non-working days than the official one**, so any
`working_days_count` taken from it is up to two days too high, and any
норма computed from it (Алгоритм Б) is correspondingly too large. That is
a real, money-affecting error.

Two things keep it from doing damage in the meantime:

1. The script leaves the year **unpublished**. `service_calendar`'s public
   Contract serves published years only, so no calculation can read this
   calendar until a human publishes it — which is the point at which
   somebody has to have looked at it.
2. It prints the discrepancy on every run.

Verifying the decree and filling in `DECREE_TRANSFERS` is exactly the kind
of open legal question SRS разд. 9.3 says must be closed by the customer's
legal block before development relies on it.
"""

from __future__ import annotations

import asyncio
from datetime import date, timedelta

from src.building_blocks.infrastructure.db import dispose_engine, get_session, init_engine
from src.composition.settings import get_settings
from src.modules.service_calendar.domain.calendar_year import CalendarYear
from src.modules.service_calendar.domain.value_objects import DayType, days_in_year
from src.modules.service_calendar.infrastructure.orm_mapping import start_mappers
from src.modules.service_calendar.infrastructure.repositories import CalendarYearRepository

YEAR = 2026

# ТК РФ ст. 112 ч. 1 — fixed calendar dates, identical every year.
_STATUTORY_HOLIDAYS: tuple[tuple[int, int], ...] = (
    (1, 1), (1, 2), (1, 3), (1, 4), (1, 5), (1, 6), (1, 7), (1, 8),  # новогодние + Рождество
    (2, 23),   # День защитника Отечества
    (3, 8),    # Международный женский день
    (5, 1),    # Праздник Весны и Труда
    (5, 9),    # День Победы
    (6, 12),   # День России
    (11, 4),   # День народного единства
)

# The 1-8 January block: ст. 112 ч. 2's automatic "move to the next working
# day" rule does NOT apply here — transfers out of the New Year holidays are
# set by the annual Government decree instead.
_NEW_YEAR_BLOCK = frozenset(date(YEAR, 1, d) for d in range(1, 9))

# Postановление Правительства РФ "О переносе выходных дней в 2026 году".
# EMPTY ON PURPOSE — see the module docstring. Fill in as
# {выходной_день_который_переносится: дата_на_которую_переносится}, e.g.
#     date(2026, 1, 3): date(2026, 5, 8),
DECREE_TRANSFERS: dict[date, date] = {}


def _all_dates(year: int) -> list[date]:
    start = date(year, 1, 1)
    return [start + timedelta(days=i) for i in range(days_in_year(year))]


def compute_day_types(year: int) -> dict[date, DayType]:
    """The statutory baseline, computed rather than tabulated — a hand-typed
    365-line table is exactly the kind of thing that acquires a typo nobody
    notices until a norm comes out wrong."""
    holidays = {date(year, month, day) for month, day in _STATUTORY_HOLIDAYS}

    # 1. Base: weekends by weekday, everything else working.
    types: dict[date, DayType] = {
        d: (DayType.WEEKEND if d.weekday() >= 5 else DayType.WORKING) for d in _all_dates(year)
    }

    # 2. Statutory holidays override the base.
    for holiday in holidays:
        types[holiday] = DayType.HOLIDAY

    # 3. ст. 112 ч. 2 — a holiday landing on a weekend pushes a day off to
    #    the next working day. Skipped for the New Year block (decree).
    for holiday in sorted(holidays):
        if holiday in _NEW_YEAR_BLOCK or holiday.weekday() < 5:
            continue
        cursor = holiday + timedelta(days=1)
        while types.get(cursor) != DayType.WORKING:
            cursor += timedelta(days=1)
            if cursor.year != year:  # pragma: no cover — unreachable for these dates
                break
        if types.get(cursor) == DayType.WORKING:
            types[cursor] = DayType.WEEKEND

    # 4. The Government decree, if a maintainer has entered it.
    for moved_from, moved_to in DECREE_TRANSFERS.items():
        types[moved_from] = DayType.WORKING
        types[moved_to] = DayType.WEEKEND

    # 5. ст. 95 — a WORKING day immediately preceding a нерабочий
    #    праздничный день is shortened by an hour. Note this keys off
    #    holidays only, never off transferred days off, and that 31 December
    #    looks across the year boundary at 1 January.
    next_new_year = date(year + 1, 1, 1)
    for day, day_type in list(types.items()):
        if day_type != DayType.WORKING:
            continue
        following = day + timedelta(days=1)
        if following in holidays or following == next_new_year:
            types[day] = DayType.PRE_HOLIDAY

    return types


async def seed() -> tuple[CalendarYear, dict[str, int]]:
    start_mappers()
    settings = get_settings()
    init_engine(dsn=settings.database_dsn, pool_size=settings.database_pool_size)

    try:
        async for session in get_session():
            repo = CalendarYearRepository(session)
            calendar = await repo.get_by_year(YEAR)
            if calendar is None:
                calendar = CalendarYear.create(year=YEAR)
                repo.add(calendar)

            if calendar.published:
                # Nothing to do, and nothing that CAN be done — a published
                # year is immutable by design (Domain Model разд. 4.1
                # инвариант 2).
                return calendar, _summary(calendar)

            day_types = compute_day_types(YEAR)
            calendar.set_days(sorted(day_types.items()))
            await session.commit()
            return calendar, _summary(calendar)
        raise RuntimeError("session dependency yielded nothing")
    finally:
        await dispose_engine()


def _summary(calendar: CalendarYear) -> dict[str, int]:
    return {day_type.value: calendar.count_of(day_type) for day_type in DayType}


async def _main() -> None:
    calendar, summary = await seed()
    print(f"service calendar {YEAR}: {len(calendar.days)} days — {summary}")
    print(f"published: {calendar.published}")

    if not DECREE_TRANSFERS:
        pending = sorted(d for d in _NEW_YEAR_BLOCK if d.weekday() >= 5)
        print(
            "\nWARNING: statutory baseline only — the Government transfer decree for "
            f"{YEAR} has NOT been applied.\n"
            f"  {len(pending)} New Year weekend day(s) have no compensating day off: "
            f"{', '.join(d.isoformat() for d in pending)}\n"
            f"  working_days_count is therefore up to {len(pending)} too high, and every "
            "норма derived from it too large.\n"
            "  Fill in DECREE_TRANSFERS in this file, re-run, and only then publish the year."
        )


if __name__ == "__main__":
    asyncio.run(_main())
