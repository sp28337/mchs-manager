"""Base DomainEvent — see Domain_Model_DDD_Sluzhebnoe_Vremya_FPS.md, разд. 11."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID, uuid4


@dataclass(frozen=True, kw_only=True)
class DomainEvent:
    """A significant business fact that happened to an aggregate.

    Concrete events (ShiftActuallyPerformed, TimesheetApproved, ...) are
    declared per-module in `modules/<name>/domain/events.py` and subclass
    this. Domain events are part of the Ubiquitous Language, not a
    technical messaging concern — the Outbox/EventBus (building_blocks/
    infrastructure) is what turns them into integration events later.
    """

    event_id: UUID = field(default_factory=uuid4)
    occurred_at: datetime = field(default_factory=lambda: datetime.now(UTC))
