"""LM009 — списание ДДО при присоединении к отпуску.

Anticorruption layer в буквальном смысле: `leave_management` знает про
одну функцию и одно исключение чужого модуля, и ничего больше. DoD
задачи требует именно этого — «присоединение вызывает
`RestBalance.contracts`, не импортируя `rest_balance.domain`».

Собственная транзакция здесь не открывается: сессия та же, что у
предоставления отпуска, и коммитит её обработчик. Приказ либо издан со
списанием, либо не издан вовсе.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.rest_balance.contracts.consume_rest_days import consume_rest_days


class RestBalanceClient:
    """`RestBalanceConsumptionPort` поверх контракта `rest_balance`."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def consume(
        self,
        *,
        employee_id: UUID,
        days: Decimal,
        movement_date: date,
        leave_grant_id: UUID,
    ) -> UUID:
        return await consume_rest_days(
            self._session,
            employee_id=employee_id,
            days=days,
            movement_date=movement_date,
            leave_grant_id=leave_grant_id,
        )
