"""Action — what a RuleVersion *produces* once its Formula(s) evaluate
(openapi.yaml `CreateRuleVersionRequest.actions`, `minItems: 1`; referenced
but not itself specified by Backend_Architecture — this is the first
concrete design of its shape, so the assumption is spelled out here rather
than left implicit).

Design: exactly one variant, `set_result` — assigns the value produced by
evaluating a `Formula` to a named output field of the calculation result
(e.g. `norm_hours`, `coefficient`, `election_allowed`). A RuleVersion can
carry several actions (e.g. a `compensation_coefficient` version that sets
both `coefficient` and `election_allowed`) — hence `actions: list[Action]`,
`min_length=1`, matching the openapi contract.

Kept a discriminated union of one variant (`node_type`, mirroring
Condition/Formula) rather than a bare object, so a second Action kind can
be added later (e.g. `raise_flag` for review-required cases, SRS раздел
8 п.11) without breaking the `node_type` dispatch already in place.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from src.rule_engine.schemas.formula import Formula


class SetResultAction(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    node_type: Literal["set_result"] = "set_result"
    field: str = Field(min_length=1)
    formula: Formula


Action = Annotated[SetResultAction, Field(discriminator="node_type")]
