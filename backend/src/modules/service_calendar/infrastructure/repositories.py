"""SC002 — write-side repository for `CalendarYear`.

`ServiceCalendar` is not a CQRS module (Architecture разд. 8.2: "статичные
данные года, кэшируются целиком"), so reads go through this same
repository. The caching that разд. 8.2 refers to is the Redis
reference-data cache (Backend_Architecture разд. 4), which is NOT wired
yet — the same honest gap `legal_rules`' `RuleVersionCache` carries, and
for the same missing piece (no EventBus to deliver `CalendarYearPublished`
for invalidation).
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.service_calendar.domain.calendar_year import CalendarYear
from src.modules.service_calendar.infrastructure.orm_mapping import calendar_year_table


class CalendarYearRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, calendar_year_id: UUID) -> CalendarYear | None:
        return await self._session.get(CalendarYear, calendar_year_id)

    async def get_by_year(self, year: int) -> CalendarYear | None:
        """The lookup every caller actually uses — `openapi.yaml` addresses
        calendars by `{year}` in the path, not by id."""
        result = await self._session.execute(
            select(CalendarYear).where(calendar_year_table.c.year == year)
        )
        return result.scalar_one_or_none()

    def add(self, calendar_year: CalendarYear) -> None:
        self._session.add(calendar_year)
