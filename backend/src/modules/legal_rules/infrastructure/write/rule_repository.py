"""Write-side repository for the `Rule` aggregate — the only way
Application-layer command handlers touch persistence for this module
(Architecture разд. 6: "Handler — оркестратор: порт репозитория → метод
агрегата → сохранение"). No Transactional Outbox write yet: the
`outbox_message` table (Architecture разд. 9.2) hasn't been migrated —
`Rule.pull_pending_events()` exists and is exercised by domain tests, but
nothing calls it from here yet. Flagged rather than faked; wiring it in is
the very next step once the Outbox migration lands.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.legal_rules.domain.rule import Rule
from src.modules.legal_rules.domain.value_objects import RuleCategory
from src.modules.legal_rules.infrastructure.write.orm_mapping import rule_table, rule_version_table


class RuleRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, rule_id: UUID) -> Rule | None:
        return await self._session.get(Rule, rule_id)

    async def get_by_code(self, code: str) -> Rule | None:
        result = await self._session.execute(select(Rule).where(rule_table.c.code == code))
        return result.scalar_one_or_none()

    async def get_by_version_id(self, version_id: UUID) -> Rule | None:
        """openapi.yaml's `POST /legal-rules/rule-versions/{versionId}/publish`
        addresses a version directly, with no `ruleId` in the path — but
        publishing is a `Rule.publish_version()` call on the owning
        aggregate. Resolves the parent `Rule` (with all its versions
        eager-loaded, same as `get()`) from just the version id."""
        rule_id = await self._session.scalar(
            select(rule_version_table.c.rule_id).where(rule_version_table.c.id == version_id)
        )
        if rule_id is None:
            return None
        return await self.get(rule_id)

    async def list(
        self, *, category: RuleCategory | None, page: int, page_size: int
    ) -> tuple[list[Rule], int]:
        """openapi.yaml `GET /legal-rules/rules` → `RuleListEnvelope`
        (`items`, `page`, `pageSize`, `totalCount`). `LegalRulesAndCalculation`
        is explicitly NOT a CQRS module (Architecture разд. 8.2: "чтение —
        точечный lookup по ключу, решается кэшем без отдельной read-модели")
        — this reads straight off the same write-side `rule` table, no
        separate projection, consistent with that decision.
        """
        filters = [rule_table.c.category == category.value] if category is not None else []

        total_count = await self._session.scalar(
            select(func.count()).select_from(rule_table).where(*filters)
        )

        result = await self._session.execute(
            select(Rule)
            .where(*filters)
            .order_by(rule_table.c.code)
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
        return list(result.scalars().all()), int(total_count or 0)

    def add(self, rule: Rule) -> None:
        self._session.add(rule)
