"""Публичный контракт: версия правила ПО ИДЕНТИФИКАТОРУ.

Второй запрос к `legal_rules` после `GetEffectiveRuleVersion`, и вопрос у
него другой. Тот отвечает «какая норма действует на дату X» — вопрос того,
кто только собирается применить правило. Этот отвечает «что написано в
норме, на которую уже сослались» — вопрос того, кто исполняет уже
возникшее обязательство.

--- Кому это понадобилось ----------------------------------------------

`rest_balance` начисляет сутки отдыха по строке компенсации и переводит
часы в сутки коэффициентом (Алгоритм Л). Взять коэффициент повторным
поиском по `scope` он не может по двум причинам:

* `CompensationLineCreated` не несёт `legal_base`, а `scope` правила
  компенсации состоит из него и категории часов — поиск по половине
  ключа не нашёл бы ничего (`scope` сверяется точным равенством jsonb);
* даже если бы нашёл, это могла оказаться ДРУГАЯ редакция: между
  финализацией дела и разбором события правило могло смениться, и тогда
  сутки считались бы не по той норме, ссылка на которую записана в
  начислении.

Событие несёт `legal_basis_rule_version_id` — ту самую версию, по которой
компенсация и возникла. Прочитать её по идентификатору и есть
единственный способ остаться последовательным: провенанс начисления
(инвариант 8.1.2) и норма, по которой оно посчитано, обязаны быть одним и
тем же документом.

--- Что отдаётся -------------------------------------------------------

DTO, а не агрегат `Rule` (Architecture разд. 4.2 п.3). `actions` — уже
разобранный `list[Action]` из `rule_engine`, то есть сквозной тип, а не
внутренний тип этого модуля.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.legal_rules.infrastructure.write.orm_mapping import (
    rule_table,
    rule_version_table,
)
from src.rule_engine.schemas.action import Action

__all__ = [
    "RuleVersionContent",
    "RuleVersionNotFound",
    "get_rule_version_by_id",
]


class RuleVersionNotFound(LookupError):
    """Версии с таким идентификатором нет. Отображается в 404."""


@dataclass(frozen=True, kw_only=True)
class RuleVersionContent:
    id: UUID
    rule_code: str
    scope: dict[str, str]
    actions: list[Action]


class GetRuleVersionById(Protocol):
    async def __call__(self, *, version_id: UUID) -> RuleVersionContent: ...


_actions_adapter: TypeAdapter[list[Action]] = TypeAdapter(list[Action])


async def get_rule_version_by_id(
    session: AsyncSession, *, version_id: UUID
) -> RuleVersionContent:
    row = (
        await session.execute(
            select(
                rule_version_table.c.id,
                rule_version_table.c.scope,
                rule_version_table.c.formula_definition,
                rule_table.c.code,
            )
            .select_from(
                rule_version_table.join(
                    rule_table, rule_table.c.id == rule_version_table.c.rule_id
                )
            )
            .where(rule_version_table.c.id == version_id)
        )
    ).one_or_none()

    if row is None:
        raise RuleVersionNotFound(str(version_id))

    # Колонка отдаёт доменный VO `Scope` (его `TypeDecorator` восстанавливает
    # при чтении), потребителю нужен обычный словарь.
    scope = row.scope.as_dict() if hasattr(row.scope, "as_dict") else dict(row.scope)

    return RuleVersionContent(
        id=row.id,
        rule_code=str(row.code),
        scope=scope,
        actions=_actions_adapter.validate_python(row.formula_definition),
    )
