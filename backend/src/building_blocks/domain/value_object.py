"""Base marker for Value Objects: frozen dataclasses compared by value.

Concrete VOs (TimeInterval, HoursBreakdown, Scope, ...) subclass this
directly with `@dataclass(frozen=True, kw_only=True)` — this base carries
no fields, it exists only so domain code can type-check `isinstance(x, ValueObject)`
and so the intent (value equality, immutability) is explicit at the
declaration site of every module's `domain/value_objects.py`.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, kw_only=True)
class ValueObject:
    """Marker base class. Equality/hash come for free from `frozen=True`
    dataclasses as long as every field is itself hashable/comparable by
    value — remember to keep VOs free of mutable fields (lists, dicts)."""
