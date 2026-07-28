"""`ConflictResolutionPolicy` aggregate — Domain_Model_DDD_Sluzhebnoe_Vremya_FPS.md
разд. 2.3. A separate aggregate from `Rule` despite being conceptually "a
special case of Rule" (Domain Model: "несмотря на то, что концептуально
это частный случай Rule, он выделен отдельно, так как имеет собственный
жизненный цикл и структуру") — its versioning has no `scope` dimension at
all (PostgreSQL_Logical_Model разд. 1.6: EXCLUDE by `policy_id` + period
only, no `scope_key`), so the publish/supersede logic below is
`rule.py`'s, minus the per-scope partitioning.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any
from uuid import UUID, uuid4

from src.building_blocks.domain.aggregate_root import AggregateRoot
from src.building_blocks.domain.entity import Entity
from src.modules.legal_rules.domain.errors import (
    ConflictPolicyDuplicateCategoryError,
    PolicyVersionImmutableError,
    PolicyVersionOverlapError,
)
from src.modules.legal_rules.domain.events import ConflictResolutionPolicyPublished
from src.modules.legal_rules.domain.value_objects import EffectivePeriod, RuleCategory, RuleStatus

_IMMUTABLE_AFTER_PUBLISH = frozenset({"precedence_list", "valid_from"})


@dataclass(eq=False, kw_only=True)
class ConflictResolutionPolicyVersion(Entity):
    policy_id: UUID
    version_no: int
    precedence_list: tuple[RuleCategory, ...]
    valid_from: date
    valid_to: date | None = None
    status: RuleStatus = RuleStatus.DRAFT

    def __post_init__(self) -> None:
        # Domain Model разд. 2.3 инвариант 1 — checked at construction, not
        # only at publish time, since a draft with duplicate categories is
        # already a nonsensical policy, not merely an unpublishable one.
        if len(set(self.precedence_list)) != len(self.precedence_list):
            raise ConflictPolicyDuplicateCategoryError(
                f"precedence_list contains duplicate categories: {self.precedence_list}"
            )

    def __setattr__(self, name: str, value: Any) -> None:
        # Same short-circuit-before-getattr shape as RuleVersion (rule.py)
        # — required for the identical reason: ORM instrumentation sets
        # its own internal state marker via this same __setattr__ before
        # the instance has any queryable state at all.
        if name in _IMMUTABLE_AFTER_PUBLISH:
            current_status = getattr(self, "status", None)
            if current_status not in (None, RuleStatus.DRAFT):
                raise PolicyVersionImmutableError(
                    f"conflict_resolution_policy_version {getattr(self, 'id', '?')} is "
                    f"{current_status} and immutable — cannot set '{name}'"
                )
        super().__setattr__(name, value)

    @property
    def effective_period(self) -> EffectivePeriod:
        return EffectivePeriod(valid_from=self.valid_from, valid_to=self.valid_to)

    def _supersede(self, *, valid_to: date) -> None:
        object.__setattr__(self, "valid_to", valid_to)
        object.__setattr__(self, "status", RuleStatus.SUPERSEDED)


@dataclass(eq=False, kw_only=True)
class ConflictResolutionPolicy(AggregateRoot):
    code: str
    versions: list[ConflictResolutionPolicyVersion] = field(default_factory=list)

    def draft_new_version(
        self,
        *,
        precedence_list: tuple[RuleCategory, ...],
        valid_from: date,
        valid_to: date | None = None,
    ) -> ConflictResolutionPolicyVersion:
        next_version_no = max((v.version_no for v in self.versions), default=0) + 1
        version = ConflictResolutionPolicyVersion(
            id=uuid4(),
            policy_id=self.id,
            version_no=next_version_no,
            precedence_list=precedence_list,
            valid_from=valid_from,
            valid_to=valid_to,
            status=RuleStatus.DRAFT,
        )
        self.versions.append(version)
        return version

    def get_version(self, version_id: UUID) -> ConflictResolutionPolicyVersion:
        for version in self.versions:
            if version.id == version_id:
                return version
        raise KeyError(f"ConflictResolutionPolicy {self.id} has no version {version_id}")

    def publish_version(
        self, version_id: UUID, *, now: datetime
    ) -> ConflictResolutionPolicyVersion:
        """Same shape as `Rule.publish_version` (rule.py), minus scope
        partitioning: at most one OTHER published version can exist at
        all (no scope dimension to separate them), so any overlap that
        isn't "the one this publish cleanly supersedes" is a genuine
        conflict."""
        new_version = self.get_version(version_id)
        if new_version.status != RuleStatus.DRAFT:
            raise PolicyVersionImmutableError(
                f"conflict_resolution_policy_version {version_id} is already "
                f"{new_version.status}, cannot re-publish"
            )

        new_period = new_version.effective_period
        currently_active: ConflictResolutionPolicyVersion | None = None
        for other in self.versions:
            if other.id == new_version.id or other.status == RuleStatus.DRAFT:
                continue
            if other.effective_period.overlaps(new_period):
                if (
                    other.status == RuleStatus.PUBLISHED
                    and other.valid_from < new_version.valid_from
                ):
                    currently_active = other
                else:
                    raise PolicyVersionOverlapError(
                        f"conflict_resolution_policy_version {version_id} ({new_period}) "
                        f"overlaps existing {other.status} version {other.id} "
                        f"({other.effective_period})"
                    )

        if currently_active is not None:
            currently_active._supersede(valid_to=new_version.valid_from)

        object.__setattr__(new_version, "status", RuleStatus.PUBLISHED)

        self.raise_event(
            ConflictResolutionPolicyPublished(
                policy_id=self.id,
                policy_version_id=new_version.id,
                version_no=new_version.version_no,
            )
        )
        return new_version
