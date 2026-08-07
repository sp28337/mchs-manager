"""Handler for `ListRuleVersionsQuery`.

Читает через тот же репозиторий, что и запись: `Rule` — агрегат, и его
версии загружаются вместе с ним (`lazy="selectin"`), потому что
`publish_version()` обязан видеть соседние версии, чтобы закрыть
предыдущую по тому же scope. Отдельная проекция под чтение здесь была бы
второй копией того же (Architecture разд. 8.2: `LegalRulesAndCalculation`
— не CQRS-модуль).

Порядок — по номеру версии: он монотонен в пределах правила и означает
последовательность редакций. Сортировать по дате начала действия было бы
неверно — редакция, изданная позже, может действовать с более ранней
даты, и такой список перепутал бы «издано» с «действует».
"""

from __future__ import annotations

from src.modules.legal_rules.application.ports import RuleRepositoryPort
from src.modules.legal_rules.application.queries.list_rule_versions.query import (
    ListRuleVersionsQuery,
)
from src.modules.legal_rules.domain.errors import RuleNotFoundError
from src.modules.legal_rules.domain.rule import RuleVersion


class ListRuleVersionsHandler:
    def __init__(self, repo: RuleRepositoryPort) -> None:
        self._repo = repo

    async def handle(self, query: ListRuleVersionsQuery) -> list[RuleVersion]:
        rule = await self._repo.get(query.rule_id)
        if rule is None:
            raise RuleNotFoundError(str(query.rule_id))
        return sorted(rule.versions, key=lambda version: version.version_no)
