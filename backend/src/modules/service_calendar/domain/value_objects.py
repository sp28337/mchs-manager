"""Value objects and enums for the ServiceCalendar domain
(Domain_Model_DDD_Sluzhebnoe_Vremya_FPS.md, разд. 4). Plain dataclasses
only — no Pydantic, no SQLAlchemy (Backend_Architecture разд. 3.1).
"""

from __future__ import annotations

import calendar as _calendar
from enum import StrEnum


class DayType(StrEnum):
    """Mirrors `service_calendar.day_type` (migration 0009) and
    `openapi.yaml`'s `DayType`.

    The four values are not interchangeable labels — each is consumed by a
    different algorithm, and confusing two of them changes a number:

    * `WORKING` — counted by Алгоритм Б шаг 6 as `working_days_count`, the
      multiplier of the whole period norm.
    * `PRE_HOLIDAY` — subtracts one hour per day from the norm (Алгоритм Б
      шаг 7) and, explicitly, takes NO part in holiday classification
      (Алгоритм Д шаг 4: "pre_holiday **не** участвует в этой
      классификации... это разные, не взаимозаменяемые роли одного и того
      же признака календаря").
    * `HOLIDAY` — classifies hours as holiday hours (Алгоритм Д).
    * `WEEKEND` — classifies hours as weekend hours (Алгоритм Е).
    """

    WORKING = "working"
    WEEKEND = "weekend"
    HOLIDAY = "holiday"
    PRE_HOLIDAY = "pre_holiday"


def days_in_year(year: int) -> int:
    """366 in a leap year, 365 otherwise — the target `CalendarYear` must
    hit exactly for Domain Model разд. 4.1 инвариант 1 ("каждая дата года
    представлена ровно одним CalendarDay") to hold."""
    return 366 if _calendar.isleap(year) else 365
