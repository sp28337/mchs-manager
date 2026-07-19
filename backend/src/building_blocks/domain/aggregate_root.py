"""Base AggregateRoot — buffers domain events until the repository/UoW
flushes them into the Outbox in the same transaction as the state change
(Architecture, разд. 9.2 — Transactional Outbox).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from src.building_blocks.domain.domain_event import DomainEvent
from src.building_blocks.domain.entity import Entity


@dataclass(eq=False, kw_only=True)
class AggregateRoot(Entity):
    """Consistency boundary (DDD). Only AggregateRoot subclasses are loaded/
    saved directly by a Write-side repository; child Entities/Value Objects
    are reachable only through their owning aggregate.
    """

    _pending_events: list[DomainEvent] = field(default_factory=list, repr=False, compare=False)

    def raise_event(self, event: DomainEvent) -> None:
        self._pending_events.append(event)

    def pull_pending_events(self) -> list[DomainEvent]:
        """Drain and return buffered events. Called by the repository right
        before committing — never by the aggregate's own methods, and never
        by Application-layer code directly (keeps event emission a detail
        of persistence, not of orchestration)."""
        events, self._pending_events = self._pending_events, []
        return events
