"""Handler for `ListRulesQuery`."""

from __future__ import annotations

from src.modules.legal_rules.application.ports import RuleRepositoryPort
from src.modules.legal_rules.application.queries.list_rules.query import ListRulesQuery
from src.modules.legal_rules.domain.rule import Rule


class ListRulesHandler:
    def __init__(self, repo: RuleRepositoryPort) -> None:
        self._repo = repo

    async def handle(self, query: ListRulesQuery) -> tuple[list[Rule], int]:
        return await self._repo.list(
            category=query.category, page=query.page, page_size=query.page_size
        )
