"""Condition — the boolean-predicate half of the Rule Engine's declarative
tree language (Backend_Architecture_FastAPI_Stack_FPS.md, разд. 6.2:
"leaf, composite для Condition" — discriminated on `node_type`).

Discriminated-union syntax verified against Context7 (/pydantic/pydantic,
docs/concepts/unions.md): `Field(discriminator=...)` on the Literal field
shared by every variant; recursive self-reference (`composite.conditions:
list[ConditionNode]`) uses a string forward reference resolved via
`model_rebuild()` after the union alias is assigned (docs/concepts/models.md,
"class-not-fully-defined").

A Condition tree, once evaluated (see interpreter/tree_walker.py), yields a
plain bool — used e.g. to gate `election_allowed` or to select a branch in a
Formula `conditional` node (Calculation_Engine_Algorithms_FPS.md, Алгоритм К
шаг 5).
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

ComparisonOperator = Literal["eq", "ne", "gt", "gte", "lt", "lte", "in", "not_in"]
LogicalOperator = Literal["and", "or", "not"]


class LeafCondition(BaseModel):
    """A single comparison: `variable <op> value`.

    `variable` is resolved against the evaluation context passed to the
    tree walker (facts/scope of the calculation in progress, e.g.
    `service_condition_category`) — the Condition schema itself does not
    know where the value comes from, only how to compare it.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    node_type: Literal["leaf"] = "leaf"
    variable: str = Field(min_length=1)
    operator: ComparisonOperator
    value: Any


class CompositeCondition(BaseModel):
    """Combines two or more sub-conditions with a logical operator.

    `not` is modeled as unary: exactly one element in `conditions`. This is
    enforced here (400-level, structural) rather than left to the walker,
    per API_Conventions разд. 4: form validation belongs at the schema.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    node_type: Literal["composite"] = "composite"
    logical_operator: LogicalOperator
    conditions: list[ConditionNode] = Field(min_length=1)

    @model_validator(mode="after")
    def _check_not_is_unary(self) -> Self:
        if self.logical_operator == "not" and len(self.conditions) != 1:
            raise ValueError("'not' requires exactly one sub-condition")
        return self


ConditionNode = Annotated[LeafCondition | CompositeCondition, Field(discriminator="node_type")]

CompositeCondition.model_rebuild()
