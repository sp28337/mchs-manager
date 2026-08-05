"""Ports the `service_calendar` Application layer depends on.

Same inversion, and same reason, as the other modules' `ports.py`:
`.importlinter`'s `layers-service-calendar` contract forbids
`application -> infrastructure`, so handlers depend on this Protocol and
the concrete `CalendarYearRepository` is injected by the caller.
"""

from __future__ import annotations

from typing import Protocol
from uuid import UUID

from src.modules.service_calendar.domain.calendar_year import CalendarYear


class CalendarYearRepositoryPort(Protocol):
    async def get(self, calendar_year_id: UUID) -> CalendarYear | None: ...
    async def get_by_year(self, year: int) -> CalendarYear | None: ...
    def add(self, calendar_year: CalendarYear) -> None: ...
