"""Domain events for ServiceCalendar (Domain_Model_DDD разд. 11).

`CalendarYearPublished` has a concrete, already-specified consumer, unlike
most events raised so far: Backend_Architecture разд. 4 lists
`CalendarYearPublished` alongside `RuleVersionPublished` as the events
that invalidate the reference-data cache — "Инвалидация по событию... а не
только по TTL — устаревшие данные недопустимы даже кратковременно (норма/
коэффициент не может «протухнуть» неправильно)".

That consumer does not exist yet (no Outbox, no EventBus — the same gap
`legal_rules`' cache documents). The event is raised now so that wiring it
later is subscription work rather than a change to this aggregate.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from src.building_blocks.domain.domain_event import DomainEvent


@dataclass(frozen=True, kw_only=True)
class CalendarYearPublished(DomainEvent):
    calendar_year_id: UUID
    year: int
