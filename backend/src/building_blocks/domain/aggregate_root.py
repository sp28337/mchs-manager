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

    def _events_buffer(self) -> list[DomainEvent]:
        """`_pending_events`' `default_factory=list` only runs inside the
        dataclass-generated `__init__` — but SQLAlchemy's ORM hydration
        (loading an aggregate back from the DB) bypasses `__init__`
        entirely (constructs via `__new__` then sets mapped attributes
        directly). `_pending_events` isn't even a mapped column (it's
        deliberately absent from every `orm_mapping.py` Table()), so a
        freshly-loaded aggregate has no such attribute at all — calling
        `raise_event()` on one (e.g. `Rule.publish_version()` on a `Rule`
        just loaded by a repository) raised a raw `AttributeError` before
        this lazy-init fix, found only via a full HTTP-level integration
        test that loads-then-mutates within a single request."""
        events = getattr(self, "_pending_events", None)
        if events is None:
            events = []
            self._pending_events = events
        return events

    def raise_event(self, event: DomainEvent) -> None:
        self._events_buffer().append(event)

    def pull_pending_events(self) -> list[DomainEvent]:
        """Drain and return buffered events. Called by the repository right
        before committing — never by the aggregate's own methods, and never
        by Application-layer code directly (keeps event emission a detail
        of persistence, not of orchestration)."""
        events = self._events_buffer()
        self._pending_events = []
        return events
