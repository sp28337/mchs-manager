"""Обработчик `FinalizeCompensationCaseCommand` (CO009).

Алгоритм К шаг 9. После финализации дело неизменяемо: начисление
произошло.

DoD задачи: «финализация публикует `CompensationLineCreated` для каждой
строки». События поднимает агрегат, а обработчик отправляет их в outbox
той же транзакцией — иначе `rest_balance` мог бы начислить сутки отдыха
по делу, которое не сохранилось, или не начислить по сохранённому.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.compensation.application.commands.finalize_compensation_case.command import (
    FinalizeCompensationCaseCommand,
)
from src.modules.compensation.application.ports import CompensationCaseRepositoryPort
from src.modules.compensation.domain.compensation_case import CompensationCase
from src.modules.compensation.domain.errors import CaseNotFoundError


class FinalizeCompensationCaseHandler:
    def __init__(
        self,
        session: AsyncSession,
        repo: CompensationCaseRepositoryPort,
        outbox: OutboxWriter,
    ) -> None:
        self._session = session
        self._repo = repo
        self._outbox = outbox

    async def handle(self, command: FinalizeCompensationCaseCommand) -> CompensationCase:
        case = await self._repo.get(command.case_id)
        if case is None:
            raise CaseNotFoundError(str(command.case_id))

        case.finalize()
        await self._outbox.enqueue(case)
        await self._session.commit()
        return case
