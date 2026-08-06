"""Обработчик `PublishConflictPolicyVersionCommand`.

Публикация — момент, с которого порядок приоритетов начинает применяться
в расчёте, поэтому она же закрывает предыдущую действующую версию
(`_supersede`). Логика целиком в агрегате: пересечение интервалов
действия — доменный инвариант, а не правило оркестрации.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.legal_rules.application.commands.publish_conflict_policy_version.command import (
    PublishConflictPolicyVersionCommand,
)
from src.modules.legal_rules.application.ports import ConflictPolicyRepositoryPort
from src.modules.legal_rules.domain.conflict_policy import ConflictResolutionPolicyVersion
from src.modules.legal_rules.domain.errors import PolicyNotFoundError


class PublishConflictPolicyVersionHandler:
    def __init__(
        self,
        session: AsyncSession,
        repo: ConflictPolicyRepositoryPort,
        outbox: OutboxWriter,
    ) -> None:
        self._session = session
        self._repo = repo
        self._outbox = outbox

    async def handle(
        self, command: PublishConflictPolicyVersionCommand
    ) -> ConflictResolutionPolicyVersion:
        policy = await self._repo.get_by_version_id(command.version_id)
        if policy is None:
            raise PolicyNotFoundError(f"версия политики {command.version_id} не найдена")

        version = policy.publish_version(command.version_id, now=datetime.now(UTC))
        await self._outbox.enqueue(policy)
        await self._session.commit()
        return version
