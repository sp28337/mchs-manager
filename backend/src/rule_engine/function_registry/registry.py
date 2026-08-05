"""The fixed function-name -> callable registry (Backend_Architecture_FastAPI_Stack_FPS.md,
разд. 1: "ФИКСИРОВАН" — deliberately not extensible at runtime; adding a
function is a code change + review, not configuration, because a formula's
determinism guarantee (Calculation_Engine_Algorithms Принцип 0.1) depends
on the registry never silently changing behaviour under an already-stored
`formula_definition`).

CORRECTION (RE008 now exists). An earlier version of this docstring said
that `calendar_functions` would be "a one-line addition to
`FUNCTION_REGISTRY`" once `service_calendar` landed. That was wrong, and
the mistake is worth recording rather than quietly deleting: a registry
entry is `Callable[..., float]`, synchronous and pure, and the walker
evaluates every `FunctionFormula` argument down to a `float` BEFORE
calling it. A calendar counter takes a calendar, not numbers, and the
calendar comes from the database — so registering it would have required
either I/O inside the registry or passing the evaluation context to
registry functions, and both break the purity that Принцип 0.1's
determinism guarantee rests on.

`calendar_functions.py` therefore holds PURE counters over an
already-loaded calendar, and their results enter the walker as
`EvaluationContext` VARIABLES (`working_days_count`,
`pre_holiday_days_count`) rather than as function calls — which is also
how Calculation_Engine_Algorithms itself names them. See that module's
docstring for the full reasoning.

`FUNCTION_REGISTRY` below therefore stays arithmetic-only.
"""

from __future__ import annotations

from src.rule_engine.function_registry.arithmetic import ARITHMETIC_FUNCTIONS, ArithmeticFunction

FUNCTION_REGISTRY: dict[str, ArithmeticFunction] = {
    **ARITHMETIC_FUNCTIONS,
}


class UnknownFunctionError(KeyError):
    """Raised when a Formula's `function_name` has no registered callable —
    a formula referencing an unknown function is a data-integrity problem,
    not a normal KeyError, so it gets its own type for callers to catch
    specifically."""


def resolve(function_name: str) -> ArithmeticFunction:
    try:
        return FUNCTION_REGISTRY[function_name]
    except KeyError:
        raise UnknownFunctionError(function_name) from None
