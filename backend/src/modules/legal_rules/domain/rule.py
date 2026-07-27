"""`Rule` aggregate — Domain_Model_DDD_Sluzhebnoe_Vremya_FPS.md разд. 2.2.

`Rule` is the *identity* of a rule (e.g. "Норма служебного времени для
вредных условий") that persists across all its `RuleVersion` revisions.
`RuleVersion` is a concrete, dated, eventually-immutable revision — the
child Entity that actually carries `formula_definition`.

This module enforces, in plain Python with zero framework dependencies
(Backend_Architecture разд. 3.1), the two invariants that the DB layer
already enforces at the SQL level (PostgreSQL_Logical_Model разд. 1.5,
migration 0003) — deliberately duplicated here per Domain Model разд. 0:
the aggregate is supposed to be the thing that rejects an invalid state,
not merely a passive record that happens to also be checked by a
trigger. Domain unit tests (LR003) exercise this layer with zero DB.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any
from uuid import UUID, uuid4

from src.building_blocks.domain.aggregate_root import AggregateRoot
from src.building_blocks.domain.entity import Entity
from src.modules.legal_rules.domain.errors import (
    RuleVersionImmutableError,
    RuleVersionOverlapError,
)
from src.modules.legal_rules.domain.events import RuleVersionPublished
from src.modules.legal_rules.domain.value_objects import (
    EffectivePeriod,
    LegalBasis,
    RuleCategory,
    RuleStatus,
    Scope,
)

# Content fields that must never change once a RuleVersion leaves 'draft'
# (Domain Model инвариант 2.2.2) — mirrors the DB trigger's column list
# (migration 0003, fn_prevent_published_rule_version_edit), minus
# status/valid_to which the published->superseded transition legitimately
# changes.
_IMMUTABLE_AFTER_PUBLISH = frozenset({"scope", "legal_basis", "formula_definition", "valid_from"})


@dataclass(eq=False, kw_only=True)
class RuleVersion(Entity):
    rule_id: UUID
    version_no: int
    scope: Scope
    legal_basis: LegalBasis
    # Opaque to the domain — a JSON-serializable structure that Rule Engine
    # (not this module) knows how to parse as `list[Action]` (RE005).
    # Domain deliberately does not depend on Pydantic (Backend_Architecture
    # разд. 3.1/6.3), so it is stored here as plain dict/list primitives.
    formula_definition: Any
    valid_from: date
    valid_to: date | None = None
    status: RuleStatus = RuleStatus.DRAFT
    published_at: datetime | None = None
    published_by: UUID | None = None

    def __setattr__(self, name: str, value: Any) -> None:
        # Short-circuit BEFORE touching `getattr(self, "status", ...)`:
        # SQLAlchemy's ORM instrumentation sets its own internal state
        # marker (`_sa_instance_state`) on a freshly-`__new__`'d instance
        # via this same `__setattr__`, before that instance has any
        # queryable state at all — calling getattr() on ANY mapped
        # attribute at that exact moment raises `UnmappedInstanceError`.
        # Restricting the getattr to only the fields we actually guard
        # avoids ever touching `status` for unrelated attribute names.
        if name in _IMMUTABLE_AFTER_PUBLISH:
            # `current_status is None` covers two legitimate cases: (a)
            # plain Python construction, where the field genuinely doesn't
            # exist yet, and (b) SQLAlchemy pre-initializing every mapped
            # attribute to None before the dataclass __init__ body runs —
            # a real RuleStatus value is never None, so treating None the
            # same as DRAFT here is safe and keeps both paths working.
            current_status = getattr(self, "status", None)
            if current_status not in (None, RuleStatus.DRAFT):
                raise RuleVersionImmutableError(
                    f"rule_version {getattr(self, 'id', '?')} is "
                    f"{current_status} and immutable — cannot set '{name}'"
                )
        super().__setattr__(name, value)

    @property
    def effective_period(self) -> EffectivePeriod:
        return EffectivePeriod(valid_from=self.valid_from, valid_to=self.valid_to)

    def _supersede(self, *, valid_to: date) -> None:
        """Internal — called only by `Rule.publish_version` on the
        previously-active version for the same scope. Bypasses the normal
        immutability guard for exactly this one legitimate transition
        (published -> superseded), matching the DB trigger's own carve-out."""
        object.__setattr__(self, "valid_to", valid_to)
        object.__setattr__(self, "status", RuleStatus.SUPERSEDED)


