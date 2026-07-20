"""Recursive evaluators for Condition and Formula trees (RE010, RE012).

Both walkers take an `EvaluationContext` (a flat dict of scope facts —
Calculation_Engine_Algorithms_FPS.md refers to these as e.g.
`working_days_count`, `weekly_norm_hours`) and, for Formula, an injected
way to resolve `rule_reference` nodes — the walker itself must not know
*how* versions are looked up (that is `version_resolver.py`, RE014); it
only knows how to fold a tree into a value given a resolver callback.

Determinism (Calculation_Engine_Algorithms Принцип 0.1): each walker is a
pure function of (tree, context, resolver) — no hidden state, no I/O of
its own beyond calling the injected resolver.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from src.rule_engine.function_registry.registry import resolve as resolve_function
from src.rule_engine.schemas.condition import CompositeCondition, ConditionNode, LeafCondition
from src.rule_engine.schemas.formula import (
    ConditionalFormula,
    Formula,
    FunctionFormula,
    LiteralFormula,
    OperatorFormula,
    RuleReferenceFormula,
    VariableFormula,
)

EvaluationContext = dict[str, Any]

# Resolves a rule_reference node to the Formula it should be evaluated
# against (typically: look up the referenced RuleVersion via
# version_resolver.resolve_effective_version and return its Formula).
# Injected so the walker has zero I/O of its own and stays testable with a
# plain dict-backed fake instead of a real DB connection.
RuleReferenceResolver = Callable[[RuleReferenceFormula, EvaluationContext], Awaitable[Formula]]


_COMPARISONS: dict[str, Callable[[Any, Any], bool]] = {
    "eq": lambda a, b: a == b,
    "ne": lambda a, b: a != b,
    "gt": lambda a, b: a > b,
    "gte": lambda a, b: a >= b,
    "lt": lambda a, b: a < b,
    "lte": lambda a, b: a <= b,
    "in": lambda a, b: a in b,
    "not_in": lambda a, b: a not in b,
}


def evaluate_condition(node: ConditionNode, context: EvaluationContext) -> bool:
    """Synchronous — Condition never contains a `rule_reference` (that is a
    Formula-only node type per Backend_Architecture разд. 6.2), so no I/O
    is ever needed here."""
    if isinstance(node, LeafCondition):
        if node.variable not in context:
            raise KeyError(f"Condition references unknown variable '{node.variable}'")
        return _COMPARISONS[node.operator](context[node.variable], node.value)
    if isinstance(node, CompositeCondition):
        if node.logical_operator == "not":
            return not evaluate_condition(node.conditions[0], context)
        results = [evaluate_condition(c, context) for c in node.conditions]
        return all(results) if node.logical_operator == "and" else any(results)
    raise TypeError(f"Unhandled ConditionNode variant: {type(node).__name__}")  # pragma: no cover


async def evaluate_formula(
    node: Formula,
    context: EvaluationContext,
    *,
    resolve_rule_reference: RuleReferenceResolver | None = None,
) -> float:
    """Async because `rule_reference` may need a DB round-trip via the
    injected resolver — every other node type is pure computation, but the
    walker as a whole must be async so `rule_reference` can appear
    anywhere in the tree (Calculation_Engine_Algorithms, Алгоритм К шаг 3-4:
    a compensation-coefficient formula referencing the norm_calculation
    rule's own result)."""
    if isinstance(node, LiteralFormula):
        return node.value
    if isinstance(node, VariableFormula):
        if node.name not in context:
            raise KeyError(f"Formula references unknown variable '{node.name}'")
        return float(context[node.name])
    if isinstance(node, OperatorFormula):
        values = [
            await evaluate_formula(arg, context, resolve_rule_reference=resolve_rule_reference)
            for arg in node.args
        ]
        return _apply_operator(node.op, values)
    if isinstance(node, FunctionFormula):
        fn = resolve_function(node.function_name)
        values = [
            await evaluate_formula(arg, context, resolve_rule_reference=resolve_rule_reference)
            for arg in node.args
        ]
        return fn(*values)
    if isinstance(node, ConditionalFormula):
        branch = (
            node.then_branch if evaluate_condition(node.condition, context) else node.else_branch
        )
        return await evaluate_formula(
            branch, context, resolve_rule_reference=resolve_rule_reference
        )
    if isinstance(node, RuleReferenceFormula):
        if resolve_rule_reference is None:
            raise RuntimeError(
                f"Formula contains rule_reference to '{node.rule_code}' but no "
                "resolve_rule_reference callback was supplied"
            )
        referenced_formula = await resolve_rule_reference(node, context)
        return await evaluate_formula(
            referenced_formula, context, resolve_rule_reference=resolve_rule_reference
        )
    raise TypeError(f"Unhandled Formula variant: {type(node).__name__}")  # pragma: no cover


def _apply_operator(op: str, values: list[float]) -> float:
    result = values[0]
    for value in values[1:]:
        if op == "+":
            result += value
        elif op == "-":
            result -= value
        elif op == "*":
            result *= value
        elif op == "/":
            result /= value
        else:  # pragma: no cover — unreachable, ArithmeticOperator is a closed Literal
            raise TypeError(f"Unhandled operator: {op}")
    return result
