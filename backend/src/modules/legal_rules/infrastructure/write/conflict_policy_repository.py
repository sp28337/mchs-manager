"""Write-side репозиторий агрегата `ConflictResolutionPolicy`.

Появился позже остальных, и причина показательна: агрегат, маппинг и
доменные тесты существовали с фазы 2, а завести политику через API было
нельзя — `openapi.yaml` не описывает над ней ни одной операции. Пробел
обнаружился при реализации Алгоритма Ж, которому эта политика нужна как
обязательный вход: без порядка приоритетов час, одновременно ночной и
праздничный, отнести не к чему, и утверждение табеля отказывает.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.legal_rules.domain.conflict_policy import ConflictResolutionPolicy
from src.modules.legal_rules.infrastructure.write.orm_mapping import (
    conflict_resolution_policy_table,
    conflict_resolution_policy_version_table,
)


class ConflictResolutionPolicyRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, policy_id: UUID) -> ConflictResolutionPolicy | None:
        return await self._session.get(ConflictResolutionPolicy, policy_id)

    async def get_by_code(self, code: str) -> ConflictResolutionPolicy | None:
        result = await self._session.execute(
            select(ConflictResolutionPolicy).where(
                conflict_resolution_policy_table.c.code == code
            )
        )
        return result.scalar_one_or_none()

    async def get_by_version_id(self, version_id: UUID) -> ConflictResolutionPolicy | None:
        """Публикация адресует версию напрямую, но выполняется методом
        владеющего агрегата — как и у `Rule.publish_version`."""
        policy_id = await self._session.scalar(
            select(conflict_resolution_policy_version_table.c.policy_id).where(
                conflict_resolution_policy_version_table.c.id == version_id
            )
        )
        if policy_id is None:
            return None
        return await self.get(policy_id)

    async def list_all(self) -> list[ConflictResolutionPolicy]:
        """Без пагинации, в отличие от правил, и это не небрежность:
        политик разрешения конфликта в системе единицы (сегодня — одна,
        `HOURS.CATEGORY_PRECEDENCE`). Пагинация над таблицей из одной
        строки была бы формой без содержания."""
        result = await self._session.execute(
            select(ConflictResolutionPolicy).order_by(conflict_resolution_policy_table.c.code)
        )
        return list(result.scalars().all())

    def add(self, policy: ConflictResolutionPolicy) -> None:
        self._session.add(policy)
