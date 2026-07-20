"""RE011 — unit tests for `evaluate_condition`."""

from __future__ import annotations

import pytest
from pydantic import TypeAdapter

from src.rule_engine.interpreter.tree_walker import evaluate_condition
from src.rule_engine.schemas.condition import ConditionNode

adapter: TypeAdapter[object] = TypeAdapter(ConditionNode)


@pytest.mark.parametrize(
    ("operator", "context_value", "compare_to", "expected"),
    [
        ("eq", "hazardous", "hazardous", True),
        ("eq", "hazardous", "normal", False),
        ("ne", "hazardous", "normal", True),
        ("gt", 10, 5, True),
        ("gte", 5, 5, True),
        ("lt", 3, 5, True),
        ("lte", 5, 5, True),
        ("in", 2, [1, 2, 3], True),
        ("not_in", 9, [1, 2, 3], True),
    ],
)
def test_leaf_comparisons(
    operator: str, context_value: object, compare_to: object, expected: bool
) -> None:
    node = adapter.validate_python(
        {"node_type": "leaf", "variable": "x", "operator": operator, "value": compare_to}
    )
    assert evaluate_condition(node, {"x": context_value}) is expected


def test_leaf_raises_on_missing_variable() -> None:
    node = adapter.validate_python(
        {"node_type": "leaf", "variable": "missing", "operator": "eq", "value": 1}
    )
    with pytest.raises(KeyError, match="missing"):
        evaluate_condition(node, {})


def test_composite_and_requires_all_true() -> None:
    node = adapter.validate_python(
        {
            "node_type": "composite",
            "logical_operator": "and",
            "conditions": [
                {"node_type": "leaf", "variable": "a", "operator": "gt", "value": 0},
                {"node_type": "leaf", "variable": "b", "operator": "gt", "value": 0},
            ],
        }
    )
    assert evaluate_condition(node, {"a": 1, "b": 1}) is True
    assert evaluate_condition(node, {"a": 1, "b": -1}) is False


def test_composite_or_requires_any_true() -> None:
    node = adapter.validate_python(
        {
            "node_type": "composite",
            "logical_operator": "or",
            "conditions": [
                {"node_type": "leaf", "variable": "a", "operator": "gt", "value": 0},
                {"node_type": "leaf", "variable": "b", "operator": "gt", "value": 0},
            ],
        }
    )
    assert evaluate_condition(node, {"a": -1, "b": 1}) is True
    assert evaluate_condition(node, {"a": -1, "b": -1}) is False


def test_composite_not_negates_single_subcondition() -> None:
    node = adapter.validate_python(
        {
            "node_type": "composite",
            "logical_operator": "not",
            "conditions": [{"node_type": "leaf", "variable": "a", "operator": "eq", "value": True}],
        }
    )
    assert evaluate_condition(node, {"a": True}) is False
    assert evaluate_condition(node, {"a": False}) is True


def test_deeply_nested_composite() -> None:
    """(a AND b) OR (NOT c) — mirrors ConflictResolutionPolicy-style
    multi-category conditions from Calculation_Engine_Algorithms Алгоритм Ж."""
    node = adapter.validate_python(
        {
            "node_type": "composite",
            "logical_operator": "or",
            "conditions": [
                {
                    "node_type": "composite",
                    "logical_operator": "and",
                    "conditions": [
                        {"node_type": "leaf", "variable": "a", "operator": "eq", "value": True},
                        {"node_type": "leaf", "variable": "b", "operator": "eq", "value": True},
                    ],
                },
                {
                    "node_type": "composite",
                    "logical_operator": "not",
                    "conditions": [
                        {"node_type": "leaf", "variable": "c", "operator": "eq", "value": True}
                    ],
                },
            ],
        }
    )
    assert evaluate_condition(node, {"a": True, "b": True, "c": True}) is True  # first branch
    assert evaluate_condition(node, {"a": False, "b": True, "c": False}) is True  # second branch
    assert evaluate_condition(node, {"a": False, "b": True, "c": True}) is False  # neither
