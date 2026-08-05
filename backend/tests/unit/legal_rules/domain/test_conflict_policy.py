"""Unit tests for the `ConflictResolutionPolicy` aggregate: duplicate
category rejection, publish/supersede, overlap rejection — same shape as
`Rule` (test_rule.py) minus the scope dimension. Zero DB, zero HTTP."""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

import pytest

from src.modules.legal_rules.domain.conflict_policy import ConflictResolutionPolicy
from src.modules.legal_rules.domain.errors import (
    ConflictPolicyDuplicateCategoryError,
    PolicyVersionImmutableError,
    PolicyVersionOverlapError,
)
from src.modules.legal_rules.domain.value_objects import HourCategory, RuleStatus

NOW = datetime.now(UTC)


def _make_policy() -> ConflictResolutionPolicy:
    return ConflictResolutionPolicy(id=uuid4(), code="DEFAULT")


def test_duplicate_category_in_precedence_list_is_rejected_at_construction() -> None:
    policy = _make_policy()
    with pytest.raises(ConflictPolicyDuplicateCategoryError):
        policy.draft_new_version(
            precedence_list=(
                HourCategory.HOLIDAY,
                HourCategory.HOLIDAY,
            ),
            valid_from=date(2024, 1, 1),
        )


def test_publish_raises_event_and_sets_published_status() -> None:
    policy = _make_policy()
    v1 = policy.draft_new_version(
        precedence_list=(
            HourCategory.HOLIDAY,
            HourCategory.NIGHT,
        ),
        valid_from=date(2024, 1, 1),
    )
    policy.publish_version(v1.id, now=NOW)

    events = policy.pull_pending_events()
    assert len(events) == 1
    assert events[0].policy_version_id == v1.id  # type: ignore[attr-defined]
    assert v1.status == RuleStatus.PUBLISHED


def test_publishing_supersedes_the_previously_active_version() -> None:
    policy = _make_policy()
    v1 = policy.draft_new_version(
        precedence_list=(
            HourCategory.HOLIDAY,
            HourCategory.NIGHT,
        ),
        valid_from=date(2024, 1, 1),
    )
    policy.publish_version(v1.id, now=NOW)

    v2 = policy.draft_new_version(
        precedence_list=(
            HourCategory.NIGHT,
            HourCategory.HOLIDAY,
        ),
        valid_from=date(2024, 6, 1),
    )
    policy.publish_version(v2.id, now=NOW)

    assert v1.status == RuleStatus.SUPERSEDED
    assert v1.valid_to == date(2024, 6, 1)
    assert v2.status == RuleStatus.PUBLISHED


def test_genuine_overlap_is_rejected() -> None:
    policy = _make_policy()
    v1 = policy.draft_new_version(
        precedence_list=(HourCategory.OVERTIME,), valid_from=date(2024, 1, 1)
    )
    policy.publish_version(v1.id, now=NOW)

    v2 = policy.draft_new_version(
        precedence_list=(HourCategory.NIGHT,), valid_from=date(2023, 6, 1)
    )
    with pytest.raises(PolicyVersionOverlapError):
        policy.publish_version(v2.id, now=NOW)


def test_republishing_raises() -> None:
    policy = _make_policy()
    v1 = policy.draft_new_version(
        precedence_list=(HourCategory.OVERTIME,), valid_from=date(2024, 1, 1)
    )
    policy.publish_version(v1.id, now=NOW)
    with pytest.raises(PolicyVersionImmutableError):
        policy.publish_version(v1.id, now=NOW)


def test_published_version_precedence_list_is_immutable() -> None:
    policy = _make_policy()
    v1 = policy.draft_new_version(
        precedence_list=(HourCategory.OVERTIME,), valid_from=date(2024, 1, 1)
    )
    policy.publish_version(v1.id, now=NOW)

    with pytest.raises(PolicyVersionImmutableError):
        v1.precedence_list = (HourCategory.NIGHT,)


def test_draft_version_remains_mutable() -> None:
    policy = _make_policy()
    v1 = policy.draft_new_version(
        precedence_list=(HourCategory.OVERTIME,), valid_from=date(2024, 1, 1)
    )
    v1.precedence_list = (HourCategory.NIGHT,)  # must not raise
    assert v1.precedence_list == (HourCategory.NIGHT,)
