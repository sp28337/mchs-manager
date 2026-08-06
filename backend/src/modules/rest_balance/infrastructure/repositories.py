"""RB003 — write-side репозиторий `RestDaysBalance`.

Агрегат собирается из журнала, а не загружается строкой: своей таблицы у
него нет (см. докстринг `orm_mapping`).

--- Почему движения загружаются все ------------------------------------

Инвариант 8.1.1 проверяется по СУММЕ движений сотрудника. Загрузить
половину журнала и проверить по ней — значит проверить не то: остаток,
посчитанный по части истории, не остаток.

Цена названа в докстринге агрегата: журнал растёт линейно по времени
службы, и когда она перестанет быть приемлемой, ответом будет снимок
остатка на дату, а не отказ от инварианта.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.rest_balance.domain.balance import BalanceMovement, RestDaysBalance
from src.modules.rest_balance.infrastructure.orm_mapping import balance_movement_table


class RestDaysBalanceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, employee_id: UUID) -> RestDaysBalance:
        """Баланс есть у любого сотрудника, в том числе пустой.

        `None` не возвращается сознательно: «остаток 0» и «баланс не
        заведён» — не разные состояния, и заставлять вызывающего
        различать их значило бы придумать состояние, которого нет.
        """
        result = await self._session.execute(
            select(BalanceMovement)
            .where(balance_movement_table.c.employee_id == employee_id)
            .order_by(
                balance_movement_table.c.movement_date,
                balance_movement_table.c.created_at,
            )
        )
        return RestDaysBalance.for_employee(employee_id, list(result.scalars().all()))

    async def get_movement(self, movement_id: UUID) -> BalanceMovement | None:
        return await self._session.get(BalanceMovement, movement_id)

    def save(self, balance: RestDaysBalance) -> None:
        """Добавляет в сессию движения, которых в ней ещё нет.

        `session.add` на уже загруженном объекте — no-op: SQLAlchemy
        узнаёт его по identity map. Поэтому перебирать можно все движения,
        не отслеживая, какие из них новые, — и не заводить в агрегате
        поле «что добавлено с момента загрузки», которое пришлось бы
        поддерживать вручную при каждом новом методе.
        """
        for movement in balance.movements:
            self._session.add(movement)
