"""`Position` aggregate — Domain_Model_DDD_Sluzhebnoe_Vremya_FPS.md разд. 3.

Штатная должность. Carries almost no behaviour, and that is the point:
its whole job is to supply two *classification* facts —
`category` and `default_regime_type` — that later become `scope`
dimensions of the `RuleVersion` applied to whoever holds the position
(Domain Model разд. 0: `Rule → Calculation → Employee`; the employee's
own attributes are what select the rule, and half of them come from the
post they occupy, not from the person).

`default_regime_type` is a *default*, not a fact about any individual:
an employee assigned to a post normally works its regime, but a specific
duty schedule (`Scheduling`) can put them on another one for a period.
This module never resolves that — it publishes the default and stops
there.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

from src.building_blocks.domain.aggregate_root import AggregateRoot
from src.modules.personnel.domain.value_objects import PositionCategory, RegimeType


@dataclass(eq=False, kw_only=True)
class Position(AggregateRoot):
    code: str
    title: str
    category: PositionCategory
    default_regime_type: RegimeType

    @classmethod
    def create(
        cls,
        *,
        code: str,
        title: str,
        category: PositionCategory,
        default_regime_type: RegimeType,
    ) -> Position:
        return cls(
            id=uuid4(),
            code=code,
            title=title,
            category=category,
            default_regime_type=default_regime_type,
        )
