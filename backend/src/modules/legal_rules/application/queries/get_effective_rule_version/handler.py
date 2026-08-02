"""Handler for `GetEffectiveRuleVersionQuery` (LR010/LR011) — thin wrapper
over `rule_engine.interpreter.version_resolver` (RE014), plus an optional
cache-aside (LR011): checks `RuleVersionCachePort` first, falls back to
the resolver on a miss, and writes the fresh result back. `cache=None`
(the default) skips caching entirely — every existing caller/test that
doesn't pass one keeps working unchanged.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncConnection

from src.modules.legal_rules.application.ports import RuleVersionCachePort
from src.modules.legal_rules.application.queries.get_effective_rule_version.query import (
    GetEffectiveRuleVersionQuery,
)
from src.rule_engine.interpreter.version_resolver import (
    ResolvedRuleVersion,
    resolve_effective_version,
)


class GetEffectiveRuleVersionHandler:
    def __init__(
        self, connection: AsyncConnection, cache: RuleVersionCachePort | None = None
    ) -> None:
        self._connection = connection
        self._cache = cache

    async def handle(self, query: GetEffectiveRuleVersionQuery) -> ResolvedRuleVersion:
        if self._cache is not None:
            cached = await self._cache.get(
                rule_code=query.rule_code, scope=query.scope, as_of=query.as_of
            )
            if cached is not None:
                return cached

        resolved = await resolve_effective_version(
            self._connection, rule_code=query.rule_code, scope=query.scope, as_of=query.as_of
        )

        if self._cache is not None:
            await self._cache.set(
                rule_code=query.rule_code, scope=query.scope, as_of=query.as_of, value=resolved
            )

        return resolved
