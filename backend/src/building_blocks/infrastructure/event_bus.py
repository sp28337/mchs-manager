"""IEventBus port. Concrete impl: Redis Streams (Backend_Architecture,
разд. 4 — XADD/XREADGROUP), swappable later without touching module code."""

from __future__ import annotations

from typing import Protocol

from src.building_blocks.domain.domain_event import DomainEvent


class EventBus(Protocol):
    async def publish(self, event: DomainEvent) -> None: ...
