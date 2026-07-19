"""Clock port — makes 'now' injectable so domain/application tests can
freeze time (needed heavily here: norm calculation, rule effective-date
resolution, retroactive recalculation all depend on 'as of' dates)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...
    def today(self) -> date: ...


class SystemClock:
    """Default production implementation."""

    def now(self) -> datetime:
        from datetime import UTC

        return datetime.now(UTC)

    def today(self) -> date:
        return self.now().date()
