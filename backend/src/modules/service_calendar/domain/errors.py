"""Domain-level exceptions for ServiceCalendar. Raised by aggregate
methods only; mapped to HTTP at the API boundary (API_Conventions разд. 3).
"""

from __future__ import annotations


class ServiceCalendarDomainError(Exception):
    """Base class for every error raised from this module's domain layer."""


class CalendarYearPublishedError(ServiceCalendarDomainError):
    """Domain Model разд. 4.1 инвариант 2: a published `ServiceCalendar` is
    immutable — it is what historical recalculation (Алгоритм М) reads to
    reproduce a past result. Maps to 423 Locked."""


class DayOutsideCalendarYearError(ServiceCalendarDomainError):
    """SC001's DoD: "Попытка задать день за пределами года отклоняется".
    Mirrors `ck_calendar_day_in_year` (migration 0009). Maps to 422."""


class IncompleteCalendarYearError(ServiceCalendarDomainError):
    """Domain Model разд. 4.1 инвариант 1: "каждая дата года представлена
    ровно одним CalendarDay (полное покрытие без пропусков и дублей)".

    Raised at PUBLICATION, not on every edit — a year under construction is
    legitimately incomplete, but publishing one with a gap would let
    Алгоритм Б silently under-count `working_days_count` and produce a norm
    that is simply wrong, with nothing to indicate it. Maps to 422.
    """


class CalendarYearNotFoundError(ServiceCalendarDomainError):
    """No `CalendarYear` for the requested year. Maps to 404."""


class CalendarYearAlreadyExistsError(ServiceCalendarDomainError):
    """`uq_calendar_year` (migration 0009) — one row per year. Maps to 409."""
