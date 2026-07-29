"""Handler for `CreateRuleVersionCommand` (LR007)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.legal_rules.application.commands.create_rule_version.command import (
    CreateRuleVersionCommand,
)
from src.modules.legal_rules.application.ports import RuleRepositoryPort
from src.modules.legal_rules.domain.errors import RuleNotFoundError
from src.modules.legal_rules.domain.rule import RuleVersion
from src.modules.legal_rules.domain.value_objects import LegalBasis, Scope


class CreateRuleVersionHandler:
    def __init__(self, session: AsyncSession, repo: RuleRepositoryPort) -> None:
        self._session = session
        self._repo = repo

    async def handle(self, command: CreateRuleVersionCommand) -> RuleVersion:
        rule = await self._repo.get(command.rule_id)
        if rule is None:
            raise RuleNotFoundError(str(command.rule_id))

        # Actions are validated Pydantic models at this point (RE005) —
        # converted to plain dict/list primitives before crossing into
        # Domain, which must not depend on Pydantic (Backend_Architecture
        # разд. 3.1/6.3). Overlap/immutability invariants are NOT checked
        # here — drafts never are (Rule.draft_new_version() docstring).
        version = rule.draft_new_version(
            scope=Scope.from_dict(command.scope),
            legal_basis=LegalBasis(node_id=command.legal_basis_node_id),
            formula_definition=[action.model_dump(mode="json") for action in command.actions],
            valid_from=command.valid_from,
            valid_to=command.valid_to,
        )
        await self._session.commit()
        return version
