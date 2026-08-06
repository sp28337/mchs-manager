"""Обработчик `DraftConflictPolicyVersionCommand`.

Версия рождается черновиком и в расчёте не участвует: контракт
`get_effective_conflict_policy` отбирает только `published`/`superseded`.
Это то же разделение, что у правил, и по той же причине — редакция акта
существует раньше, чем вступает в силу.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.legal_rules.application.commands.draft_conflict_policy_version.command import (
    DraftConflictPolicyVersionCommand,
)
from src.modules.legal_rules.application.ports import ConflictPolicyRepositoryPort
from src.modules.legal_rules.domain.conflict_policy import ConflictResolutionPolicyVersion
from src.modules.legal_rules.domain.errors import PolicyNotFoundError


class DraftConflictPolicyVersionHandler:
    def __init__(self, session: AsyncSession, repo: ConflictPolicyRepositoryPort) -> None:
        self._session = session
        self._repo = repo

    async def handle(
        self, command: DraftConflictPolicyVersionCommand
    ) -> ConflictResolutionPolicyVersion:
        policy = await self._repo.get_by_code(command.policy_code)
        if policy is None:
            raise PolicyNotFoundError(f"политика {command.policy_code!r} не найдена")

        version = policy.draft_new_version(
            precedence_list=command.precedence_list,
            valid_from=command.valid_from,
            valid_to=command.valid_to,
        )
        await self._session.commit()
        return version
