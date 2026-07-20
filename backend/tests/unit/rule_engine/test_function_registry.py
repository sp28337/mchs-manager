"""RE007 — unit tests for the arithmetic function registry."""

from __future__ import annotations

import pytest

from src.rule_engine.function_registry.arithmetic import ARITHMETIC_FUNCTIONS
from src.rule_engine.function_registry.registry import (
    FUNCTION_REGISTRY,
    UnknownFunctionError,
    resolve,
)


def test_registry_contains_all_arithmetic_functions() -> None:
    for name in ("min", "max", "round", "ceil", "floor", "abs"):
        assert name in FUNCTION_REGISTRY
        assert FUNCTION_REGISTRY[name] is ARITHMETIC_FUNCTIONS[name]


@pytest.mark.parametrize(
    ("name", "args", "expected"),
    [
        ("min", (3.0, 1.0, 2.0), 1.0),
        ("max", (3.0, 1.0, 2.0), 3.0),
        ("round", (2.567, 2), 2.57),
        ("ceil", (2.1,), 3.0),
        ("floor", (2.9,), 2.0),
        ("abs", (-5.0,), 5.0),
    ],
)
def test_each_function_computes_correctly(
    name: str, args: tuple[float, ...], expected: float
) -> None:
    assert resolve(name)(*args) == pytest.approx(expected)


def test_round_defaults_to_zero_digits() -> None:
    assert resolve("round")(2.6) == 3.0


def test_min_and_max_require_at_least_one_arg() -> None:
    with pytest.raises(ValueError):
        resolve("min")()
    with pytest.raises(ValueError):
        resolve("max")()


def test_unknown_function_name_raises_specific_error() -> None:
    with pytest.raises(UnknownFunctionError):
        resolve("working_days_count")  # RE008 — not wired in yet, see registry.py docstring


def test_registry_is_a_plain_dict_not_dynamically_mutated_by_resolve() -> None:
    before = dict(FUNCTION_REGISTRY)
    with pytest.raises(UnknownFunctionError):
        resolve("nonexistent")
    assert FUNCTION_REGISTRY == before
