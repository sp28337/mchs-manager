"""Arithmetic function registry (Backend_Architecture_FastAPI_Stack_FPS.md,
разд. 1: "+ - * / min max round ceil floor abs" — "реестр: имя функции →
callable, ФИКСИРОВАН").

These are the callables looked up by `FunctionFormula.function_name` in the
tree walker (interpreter/tree_walker.py, RE012). Kept separate from the
Formula schema itself: the schema only validates *shape* (a string name +
args), resolving what the name actually does is the walker's job, and the
walker looks the name up here — one indirection, so adding a function
later (e.g. calendar_functions.py, RE008) never touches the schema.

Every registered function is variadic-over-floats -> float, matching how
`OperatorFormula`/`FunctionFormula.args` are evaluated (each arg is itself
evaluated to a float by the walker before being passed here).
"""

from __future__ import annotations

import math
from collections.abc import Callable

ArithmeticFunction = Callable[..., float]


def _min(*args: float) -> float:
    if not args:
        raise ValueError("min() requires at least one argument")
    return min(args)


def _max(*args: float) -> float:
    if not args:
        raise ValueError("max() requires at least one argument")
    return max(args)


def _round(value: float, ndigits: float = 0) -> float:
    return float(round(value, int(ndigits)))


def _ceil(value: float) -> float:
    return float(math.ceil(value))


def _floor(value: float) -> float:
    return float(math.floor(value))


def _abs(value: float) -> float:
    return abs(value)


ARITHMETIC_FUNCTIONS: dict[str, ArithmeticFunction] = {
    "min": _min,
    "max": _max,
    "round": _round,
    "ceil": _ceil,
    "floor": _floor,
    "abs": _abs,
}
