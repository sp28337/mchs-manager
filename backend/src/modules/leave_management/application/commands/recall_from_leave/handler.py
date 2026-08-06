"""LM007 — отзыв из отпуска (ФЗ-141 ст. 65).

DoD: «остаток дней после отзыва явно зафиксирован».

«Явно» — ключевое слово, и относится оно к инварианту 9.1.3: период
отпуска НЕ укорачивается, а неиспользованный остаток вычисляется из
разницы между предоставленным периодом и датой прерывания. Это делает
агрегат; здесь остаётся оркестрация и публикация события, которое несёт
остаток дальше — кадровой службе, обязанной предоставить его в удобное
для сотрудника время (ст. 65 ч. 3).
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.leave_management.application.commands.recall_from_leave.command import (
    RecallFromLeaveCommand,
)
from src.modules.leave_management.application.ports import LeaveGrantRepositoryPort
from src.modules.leave_management.domain.errors import LeaveGrantNotFoundError
from src.modules.leave_management.domain.leave_grant import RecallEvent


class RecallFromLeaveHandler:
    def __init__(
        self,
        session: AsyncSession,
        repo: LeaveGrantRepositoryPort,
        outbox: OutboxWriter,
    ) -> None:
        self._session = session
        self._repo = repo
        self._outbox = outbox

    async def handle(self, command: RecallFromLeaveCommand) -> RecallEvent:
        grant = await self._repo.get(command.grant_id)
        if grant is None:
            raise LeaveGrantNotFoundError(str(command.grant_id))

        event = grant.recall(
            recall_date=command.recall_date, effective_from=command.effective_from
        )

        await self._outbox.enqueue(grant)
        await self._session.commit()
        return event
