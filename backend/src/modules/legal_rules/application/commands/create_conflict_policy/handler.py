"""Обработчик `CreateConflictPolicyCommand`.

Политика заводится пустой — без версий, как и `Rule`. Порядок приоритетов
принадлежит ВЕРСИИ, а не политике: он меняется ведомственным актом, и
именно версия несёт даты, с которых новый порядок действует. Политика же —
устойчивая идентичность («тот самый порядок приоритетов категорий часов»),
переживающая все свои редакции.
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.legal_rules.application.commands.create_conflict_policy.command import (
    CreateConflictPolicyCommand,
)
from src.modules.legal_rules.application.ports import ConflictPolicyRepositoryPort
from src.modules.legal_rules.domain.conflict_policy import ConflictResolutionPolicy
from src.modules.legal_rules.domain.errors import PolicyCodeAlreadyExistsError


class CreateConflictPolicyHandler:
    def __init__(self, session: AsyncSession, repo: ConflictPolicyRepositoryPort) -> None:
        self._session = session
        self._repo = repo

    async def handle(self, command: CreateConflictPolicyCommand) -> ConflictResolutionPolicy:
        code = command.code.strip()
        if not code:
            raise ValueError("код политики обязателен")
        if await self._repo.get_by_code(code) is not None:
            raise PolicyCodeAlreadyExistsError(f"политика с кодом {code!r} уже существует")

        policy = ConflictResolutionPolicy(id=uuid4(), code=code, versions=[])
        self._repo.add(policy)
        await self._session.commit()
        return policy
