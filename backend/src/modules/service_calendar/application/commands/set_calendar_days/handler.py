"""Handler for `SetCalendarDaysCommand` (SC003).

One `session.commit()` for the whole batch — SC003's DoD ("Массовая
установка 366 дней проходит одной транзакцией") is satisfied by the
aggregate being saved as a unit, not by anything this handler does
specially: a partially applied calendar is exactly the silent-gap failure
`CalendarYear.publish()` exists to catch.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.service_calendar.application.commands.set_calendar_days.command import (
    SetCalendarDaysCommand,
)
from src.modules.service_calendar.application.ports import CalendarYearRepositoryPort
from src.modules.service_calendar.domain.calendar_year import CalendarYear
from src.modules.service_calendar.domain.errors import CalendarYearNotFoundError


class SetCalendarDaysHandler:
    def __init__(self, session: AsyncSession, repo: CalendarYearRepositoryPort) -> None:
        self._session = session
        self._repo = repo

    async def handle(self, command: SetCalendarDaysCommand) -> CalendarYear:
        calendar = await self._repo.get_by_year(command.year)
        if calendar is None:
            raise CalendarYearNotFoundError(str(command.year))

        calendar.set_days([(entry.day, entry.day_type) for entry in command.days])
        await self._session.commit()
        return calendar
