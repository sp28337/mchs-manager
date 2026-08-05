"""PE002 — `ServiceRecordEntry` and `SecondaryAssignment`: the two child
entities of the `Employee` aggregate.

Both are reachable only through `Employee` (Domain Model разд. 1.1) —
nothing loads or saves them on their own, and there is no
`ServiceRecordRepository`.

`ServiceRecordEntry` is **append-only** (Domain Model разд. 13: "история
никогда не перезаписывается"). That rule is enforced in two independent
places, on purpose: a `BEFORE UPDATE OR DELETE` trigger in the DB
(migration 0008) and the `__setattr__` guard below. The DB trigger is the
one that actually cannot be circumvented; the guard exists so that the
aggregate is what refuses — the same reasoning `legal_rules`' `RuleVersion`
gives for duplicating its EXCLUDE constraint in Python (rule.py docstring),
and so that the unit tests can prove the rule with no DB at all.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any
from uuid import UUID

from src.building_blocks.domain.entity import Entity
from src.modules.personnel.domain.errors import PersonnelDomainError
from src.modules.personnel.domain.value_objects import ServiceRecordEventType

# Everything except `recorded_at` itself — which is what the guard reads to
# tell "still being constructed" from "already recorded" (see below).
_APPEND_ONLY_FIELDS = frozenset(
    {"employee_id", "event_type", "effective_date", "position_id", "unit_id", "rank"}
)


class ServiceRecordImmutableError(PersonnelDomainError):
    """Attempt to modify an already-recorded `ServiceRecordEntry`. Maps to
    423 Locked (API_Conventions разд. 3), the same code the equivalent
    attempt on a published `RuleVersion` gets."""


@dataclass(eq=False, kw_only=True)
class ServiceRecordEntry(Entity):
    """Запись истории прохождения службы. Mirrors `openapi.yaml`'s
    `ServiceRecordEntry` and `personnel.service_record_entry` (migration
    0008), including that table's `ck_service_record_payload`: which of
    `position_id`/`unit_id`/`rank` is mandatory depends on `event_type`,
    checked in `__post_init__` so a nonsensical entry cannot be built at
    all — not merely rejected on flush.
    """

    employee_id: UUID
    event_type: ServiceRecordEventType
    effective_date: date
    position_id: UUID | None = None
    unit_id: UUID | None = None
    rank: str | None = None
    # Declared LAST deliberately: a dataclass `__init__` assigns fields in
    # declaration order, so every guarded field is set while `recorded_at`
    # is still absent, and the guard below only starts biting afterwards.
    recorded_at: datetime | None = None

    def __post_init__(self) -> None:
        required = {
            ServiceRecordEventType.ASSIGNMENT: ("position_id", self.position_id),
            ServiceRecordEventType.TRANSFER: ("unit_id", self.unit_id),
            ServiceRecordEventType.RANK_CHANGE: ("rank", self.rank),
        }.get(self.event_type)
        if required is not None and required[1] is None:
            raise ValueError(
                f"service record entry of type '{self.event_type}' requires {required[0]}"
            )

    def __setattr__(self, name: str, value: Any) -> None:
        # Same short-circuit-before-getattr shape, and for the same reason,
        # as `legal_rules`' `RuleVersion.__setattr__`: SQLAlchemy's ORM
        # instrumentation sets its own internal state marker through this
        # method before the instance has any queryable state, so the
        # getattr must never run for unrelated attribute names.
        if name in _APPEND_ONLY_FIELDS and getattr(self, "recorded_at", None) is not None:
            raise ServiceRecordImmutableError(
                f"service_record_entry {getattr(self, 'id', '?')} was recorded at "
                f"{self.recorded_at} and is append-only — cannot set '{name}'"
            )
        super().__setattr__(name, value)


@dataclass(eq=False, kw_only=True)
class SecondaryAssignment(Entity):
    """Совмещение — an additional post held alongside the primary one for a
    bounded period. `valid_to=None` means open-ended, matching the
    `coalesce(valid_to, 'infinity')` the EXCLUDE constraint applies
    (migration 0008) and the same convention `legal_rules`'
    `EffectivePeriod` uses.
    """

    employee_id: UUID
    position_id: UUID
    unit_id: UUID
    valid_from: date
    valid_to: date | None = None

    def __post_init__(self) -> None:
        if self.valid_to is not None and self.valid_to <= self.valid_from:
            raise ValueError("valid_to must be strictly after valid_from")

    def overlaps(self, other: SecondaryAssignment) -> bool:
        """Half-open interval overlap — identical semantics to the DB's
        `daterange(..., '[)') WITH &&`, so the domain and the constraint
        can never disagree about a boundary date."""
        self_end = self.valid_to or date.max
        other_end = other.valid_to or date.max
        return self.valid_from < other_end and other.valid_from < self_end

    def covers(self, as_of: date) -> bool:
        return self.valid_from <= as_of and (self.valid_to is None or self.valid_to > as_of)
