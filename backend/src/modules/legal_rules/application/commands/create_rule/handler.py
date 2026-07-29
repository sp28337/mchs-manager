"""Handler for `CreateRuleCommand` — pure orchestration (Architecture
разд. 6: "Handler — оркестрация... не место принятия решений"); the
`Rule` constructor itself carries no invariant beyond field types, so
there is no domain method to delegate to here besides construction.
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.legal_rules.application.commands.create_rule.command import CreateRuleCommand
from src.modules.legal_rules.application.ports import RuleRepositoryPort
from src.modules.legal_rules.domain.errors import RuleCodeAlreadyExistsError
from src.modules.legal_rules.domain.rule import Rule


class CreateRuleHandler:
    def __init__(self, session: AsyncSession, repo: RuleRepositoryPort) -> None:
        self._session = session
        self._repo = repo

    async def handle(self, command: CreateRuleCommand) -> Rule:
        if await self._repo.get_by_code(command.code) is not None:
            raise RuleCodeAlreadyExistsError(command.code)

        rule = Rule(
            id=uuid4(),
            code=command.code,
            category=command.category,
            display_name=command.display_name,
            description=command.description,
        )
        self._repo.add(rule)
        # No UnitOfWork/Outbox yet (Architecture разд. 9.2 — not migrated,
        # see rule_repository.py docstring) — the handler commits directly
        # as a temporary simplification, flagged rather than hidden.
        await self._session.commit()
        return rule