@dataclass(eq=False, kw_only=True)
class Rule(AggregateRoot):
    code: str
    category: RuleCategory
    display_name: str
    description: str | None = None
    versions: list[RuleVersion] = field(default_factory=list)

    def draft_new_version(
        self,
        *,
        scope: Scope,
        legal_basis: LegalBasis,
        formula_definition: Any,
        valid_from: date,
        valid_to: date | None = None,
    ) -> RuleVersion:
        """Creates a new draft — never checked for overlap against existing
        published versions (Domain Model: "черновики не участвуют в
        проверке пересечения периодов действия", mirrored by the DB
        EXCLUDE constraint's `WHERE status <> 'draft'`). Overlap is only
        enforced at `publish_version` time."""
        next_version_no = max((v.version_no for v in self.versions), default=0) + 1
        version = RuleVersion(
            id=uuid4(),
            rule_id=self.id,
            version_no=next_version_no,
            scope=scope,
            legal_basis=legal_basis,
            formula_definition=formula_definition,
            valid_from=valid_from,
            valid_to=valid_to,
            status=RuleStatus.DRAFT,
        )
        self.versions.append(version)
        return version

    def get_version(self, version_id: UUID) -> RuleVersion:
        for version in self.versions:
            if version.id == version_id:
                return version
        raise KeyError(f"Rule {self.id} has no version {version_id}")

    def publish_version(
        self, version_id: UUID, *, published_by: UUID, now: datetime
    ) -> RuleVersion:
        """Domain Model разд. 2.2 инвариант 1: rejects overlap against any
        OTHER published/superseded version of the same scope. If exactly
        one currently-`published` version shares this scope, it is
        automatically superseded (`valid_to` set to the new version's
        `valid_from`) — this is the mechanism that keeps "ровно одна
        действующая версия на дату" true across a publish, not merely at
        rest."""
        new_version = self.get_version(version_id)
        if new_version.status != RuleStatus.DRAFT:
            raise RuleVersionImmutableError(
                f"rule_version {version_id} is already {new_version.status}, cannot re-publish"
            )

        new_period = new_version.effective_period
        currently_active: RuleVersion | None = None
        for other in self.versions:
            if other.id == new_version.id or other.status == RuleStatus.DRAFT:
                continue
            if other.scope != new_version.scope:
                continue
            if other.effective_period.overlaps(new_period):
                if (
                    other.status == RuleStatus.PUBLISHED
                    and other.valid_from < new_version.valid_from
                ):
                    # The one legitimate overlap: the version this publish
                    # supersedes. Anything else overlapping is a genuine
                    # conflict — reject it (mirrors the DB's EXCLUDE, but
                    # here so the *aggregate* is what refuses, not only SQL).
                    currently_active = other
                else:
                    raise RuleVersionOverlapError(
                        f"rule_version {version_id} (scope={new_version.scope.as_dict()}, "
                        f"{new_period}) overlaps existing {other.status} "
                        f"version {other.id} ({other.effective_period})"
                    )

        if currently_active is not None:
            currently_active._supersede(valid_to=new_version.valid_from)

        object.__setattr__(new_version, "status", RuleStatus.PUBLISHED)
        object.__setattr__(new_version, "published_at", now)
        object.__setattr__(new_version, "published_by", published_by)

        self.raise_event(
            RuleVersionPublished(
                rule_id=self.id, rule_version_id=new_version.id, version_no=new_version.version_no
            )
        )
        return new_version
