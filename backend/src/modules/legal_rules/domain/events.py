"""Domain events for LegalRulesAndCalculation (Domain_Model_DDD разд. 11)."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from src.building_blocks.domain.domain_event import DomainEvent


@dataclass(frozen=True, kw_only=True)
class RuleVersionPublished(DomainEvent):
    """New version of a rule has come into effect. Consumers (e.g. cache
    invalidation for `GetEffectiveRuleVersion`, Backend_Architecture разд.
    4) subscribe to this to evict any cached lookup for this rule/scope."""

    rule_id: UUID
    rule_version_id: UUID
    version_no: int


@dataclass(frozen=True, kw_only=True)
class ConflictResolutionPolicyPublished(DomainEvent):
    policy_id: UUID
    policy_version_id: UUID
    version_no: int
