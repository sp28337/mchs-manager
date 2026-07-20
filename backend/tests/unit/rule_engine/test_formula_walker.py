"""RE013 — unit tests for `evaluate_formula`."""

from __future__ import annotations

import pytest
from pydantic import TypeAdapter

from src.rule_engine.function_registry.registry import UnknownFunctionError
from src.rule_engine.interpreter.tree_walker import evaluate_formula
from src.rule_engine.schemas.formula import Formula, RuleReferenceFormula

adapter: TypeAdapter[object] = TypeAdapter(Formula)


async def test_literal_evaluates_to_itself() -> None:
    node = adapter.validate_python({"node_type": "literal", "value": 42})
    assert await evaluate_formula(node, {}) == 42


async def test_variable_reads_from_context() -> None:
    node = adapter.validate_python({"node_type": "variable", "name": "hours"})
    assert await evaluate_formula(node, {"hours": 8}) == 8.0


async def test_variable_raises_on_missing_context_key() -> None:
    node = adapter.validate_python({"node_type": "variable", "name": "missing"})
    with pytest.raises(KeyError, match="missing"):
        await evaluate_formula(node, {})


@pytest.mark.parametrize(
    ("op", "args", "expected"),
    [
        ("+", [1, 2, 3], 6),
        ("-", [10, 3, 2], 5),  # left-to-right: (10-3)-2
        ("*", [2, 3, 4], 24),
        ("/", [100, 10, 2], 5),  # left-to-right: (100/10)/2
    ],
)
async def test_operator_left_to_right(op: str, args: list[float], expected: float) -> None:
    node = adapter.validate_python(
        {
            "node_type": "operator",
            "op": op,
            "args": [{"node_type": "literal", "value": v} for v in args],
        }
    )
    assert await evaluate_formula(node, {}) == expected


async def test_norm_hours_formula_from_calculation_engine_algorithm_b() -> None:
    """norm_hours = (weekly_norm_hours / 5) * working_days_count - 1 * pre_holiday_days_count
    (Calculation_Engine_Algorithms_FPS.md, Алгоритм Б, шаг 7)."""
    tree = adapter.validate_python(
        {
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
    )
    context = {"weekly_norm_hours": 40, "working_days_count": 21, "pre_holiday_days_count": 1}
    assert await evaluate_formula(tree, context) == 167.0  # (40/5)*21 - 1*1


async def test_function_node_resolves_through_registry() -> None:
    node = adapter.validate_python(
        {
            "node_type": "function",
            "function_name": "round",
            "args": [
                {"node_type": "literal", "value": 2.567},
                {"node_type": "literal", "value": 1},
            ],
        }
    )
    assert await evaluate_formula(node, {}) == pytest.approx(2.6)


async def test_function_node_unknown_name_raises() -> None:
    node = adapter.validate_python(
        {"node_type": "function", "function_name": "not_a_real_function", "args": []}
    )
    with pytest.raises(UnknownFunctionError):
        await evaluate_formula(node, {})


async def test_conditional_picks_then_branch() -> None:
    node = adapter.validate_python(
        {
            "node_type": "conditional",
            "condition": {
                "node_type": "leaf",
                "variable": "overtime_hours",
                "operator": "gt",
                "value": 0,
            },
            "then_branch": {"node_type": "literal", "value": 1.5},
            "else_branch": {"node_type": "literal", "value": 1.0},
        }
    )
    assert await evaluate_formula(node, {"overtime_hours": 5}) == 1.5


async def test_conditional_picks_else_branch() -> None:
    node = adapter.validate_python(
        {
            "node_type": "conditional",
            "condition": {
                "node_type": "leaf",
                "variable": "overtime_hours",
                "operator": "gt",
                "value": 0,
            },
            "then_branch": {"node_type": "literal", "value": 1.5},
            "else_branch": {"node_type": "literal", "value": 1.0},
        }
    )
    assert await evaluate_formula(node, {"overtime_hours": 0}) == 1.0


async def test_rule_reference_without_resolver_raises() -> None:
    node = adapter.validate_python(
        {"node_type": "rule_reference", "rule_code": "COMP.COEF.OVERTIME"}
    )
    with pytest.raises(RuntimeError, match="COMP.COEF.OVERTIME"):
        await evaluate_formula(node, {})


async def test_rule_reference_resolved_via_injected_callback() -> None:
    """The walker has zero I/O of its own — a fake in-memory resolver is
    enough to prove the wiring, without touching a real DB (that's RE015,
    against version_resolver.py + a real Postgres)."""
    node = adapter.validate_python(
        {
            "node_type": "rule_reference",
            "rule_code": "COMP.COEF.OVERTIME",
            "scope": {"legal_base": "fps_service"},
        }
    )

    async def fake_resolver(ref: RuleReferenceFormula, context: dict[str, object]) -> Formula:
        assert ref.rule_code == "COMP.COEF.OVERTIME"
        return adapter.validate_python({"node_type": "literal", "value": 1.5})

    result = await evaluate_formula(node, {}, resolve_rule_reference=fake_resolver)
    assert result == 1.5


async def test_conditional_with_rule_reference_then_branch() -> None:
    """Recursion must thread the resolver through every branch, not just
    the top-level call — regression guard for a forgot-to-pass-through bug."""
    node = adapter.validate_python(
        {
            "node_type": "conditional",
            "condition": {
                "node_type": "leaf",
                "variable": "election_allowed",
                "operator": "eq",
                "value": True,
            },
            "then_branch": {"node_type": "rule_reference", "rule_code": "X"},
            "else_branch": {"node_type": "literal", "value": 0},
        }
    )

    async def fake_resolver(ref: RuleReferenceFormula, context: dict[str, object]) -> Formula:
        return adapter.validate_python({"node_type": "literal", "value": 99})

    result = await evaluate_formula(
        node, {"election_allowed": True}, resolve_rule_reference=fake_resolver
    )
    assert result == 99
