"""RE004 — unit tests for the Formula discriminated union, including the
recursive nesting used by real formulas (Calculation_Engine_Algorithms_FPS.md,
Алгоритм Б шаг 7: норма периода)."""

from __future__ import annotations

import pytest
from pydantic import TypeAdapter, ValidationError

from src.rule_engine.schemas.formula import (
    ConditionalFormula,
    Formula,
    FunctionFormula,
    LiteralFormula,
    OperatorFormula,
    RuleReferenceFormula,
    VariableFormula,
)

adapter: TypeAdapter[object] = TypeAdapter(Formula)


def test_literal_and_variable_leaves() -> None:
    lit = adapter.validate_python({"node_type": "literal", "value": 36})
    var = adapter.validate_python({"node_type": "variable", "name": "weekly_norm_hours"})
    assert isinstance(lit, LiteralFormula)
    assert isinstance(var, VariableFormula)


def test_norm_hours_formula_nests_three_levels_deep() -> None:
    """norm_hours = (weekly_norm_hours / 5) * working_days - 1 * pre_holiday_days"""
    tree = {
        "node_type": "operator",
        "op": "-",
        "args": [
            {
                "node_type": "operator",
                "op": "*",
                "args": [
                    {
                        "node_type": "operator",
                        "op": "/",
                        "args": [
                            {"node_type": "variable", "name": "weekly_norm_hours"},
                            {"node_type": "literal", "value": 5},
                        ],
                    },
                    {"node_type": "variable", "name": "working_days_count"},
                ],
            },
            {
                "node_type": "operator",
                "op": "*",
                "args": [
                    {"node_type": "literal", "value": 1},
                    {"node_type": "variable", "name": "pre_holiday_days_count"},
                ],
            },
        ],
    }
    result = adapter.validate_python(tree)
    assert isinstance(result, OperatorFormula)
    assert result.op == "-"
    assert isinstance(result.args[0], OperatorFormula)
    assert isinstance(result.args[0].args[0], OperatorFormula)
    assert result.args[0].args[0].args[0] == VariableFormula(name="weekly_norm_hours")


def test_operator_requires_at_least_two_args() -> None:
    with pytest.raises(ValidationError):
        adapter.validate_python(
            {"node_type": "operator", "op": "+", "args": [{"node_type": "literal", "value": 1}]}
        )


def test_function_allows_zero_args() -> None:
    result = adapter.validate_python(
        {"node_type": "function", "function_name": "today", "args": []}
    )
    assert isinstance(result, FunctionFormula)
    assert result.args == []


def test_conditional_with_rule_reference_branch() -> None:
    tree = {
        "node_type": "conditional",
        "condition": {
            "node_type": "leaf",
            "variable": "election_allowed",
            "operator": "eq",
            "value": True,
        },
        "then_branch": {
            "node_type": "rule_reference",
            "rule_code": "COMP.COEF.OVERTIME",
            "scope": {"legal_base": "fps_service"},
        },
        "else_branch": {"node_type": "literal", "value": 0},
    }
    result = adapter.validate_python(tree)
    assert isinstance(result, ConditionalFormula)
    assert isinstance(result.then_branch, RuleReferenceFormula)
    assert result.then_branch.as_of is None


def test_rule_reference_scope_must_be_scalar_strings() -> None:
    with pytest.raises(ValidationError):
        adapter.validate_python(
            {"node_type": "rule_reference", "rule_code": "X", "scope": {"nested": {"a": 1}}}
        )


def test_unknown_operator_symbol_rejected() -> None:
    with pytest.raises(ValidationError):
        adapter.validate_python(
            {
                "node_type": "operator",
                "op": "%",  # not in ArithmeticOperator
                "args": [
                    {"node_type": "literal", "value": 1},
                    {"node_type": "literal", "value": 2},
                ],
            }
        )


def test_formula_nodes_are_frozen() -> None:
    lit = adapter.validate_python({"node_type": "literal", "value": 1})
    with pytest.raises(ValidationError):
        lit.value = 2  # type: ignore[union-attr]
