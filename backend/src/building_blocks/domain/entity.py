"""Base Entity: identity-based equality, no framework dependencies.

Per Backend_Architecture_FastAPI_Stack_FPS.md разд. 3.1: domain classes are
plain dataclasses, never SQLAlchemy Declarative or Pydantic BaseModel, so
that domain unit tests run with zero infrastructure imports.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID


@dataclass(eq=False, kw_only=True)
class Entity:
    """Base class for any object whose identity — not its attributes —
    determines equality (DDD: Entity).
    """

    id: UUID

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Entity):
            return NotImplemented
        if type(self) is not type(other):
            return False
        return self.id == other.id

    def __hash__(self) -> int:
        return hash((type(self), self.id))


@dataclass(eq=False, kw_only=True)
class _EntityWithVersion(Entity):
    """Optional optimistic-concurrency mixin — not used unless a module
    needs it explicitly (kept out of the base Entity to avoid imposing a
    versioning scheme on aggregates that don't need one, e.g. append-only
    entities like ServiceRecordEntry)."""

    version: int = field(default=0)
