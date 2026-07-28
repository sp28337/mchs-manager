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

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.legal_rules.domain.rule import Rule
from src.modules.legal_rules.infrastructure.write.orm_mapping import rule_table


class RuleRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, rule_id: UUID) -> Rule | None:
        return await self._session.get(Rule, rule_id)

    async def get_by_code(self, code: str) -> Rule | None:
        result = await self._session.execute(select(Rule).where(rule_table.c.code == code))
        return result.scalar_one_or_none()

    def add(self, rule: Rule) -> None:
        self._session.add(rule)
