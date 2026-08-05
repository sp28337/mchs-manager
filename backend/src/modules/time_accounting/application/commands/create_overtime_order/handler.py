"""Обработчик `CreateOvertimeOrderCommand` (TA013).

DoD: «дубликат order_number отклоняется». Как и в `OpenTimesheet`,
проверка сделана запросом ради внятного тела ответа, а
`uq_overtime_order_number` остаётся последним рубежом на случай гонки.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.time_accounting.application.commands.create_overtime_order.command import (
    CreateOvertimeOrderCommand,
)
from src.modules.time_accounting.application.ports import OvertimeOrderRepositoryPort
from src.modules.time_accounting.domain.errors import OvertimeOrderNumberTakenError
from src.modules.time_accounting.domain.overtime_order import OvertimeOrder


class CreateOvertimeOrderHandler:
    def __init__(self, session: AsyncSession, orders: OvertimeOrderRepositoryPort) -> None:
        self._session = session
        self._orders = orders

    async def handle(self, command: CreateOvertimeOrderCommand) -> OvertimeOrder:
        number = command.order_number.strip()
        if await self._orders.exists_with_number(number):
            raise OvertimeOrderNumberTakenError(
                f"приказ с номером {number!r} уже зарегистрирован"
            )

        order = OvertimeOrder.issue(
            order_number=number,
            issued_date=command.issued_date,
            issued_by=command.issued_by,
            reason=command.reason,
        )
        self._orders.add(order)
        await self._session.commit()
        return order
