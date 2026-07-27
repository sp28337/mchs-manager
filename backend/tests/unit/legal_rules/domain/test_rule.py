"""LR003 — unit tests for the `Rule` aggregate: publish/supersede,
immutability, overlap rejection. Zero DB, zero HTTP — pure domain."""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

import pytest

from src.modules.legal_rules.domain.errors import (
    RuleVersionImmutableError,
    RuleVersionOverlapError,
)
from src.modules.legal_rules.domain.rule import Rule
from src.modules.legal_rules.domain.value_objects import LegalBasis, RuleCategory, RuleStatus, Scope

NOW = datetime.now(UTC)


def _make_rule() -> Rule:
    return Rule(
        id=uuid4(),
        code="NORM.WEEKLY.HAZARDOUS",
        category=RuleCategory.NORM_CALCULATION,
        display_name="test",
    )


def _legal_basis() -> LegalBasis:
    return LegalBasis(node_id=uuid4())


def test_draft_new_version_increments_version_no() -> None:
    rule = _make_rule()
    scope = Scope.from_dict({"category": "hazardous"})
    v1 = rule.draft_new_version(
        scope=scope, legal_basis=_legal_basis(), formula_definition={}, valid_from=date(2024, 1, 1)
    )
    v2 = rule.draft_new_version(
        scope=scope, legal_basis=_legal_basis(), formula_definition={}, valid_from=date(2024, 6, 1)
    )
    assert v1.version_no == 1
    assert v2.version_no == 2
    assert v1.status == RuleStatus.DRAFT


def test_publish_raises_rule_version_published_event() -> None:
    rule = _make_rule()
    v1 = rule.draft_new_version(
        scope=Scope.from_dict({"category": "hazardous"}),
        legal_basis=_legal_basis(),
        formula_definition={"weekly_norm_hours": 36},
        valid_from=date(2024, 1, 1),
    )
    published_by = uuid4()
    rule.publish_version(v1.id, published_by=published_by, now=NOW)

    events = rule.pull_pending_events()
    assert len(events) == 1
    assert events[0].rule_version_id == v1.id  # type: ignore[attr-defined]
    assert v1.status == RuleStatus.PUBLISHED
    assert v1.published_at == NOW
    assert v1.published_by == published_by


def test_publishing_supersedes_the_previously_active_version_of_same_scope() -> None:
    rule = _make_rule()
    scope = Scope.from_dict({"category": "hazardous"})
    v1 = rule.draft_new_version(
        scope=scope, legal_basis=_legal_basis(), formula_definition={}, valid_from=date(2024, 1, 1)
    )
    rule.publish_version(v1.id, published_by=uuid4(), now=NOW)

    v2 = rule.draft_new_version(
        scope=scope, legal_basis=_legal_basis(), formula_definition={}, valid_from=date(2024, 6, 1)
    )
    rule.publish_version(v2.id, published_by=uuid4(), now=NOW)

    assert v1.status == RuleStatus.SUPERSEDED
    assert v1.valid_to == date(2024, 6, 1)
    assert v2.status == RuleStatus.PUBLISHED


def test_different_scope_does_not_conflict_even_with_overlapping_period() -> None:
    rule = _make_rule()
    v1 = rule.draft_new_version(
        scope=Scope.from_dict({"category": "hazardous"}),
        legal_basis=_legal_basis(),
        formula_definition={},
        valid_from=date(2024, 1, 1),
    )
    v2 = rule.draft_new_version(
        scope=Scope.from_dict({"category": "normal"}),
        legal_basis=_legal_basis(),
        formula_definition={},
        valid_from=date(2024, 1, 1),
    )
    rule.publish_version(v1.id, published_by=uuid4(), now=NOW)
    rule.publish_version(v2.id, published_by=uuid4(), now=NOW)  # must not raise

    assert v1.status == RuleStatus.PUBLISHED
    assert v2.status == RuleStatus.PUBLISHED


def test_genuine_overlap_of_same_scope_is_rejected() -> None:
    """A version that does not cleanly supersede the active one (its
    valid_from is not after the active version's) is a real conflict."""
    rule = _make_rule()
    scope = Scope.from_dict({"category": "hazardous"})
    v1 = rule.draft_new_version(
        scope=scope, legal_basis=_legal_basis(), formula_definition={}, valid_from=date(2024, 1, 1)
    )
    rule.publish_version(v1.id, published_by=uuid4(), now=NOW)

    v2 = rule.draft_new_version(
        scope=scope, legal_basis=_legal_basis(), formula_definition={}, valid_from=date(2023, 6, 1)
    )
    with pytest.raises(RuleVersionOverlapError):
        rule.publish_version(v2.id, published_by=uuid4(), now=NOW)


def test_republishing_an_already_published_version_raises() -> None:
    rule = _make_rule()
    v1 = rule.draft_new_version(
        scope=Scope.from_dict({"category": "hazardous"}),
        legal_basis=_legal_basis(),
        formula_definition={},
        valid_from=date(2024, 1, 1),
    )
    rule.publish_version(v1.id, published_by=uuid4(), now=NOW)
    with pytest.raises(RuleVersionImmutableError):
        rule.publish_version(v1.id, published_by=uuid4(), now=NOW)


def test_published_version_content_fields_are_immutable() -> None:
    rule = _make_rule()
    v1 = rule.draft_new_version(
        scope=Scope.from_dict({"category": "hazardous"}),
        legal_basis=_legal_basis(),
        formula_definition={"weekly_norm_hours": 36},
        valid_from=date(2024, 1, 1),
    )
    rule.publish_version(v1.id, published_by=uuid4(), now=NOW)

    with pytest.raises(RuleVersionImmutableError):
        v1.formula_definition = {"weekly_norm_hours": 99}
    with pytest.raises(RuleVersionImmutableError):
        v1.scope = Scope.from_dict({"category": "normal"})
    with pytest.raises(RuleVersionImmutableError):
        v1.valid_from = date(2023, 1, 1)


def test_draft_version_content_fields_remain_mutable() -> None:
    """Only published/superseded is locked — a draft can still be edited
    freely before publication (Domain Model разд. 2.2 speaks only of
    "однажды опубликованная")."""
    rule = _make_rule()
    v1 = rule.draft_new_version(
        scope=Scope.from_dict({"category": "hazardous"}),
        legal_basis=_legal_basis(),
        formula_definition={"weekly_norm_hours": 36},
        valid_from=date(2024, 1, 1),
    )
    v1.formula_definition = {"weekly_norm_hours": 30}  # must not raise
    assert v1.formula_definition == {"weekly_norm_hours": 30}


def test_get_version_raises_key_error_for_unknown_id() -> None:
    rule = _make_rule()
    with pytest.raises(KeyError):
        rule.get_version(uuid4())
