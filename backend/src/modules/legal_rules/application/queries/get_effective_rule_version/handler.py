"""Handler for `GetEffectiveRuleVersionQuery` (LR010) — as expected, a
thin wrapper: all the actual lookup logic already lives in
`rule_engine.interpreter.version_resolver` (RE014), which this module is
free to call because `rule_engine` is cross-cutting (Backend_Architecture
разд. 1) — only the reverse direction (`rule_engine` importing from a
module) is forbidden by `.importlinter`.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncConnection

from src.modules.legal_rules.application.queries.get_effective_rule_version.query import (
    GetEffectiveRuleVersionQuery,
)
from src.rule_engine.interpreter.version_resolver import (
    ResolvedRuleVersion,
    resolve_effective_version,
)


class GetEffectiveRuleVersionHandler:
    def __init__(self, connection: AsyncConnection) -> None:
        self._connection = connection

    async def handle(self, query: GetEffectiveRuleVersionQuery) -> ResolvedRuleVersion:
        return await resolve_effective_version(
            self._connection, rule_code=query.rule_code, scope=query.scope, as_of=query.as_of
        )
