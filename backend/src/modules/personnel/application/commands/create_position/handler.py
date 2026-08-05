"""Handler for `CreatePositionCommand` (PE006)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.personnel.application.commands.create_position.command import (
    CreatePositionCommand,
)
from src.modules.personnel.application.ports import PositionRepositoryPort
from src.modules.personnel.domain.errors import PositionCodeAlreadyExistsError
from src.modules.personnel.domain.position import Position


class CreatePositionHandler:
    def __init__(self, session: AsyncSession, repo: PositionRepositoryPort) -> None:
        self._session = session
        self._repo = repo

    async def handle(self, command: CreatePositionCommand) -> Position:
        if await self._repo.get_by_code(command.code) is not None:
            raise PositionCodeAlreadyExistsError(command.code)

        position = Position.create(
            code=command.code,
            title=command.title,
            category=command.category,
            default_regime_type=command.default_regime_type,
        )
        self._repo.add(position)
        await self._session.commit()
        return position
