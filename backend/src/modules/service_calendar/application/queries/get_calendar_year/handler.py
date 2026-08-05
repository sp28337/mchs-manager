"""Handler for `GetCalendarYearQuery` (SC005).

Returns the aggregate with its days attached (`lazy="selectin"` in
`orm_mapping.py`) — SC005's DoD is "Запрос возвращает полный список дней с
типами", and the API layer projects that into the response DTO.
"""

from __future__ import annotations

from src.modules.service_calendar.application.ports import CalendarYearRepositoryPort
from src.modules.service_calendar.application.queries.get_calendar_year.query import (
    GetCalendarYearQuery,
)
from src.modules.service_calendar.domain.calendar_year import CalendarYear
from src.modules.service_calendar.domain.errors import CalendarYearNotFoundError


class GetCalendarYearHandler:
    def __init__(self, repo: CalendarYearRepositoryPort) -> None:
        self._repo = repo

    async def handle(self, query: GetCalendarYearQuery) -> CalendarYear:
        calendar = await self._repo.get_by_year(query.year)
        if calendar is None:
            raise CalendarYearNotFoundError(str(query.year))
        return calendar
