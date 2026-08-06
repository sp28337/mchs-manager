"""RB006 — сторно движения баланса.

DoD: «сторно создаёт новую запись, исходная не изменяется». Обеспечивают
это трое, и каждый по-своему: агрегат не даёт изменить поля движения,
триггер `trg_balance_movement_append_only` отвергает `UPDATE`/`DELETE` на
уровне БД, а связь `reverses_movement_id` лежит на сторнирующей строке,
так что записывать в исправляемую попросту нечего (см. докстринг
миграции 0021).
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.rest_balance.application.commands.reverse_movement.command import (
    ReverseMovementCommand,
)
from src.modules.rest_balance.application.ports import RestDaysBalanceRepositoryPort
from src.modules.rest_balance.domain.balance import BalanceMovement
from src.modules.rest_balance.domain.errors import MovementNotFoundError


class ReverseMovementHandler:
    def __init__(
        self,
        session: AsyncSession,
        repo: RestDaysBalanceRepositoryPort,
        outbox: OutboxWriter,
    ) -> None:
        self._session = session
        self._repo = repo
        self._outbox = outbox

    async def handle(self, command: ReverseMovementCommand) -> BalanceMovement:
        # Сотрудник определяется движением, а не приходит снаружи: сторно
        # адресует конкретную запись, и позволить вызывающему назвать
        # чужой баланс значило бы дать способ списать сутки не у того.
        original = await self._repo.get_movement(command.movement_id)
        if original is None:
            raise MovementNotFoundError(str(command.movement_id))

        balance = await self._repo.get(original.employee_id)

        movement = balance.reverse(
            movement_id=command.movement_id,
            reason=command.reason,
            movement_date=command.movement_date,
        )

        self._repo.save(balance)
        await self._outbox.enqueue(balance)
        await self._session.commit()
        return movement
