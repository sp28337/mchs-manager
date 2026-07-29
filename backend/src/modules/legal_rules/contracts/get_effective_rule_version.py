"""LR015 — public Contract for `legal_rules`. Architecture разд. 4.2:
"Модуль может импортировать только Contracts/ другого модуля" — this is
that surface for the one query every other module needs
("действует ли эта версия правила на дату X", Architecture разд. 4.2 п.2).

Deliberately a thin re-export/adapter over `GetEffectiveRuleVersionQuery`/
`Handler`, not a new implementation — Contracts describe the *interface* a
consumer depends on, they don't duplicate logic (Architecture разд. 4.2
п.3: "Query-контракт не возвращает сам объект чужого агрегата — только
проекцию/DTO"). `ResolvedRuleVersion` (from `rule_engine`, cross-cutting)
already IS such a DTO — it is not `legal_rules.domain.Rule`/`RuleVersion`,
so re-exporting it here does not leak this module's aggregate.
"""

from __future__ import annotations

from datetime import date
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncConnection

from src.modules.legal_rules.application.queries.get_effective_rule_version.handler import (
    GetEffectiveRuleVersionHandler,
)
from src.modules.legal_rules.application.queries.get_effective_rule_version.query import (
    GetEffectiveRuleVersionQuery,
)
from src.rule_engine.interpreter.version_resolver import (
    NoApplicableRuleVersionError as RuleVersionNotApplicable,
)
from src.rule_engine.interpreter.version_resolver import (
    ResolvedRuleVersion as EffectiveRuleVersion,
)

__all__ = ["EffectiveRuleVersion", "GetEffectiveRuleVersion", "RuleVersionNotApplicable"]


class GetEffectiveRuleVersion(Protocol):
    async def __call__(
        self, *, rule_code: str, scope: dict[str, str], as_of: date
    ) -> EffectiveRuleVersion: ...


async def get_effective_rule_version(
    connection: AsyncConnection, *, rule_code: str, scope: dict[str, str], as_of: date
) -> EffectiveRuleVersion:
    """Free-function adapter satisfying `GetEffectiveRuleVersion` — a
    consuming module's `infrastructure` wires this to a concrete
    `AsyncConnection` and depends only on this file, never on
    `legal_rules.domain`/`legal_rules.infrastructure` directly (raises
    `RuleVersionNotApplicable` — a re-export, not a new error type — on no
    match, mapped to 404 at whichever API boundary calls it)."""
    return await GetEffectiveRuleVersionHandler(connection).handle(
        GetEffectiveRuleVersionQuery(rule_code=rule_code, scope=scope, as_of=as_of)
    )
