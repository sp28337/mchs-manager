"""Публичный контракт `rest_balance`: списание суток отдыха.

Появился для `leave_management` (LM009): Приказ МЧС России № 410 п. 12
допускает присоединение дополнительных дней отдыха к ежегодному отпуску,
и приказ об отпуске обязан списать их с баланса — иначе те же сутки
можно было бы использовать второй раз отгулом.

--- Почему контракт, а не прямой вызов обработчика ---------------------

Architecture разд. 4.2: модуль импортирует только `contracts/` другого
модуля. DoD LM009 формулирует то же требование с другой стороны —
«присоединение вызывает `RestBalance.contracts`, не импортируя
`rest_balance.domain`».

Разница не церемониальная. Прямой вызов означал бы, что
`leave_management` знает про `RestDaysBalance`, `RestDays` и
`InsufficientBalanceError`, то есть про устройство чужого агрегата. Здесь
наружу уходит идентификатор движения и одно исключение — «суток не
хватает», — и этого достаточно, чтобы отказать в приказе.

--- Почему без своей транзакции ---------------------------------------

Сессия приходит аргументом, и коммитит вызывающий. Присоединение суток к
отпуску и само предоставление — один факт: приказ либо издан со
списанием, либо не издан. Собственный коммит здесь оставил бы списанные
сутки при откате приказа, то есть отнял бы у сотрудника дни, которых он
не использовал.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.rest_balance.domain.errors import (
    InsufficientBalanceError as NotEnoughRestDays,
)
from src.modules.rest_balance.domain.value_objects import RestDays
from src.modules.rest_balance.infrastructure.orm_mapping import outbox_message_table
from src.modules.rest_balance.infrastructure.repositories import RestDaysBalanceRepository

__all__ = ["ConsumeRestDays", "NotEnoughRestDays", "consume_rest_days"]


class ConsumeRestDays(Protocol):
    async def __call__(
        self,
        *,
        employee_id: UUID,
        days: Decimal,
        movement_date: date,
        leave_grant_id: UUID,
    ) -> UUID: ...


async def consume_rest_days(
    session: AsyncSession,
    *,
    employee_id: UUID,
    days: Decimal,
    movement_date: date,
    leave_grant_id: UUID,
) -> UUID:
    """Списывает сутки отдыха. Возвращает идентификатор движения.

    НЕ коммитит: транзакцией распоряжается вызывающий (см. докстринг
    модуля). Поднимает `NotEnoughRestDays`, если остатка не хватает —
    инвариант 8.1.1 проверяется тем же агрегатом, что и при обычном
    рапорте, и никакого обходного пути для присоединения к отпуску нет.
    """
    repo = RestDaysBalanceRepository(session)
    balance = await repo.get(employee_id)

    movement = balance.consume(
        amount=RestDays(days=days),
        movement_date=movement_date,
        leave_grant_id=leave_grant_id,
    )

    repo.save(balance)
    await OutboxWriter(session, outbox_message_table).enqueue(balance)
    return movement.id
