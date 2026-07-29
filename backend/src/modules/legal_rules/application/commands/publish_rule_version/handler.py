"""Handler for `PublishRuleVersionCommand` (LR008)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.clock import Clock, SystemClock
from src.modules.legal_rules.application.commands.publish_rule_version.command import (
    PublishRuleVersionCommand,
)
from src.modules.legal_rules.application.ports import RuleRepositoryPort
from src.modules.legal_rules.domain.errors import RuleNotFoundError
from src.modules.legal_rules.domain.rule import RuleVersion


class PublishRuleVersionHandler:
    def __init__(
        self, session: AsyncSession, repo: RuleRepositoryPort, clock: Clock | None = None
    ) -> None:
        self._session = session
        self._repo = repo
        self._clock = clock or SystemClock()

    async def handle(self, command: PublishRuleVersionCommand) -> RuleVersion:
        rule = await self._repo.get(command.rule_id)
        if rule is None:
            raise RuleNotFoundError(str(command.rule_id))

        # Overlap rejection / auto-supersede of the prior active version
        # for the same scope is entirely Rule.publish_version()'s job
        # (rule.py) — the handler only orchestrates, per Architecture
        # разд. 6. `command.change_reason` mirrors the openapi contract
        # (`PublishRuleVersionRequest.changeReason`) but isn't persisted
        # anywhere yet — audit.audit_log (PostgreSQL_Logical_Model разд.
        # 9) has no writer wired in; flagged, not silently dropped.
        version = rule.publish_version(
            command.version_id, published_by=command.published_by, now=self._clock.now()
        )
        await self._session.commit()
        return version
