"""RE002 — unit tests for the Condition discriminated union.

Structural/form validation only (API_Conventions разд. 4) — the walker's
semantic evaluation is tested separately in test_tree_walker.py (RE011).
"""

from __future__ import annotations

import pytest
from pydantic import TypeAdapter, ValidationError

from src.rule_engine.schemas.condition import CompositeCondition, ConditionNode, LeafCondition

adapter: TypeAdapter[object] = TypeAdapter(ConditionNode)


def test_leaf_condition_valid() -> None:
    node = adapter.validate_python(
        {
            "node_type": "leaf",
            "variable": "service_condition_category",
            "operator": "eq",
            "value": "hazardous",
        }
    )
    assert isinstance(node, LeafCondition)
    assert node.operator == "eq"


def test_composite_condition_nests_leaves() -> None:
    node = adapter.validate_python(
        {
            "node_type": "composite",
            "logical_operator": "and",
            "conditions": [
                {"node_type": "leaf", "variable": "x", "operator": "gt", "value": 10},
                {"node_type": "leaf", "variable": "y", "operator": "lt", "value": 5},
            ],
        }
    )
    assert isinstance(node, CompositeCondition)
    assert len(node.conditions) == 2
    assert all(isinstance(c, LeafCondition) for c in node.conditions)


def test_composite_can_nest_composite() -> None:
    node = adapter.validate_python(
        {
            "node_type": "composite",
            "logical_operator": "or",
            "conditions": [
                {
                    "node_type": "composite",
                    "logical_operator": "and",
                    "conditions": [
                        {"node_type": "leaf", "variable": "a", "operator": "eq", "value": 1},
                        {"node_type": "leaf", "variable": "b", "operator": "eq", "value": 2},
                    ],
                },
                {"node_type": "leaf", "variable": "c", "operator": "in", "value": [1, 2, 3]},
            ],
        }
    )
    assert isinstance(node, CompositeCondition)
    assert isinstance(node.conditions[0], CompositeCondition)


def test_not_requires_exactly_one_subcondition() -> None:
    with pytest.raises(ValidationError, match="'not' requires exactly one sub-condition"):
        adapter.validate_python(
            {
                "node_type": "composite",
                "logical_operator": "not",
                "conditions": [
                    {"node_type": "leaf", "variable": "x", "operator": "gt", "value": 1},
                    {"node_type": "leaf", "variable": "y", "operator": "lt", "value": 2},
                ],
            }
        )


def test_not_with_single_subcondition_is_valid() -> None:
    node = adapter.validate_python(
        {
            "node_type": "composite",
            "logical_operator": "not",
            "conditions": [{"node_type": "leaf", "variable": "x", "operator": "eq", "value": 1}],
        }
    )
    assert isinstance(node, CompositeCondition)


def test_unknown_discriminator_rejected() -> None:
    with pytest.raises(ValidationError):
        adapter.validate_python({"node_type": "bogus"})


def test_leaf_condition_is_frozen() -> None:
    node = LeafCondition(variable="x", operator="eq", value=1)
    with pytest.raises(ValidationError):
        node.variable = "y"  # type: ignore[misc]


def test_composite_rejects_unknown_field() -> None:
    with pytest.raises(ValidationError):
        adapter.validate_python(
            {
                "node_type": "composite",
                "logical_operator": "and",
                "conditions": [
                    {"node_type": "leaf", "variable": "x", "operator": "eq", "value": 1}
                ],
                "unexpected_field": 1,
            }
        )


def test_composite_requires_at_least_one_condition() -> None:
    with pytest.raises(ValidationError):
        adapter.validate_python(
            {"node_type": "composite", "logical_operator": "and", "conditions": []}
        )
