"""LM008 — карточка отпуска."""

from __future__ import annotations

from uuid import UUID

from src.modules.leave_management.application.ports import LeaveGrantRepositoryPort
from src.modules.leave_management.domain.errors import LeaveGrantNotFoundError
from src.modules.leave_management.domain.leave_grant import LeaveGrant


class GetLeaveGrantHandler:
    def __init__(self, repo: LeaveGrantRepositoryPort) -> None:
        self._repo = repo

    async def handle(self, grant_id: UUID) -> LeaveGrant:
        grant = await self._repo.get(grant_id)
        if grant is None:
            raise LeaveGrantNotFoundError(str(grant_id))
        return grant
