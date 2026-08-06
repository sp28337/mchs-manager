"""Formula — the value-computing half of the Rule Engine's declarative tree
language (Backend_Architecture_FastAPI_Stack_FPS.md, разд. 6.2): "literal,
variable, operator, function, conditional, rule_reference для Formula" —
discriminated on `node_type`, recursion expressed as `args: list[Formula]`.

This is what `legal_rules.rule_version.formula_definition` (jsonb) holds
once parsed — e.g. `norm_hours = (weekly_norm_hours / 5) * working_days -
1 * pre_holiday_days` (Calculation_Engine_Algorithms_FPS.md, Алгоритм Б
шаг 7) is an `operator` tree of nested `operator`/`variable`/`literal`
nodes.

Discriminated-union + recursive-self-reference syntax verified against
Context7 (/pydantic/pydantic, docs/concepts/unions.md and
docs/concepts/models.md "class-not-fully-defined" — same pattern as
condition.py, `model_rebuild()` after the union alias is assigned).
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from src.rule_engine.schemas.condition import ConditionNode

ArithmeticOperator = Literal["+", "-", "*", "/"]


class LiteralFormula(BaseModel):
    """A constant value — the base case of the recursion.

    --- Почему значение не только число --------------------------------

    Изначально здесь стоял `value: float`, и для Алгоритмов Б-З этого
    хватало: все они вычисляют часы. Алгоритм К шаг 4, однако, предписывает
    извлечь из `formula_definition` две принципиально нечисловые величины:

    * `default_compensation_form` — форму компенсации («как правило —
      денежная», шаг 5), то есть перечисление;
    * `election_allowed` — «допускает ли эта категория выбор формы
      компенсации сотрудником», то есть булев признак.

    Оба — данные нормативного акта, а не константы кода: ТК РФ ст. 152/153
    даёт работнику выбор, но какие категории им охвачены, определяет
    ведомственный порядок (Domain Model инвариант 7.1.3). Пока литерал
    умел быть только числом, записать их было нечем, и пришлось бы либо
    кодировать форму цифрой (0 — деньги, 1 — отгул), либо завести для них
    отдельную колонку мимо версионирования. Первое нечитаемо и неизбежно
    разъедется со смыслом, второе выводит существенную часть акта из-под
    механизма версий, ради которого весь модуль и существует.

    Порядок членов union'а важен: `bool` перед `float`, иначе Pydantic
    приведёт `true` к `1.0`, а `str` последним — иначе число, записанное
    строкой, осталось бы строкой.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    node_type: Literal["literal"] = "literal"
    value: bool | float | str


class VariableFormula(BaseModel):
    """A named input resolved from the evaluation context (scope facts,
    e.g. `working_days_count`, `weekly_norm_hours`) — the Formula schema
    does not know how the variable is produced, only its name."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    node_type: Literal["variable"] = "variable"
    name: str = Field(min_length=1)


class OperatorFormula(BaseModel):
    """A binary/n-ary infix arithmetic operator applied left-to-right over
    `args`. Only the four infix operators live here — `min`, `max`,
    `round`, `ceil`, `floor`, `abs` (Backend_Architecture разд. 1:
    function_registry/arithmetic.py) are looked up by name through
    `FunctionFormula` instead, so each operation has exactly one
    representation in the tree (no `OperatorFormula(op="min")` vs
    `FunctionFormula(function_name="min")` ambiguity)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    node_type: Literal["operator"] = "operator"
    op: ArithmeticOperator
    args: list[Formula] = Field(min_length=2)


class FunctionFormula(BaseModel):
    """A named-function call resolved via `function_registry.registry`
    (fixed lookup table — Backend_Architecture разд. 1: "ФИКСИРОВАН").
    Covers unary ops (`round`, `ceil`, `floor`, `abs`) and calendar
    functions (`working_days_count`, `pre_holiday_days_count`)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    node_type: Literal["function"] = "function"
    function_name: str = Field(min_length=1)
    args: list[Formula] = Field(default_factory=list)


class ConditionalFormula(BaseModel):
    """`if condition then <then_branch> else <else_branch>` — used e.g. to
    select between `election_allowed`-gated compensation forms (Calculation
    Engine, Алгоритм К шаг 5)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    node_type: Literal["conditional"] = "conditional"
    condition: ConditionNode
    then_branch: Formula
    else_branch: Formula


class RuleReferenceFormula(BaseModel):
    """References another rule's *result*, resolved through the Version
    Resolver for the given `scope`/`as_of` (defaults to the enclosing
    calculation's own `as_of` date when omitted — Calculation Engine
    Алгоритм 0.2: "правило берётся на дату события") — e.g. the
    `compensation_coefficient` formula referencing the `norm_calculation`
    result for the same employee/period."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    node_type: Literal["rule_reference"] = "rule_reference"
    rule_code: str = Field(min_length=1)
    scope: dict[str, str] = Field(default_factory=dict)
    as_of: date | None = None


Formula = Annotated[
    LiteralFormula
    | VariableFormula
    | OperatorFormula
    | FunctionFormula
    | ConditionalFormula
    | RuleReferenceFormula,
    Field(discriminator="node_type"),
]

OperatorFormula.model_rebuild()
FunctionFormula.model_rebuild()
ConditionalFormula.model_rebuild()
