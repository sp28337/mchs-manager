"""Handler for `CreateCalendarYearCommand` (SC003)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.service_calendar.application.commands.create_calendar_year.command import (
    CreateCalendarYearCommand,
)
from src.modules.service_calendar.application.ports import CalendarYearRepositoryPort
from src.modules.service_calendar.domain.calendar_year import CalendarYear
from src.modules.service_calendar.domain.errors import CalendarYearAlreadyExistsError


class CreateCalendarYearHandler:
    def __init__(self, session: AsyncSession, repo: CalendarYearRepositoryPort) -> None:
        self._session = session
        self._repo = repo

    async def handle(self, command: CreateCalendarYearCommand) -> CalendarYear:
        if await self._repo.get_by_year(command.year) is not None:
            raise CalendarYearAlreadyExistsError(str(command.year))

        calendar = CalendarYear.create(year=command.year)
        self._repo.add(calendar)
        # No UnitOfWork/Outbox yet (Architecture разд. 9.2) — same
        # temporary simplification as every other command handler here.
        await self._session.commit()
        return calendar
