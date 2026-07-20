"""The fixed function-name -> callable registry (Backend_Architecture_FastAPI_Stack_FPS.md,
разд. 1: "ФИКСИРОВАН" — deliberately not extensible at runtime; adding a
function is a code change + review, not configuration, because a formula's
determinism guarantee (Calculation_Engine_Algorithms Принцип 0.1) depends
on the registry never silently changing behaviour under an already-stored
`formula_definition`).

`calendar_functions` (RE008: `working_days_count`, `pre_holiday_days_count`)
is intentionally NOT wired in here yet — it depends on `service_calendar`
schema/data (DB012, DB020) which hasn't been built. Merging it in is a
one-line addition to `FUNCTION_REGISTRY` once that lands; nothing else in
the tree walker needs to change (`interpreter/tree_walker.py` already
looks functions up by name through this module).
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
