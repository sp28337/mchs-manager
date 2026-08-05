"""`CalendarYear` aggregate — Domain_Model_DDD_Sluzhebnoe_Vremya_FPS.md
разд. 4.1 (there named `ServiceCalendar`; renamed here to match the table
and the `openapi.yaml` schema, both of which call it `CalendarYear`, and
because "ServiceCalendar" is already the name of the whole module).

Aggregate scope: **one calendar year**. That is a deliberately small
boundary for what is conceptually one big reference table, and it is the
right one: a year is the unit that gets published, frozen and cited, so it
is the unit that must be loaded and saved atomically. Days are child
entities with no independent life — nothing addresses a `CalendarDay`
except through its year.

Why this aggregate is worth strict treatment despite being "just a
lookup": every norm in the system is computed from it (Алгоритм Б шаги
5-7), and two of the three hour-classification algorithms read it
(Алгоритм Д, Е). A wrong `day_type` does not produce an error anywhere —
it produces a slightly wrong norm, which becomes a slightly wrong
overtime figure, which becomes a wrong payment. Hence: complete coverage
enforced at publication, and immutability after it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any
from uuid import UUID, uuid4

from src.building_blocks.domain.aggregate_root import AggregateRoot
from src.building_blocks.domain.entity import Entity
from src.modules.service_calendar.domain.errors import (
    CalendarYearPublishedError,
    DayOutsideCalendarYearError,
    IncompleteCalendarYearError,
)
from src.modules.service_calendar.domain.events import CalendarYearPublished
from src.modules.service_calendar.domain.value_objects import DayType, days_in_year


@dataclass(eq=False, kw_only=True)
class CalendarDay(Entity):
    """{дата, DayType} — Domain Model разд. 4.1.

    `year` duplicates `day.year` because the DB column does, and the DB
    column exists to carry the composite foreign key that keeps a day
    inside its own year (migration 0009, guarantee 1). Kept in sync by
    construction below rather than by trusting the caller.
    """

    calendar_year_id: UUID
    year: int
    day: date
    day_type: DayType


@dataclass(eq=False, kw_only=True)
class CalendarYear(AggregateRoot):
    year: int
    published: bool = False
    published_at: datetime | None = None
    days: list[CalendarDay] = field(default_factory=list)

    @classmethod
    def create(cls, *, year: int) -> CalendarYear:
        return cls(id=uuid4(), year=year, published=False, published_at=None, days=[])

    def __setattr__(self, name: str, value: Any) -> None:
        # `published` is one-way (mirrors `fn_calendar_year_publish_is_one_way`,
        # migration 0009): un-publishing would silently re-open every day of
        # a year that finalized periods already cite.
        if name == "published" and value is False and getattr(self, "published", False):
            raise CalendarYearPublishedError(
                f"calendar year {getattr(self, 'year', '?')} cannot be un-published"
            )
        super().__setattr__(name, value)

    # ----------------------------------------------------------------- days

    def set_days(self, entries: list[tuple[date, DayType]]) -> None:
        """SC003 — bulk upsert of day types. Idempotent per date: setting a
        date that is already present replaces its type rather than adding a
        second row for it, which is what keeps "без дублей" (инвариант 1)
        true across repeated calls of a bulk endpoint.
        """
        self._require_not_published("set days on")

        by_date = {existing.day: existing for existing in self.days}
        for day, day_type in entries:
            if day.year != self.year:
                raise DayOutsideCalendarYearError(
                    f"{day.isoformat()} does not belong to calendar year {self.year}"
                )
            existing = by_date.get(day)
            if existing is not None:
                existing.day_type = day_type
            else:
                created = CalendarDay(
                    id=uuid4(),
                    calendar_year_id=self.id,
                    year=self.year,
                    day=day,
                    day_type=day_type,
                )
                self.days.append(created)
                by_date[day] = created

    def day_type_of(self, day: date) -> DayType | None:
        for entry in self.days:
            if entry.day == day:
                return entry.day_type
        return None

    def count_of(self, day_type: DayType) -> int:
        return sum(1 for entry in self.days if entry.day_type == day_type)

    @property
    def is_complete(self) -> bool:
        """Инвариант 1. `UNIQUE (calendar_year_id, day)` (migration 0009)
        already makes duplicates impossible, so a matching count is
        sufficient here — no need to also compare the set of dates."""
        return len(self.days) == days_in_year(self.year)

    def missing_day_count(self) -> int:
        return days_in_year(self.year) - len(self.days)

    # -------------------------------------------------------------- publish

    def publish(self, *, now: datetime) -> None:
        """SC004. Publication is the moment the year becomes citable by
        calculations, so completeness is checked HERE and not on every
        edit — see `IncompleteCalendarYearError`."""
        self._require_not_published("publish")

        if not self.is_complete:
            raise IncompleteCalendarYearError(
                f"calendar year {self.year} has {len(self.days)} of "
                f"{days_in_year(self.year)} days — {self.missing_day_count()} missing; "
                f"a published calendar must cover the year completely"
            )

        self.published = True
        self.published_at = now
        self.raise_event(
            CalendarYearPublished(calendar_year_id=self.id, year=self.year)
        )

    def _require_not_published(self, action: str) -> None:
        if self.published:
            raise CalendarYearPublishedError(
                f"calendar year {self.year} was published at {self.published_at} "
                f"and is immutable — cannot {action} it"
            )
