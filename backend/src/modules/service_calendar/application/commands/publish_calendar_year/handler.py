"""Handler for `PublishCalendarYearCommand` (SC004).

Completeness and immutability are `CalendarYear.publish()`'s decisions —
the handler orchestrates and lets `IncompleteCalendarYearError` /
`CalendarYearPublishedError` propagate to the API boundary for mapping
(Architecture разд. 6).
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.clock import Clock, SystemClock
from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.service_calendar.application.commands.publish_calendar_year.command import (
    PublishCalendarYearCommand,
)
from src.modules.service_calendar.application.ports import CalendarYearRepositoryPort
from src.modules.service_calendar.domain.calendar_year import CalendarYear
from src.modules.service_calendar.domain.errors import CalendarYearNotFoundError


class PublishCalendarYearHandler:
    def __init__(
        self,
        session: AsyncSession,
        repo: CalendarYearRepositoryPort,
        outbox: OutboxWriter,
        clock: Clock | None = None,
    ) -> None:
        self._session = session
        self._repo = repo
        self._outbox = outbox
        self._clock = clock or SystemClock()

    async def handle(self, command: PublishCalendarYearCommand) -> CalendarYear:
        calendar = await self._repo.get_by_year(command.year)
        if calendar is None:
            raise CalendarYearNotFoundError(str(command.year))

        calendar.publish(now=self._clock.now())
        # CalendarYearPublished — событие, по которому инвалидируется кэш
        # справочных данных (Backend_Architecture разд. 4).
        await self._outbox.enqueue(calendar)
        await self._session.commit()
        return calendar
