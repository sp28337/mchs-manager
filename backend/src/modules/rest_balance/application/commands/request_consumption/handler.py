"""RB005 — списание ДДО.

DoD: «запрос сверх остатка возвращает 422 с указанием текущего остатка».
Отказывает агрегат (инвариант 8.1.1), а `InsufficientBalanceError` несёт
остаток и запрошенную величину — роутер только перекладывает их в тело
ответа. Второй проверки здесь нет намеренно: два места, где написано одно
и то же, однажды разойдутся, и разойдутся молча.

--- Самовольное использование ------------------------------------------

Приказ МЧС России № 410 п. 17: «самовольное использование сотрудником
дополнительного времени отдыха... не допускается», а п. 15 требует
рапорта, согласованного с непосредственным руководителем. Эта команда
записывает УЖЕ СОСТОЯВШЕЕСЯ решение — движение баланса есть след
исполненного рапорта, а не сам рапорт.

Согласование живёт там, где живёт рапорт (`leave_management`, фаза 10) и
в разграничении прав на эндпоинт. Заводить здесь второй маршрут
согласования значило бы иметь два ответа на вопрос, разрешён ли отгул.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.rest_balance.application.commands.request_consumption.command import (
    RequestConsumptionCommand,
)
from src.modules.rest_balance.application.ports import RestDaysBalanceRepositoryPort
from src.modules.rest_balance.domain.balance import BalanceMovement
from src.modules.rest_balance.domain.value_objects import RestDays


class RequestConsumptionHandler:
    def __init__(
        self,
        session: AsyncSession,
        repo: RestDaysBalanceRepositoryPort,
        outbox: OutboxWriter,
    ) -> None:
        self._session = session
        self._repo = repo
        self._outbox = outbox

    async def handle(self, command: RequestConsumptionCommand) -> BalanceMovement:
        balance = await self._repo.get(command.employee_id)

        movement = balance.consume(
            amount=RestDays(days=command.amount_days),
            movement_date=command.movement_date,
            leave_grant_id=command.leave_grant_id,
        )

        self._repo.save(balance)
        await self._outbox.enqueue(balance)
        await self._session.commit()
        return movement
