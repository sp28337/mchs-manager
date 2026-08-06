"""RB007/RB008 — реализация read-портов.

Читают write-таблицу и материализованное представление напрямую, без
отдельной read-модели. `RestBalance` — не CQRS-модуль (Architecture
разд. 8.2, тот же довод, что у `legal_rules`): чтение здесь — выборка по
одному индексированному ключу (`ix_balance_movement_employee`), и
проекция была бы третьим представлением тех же данных после журнала и
`current_balance`.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.rest_balance.domain.balance import BalanceMovement
from src.modules.rest_balance.infrastructure.orm_mapping import balance_movement_table
from src.modules.rest_balance.infrastructure.read_orm_mapping import current_balance_view


class CurrentBalanceReader:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def balance_days(self, employee_id: UUID) -> Decimal | None:
        row = (
            await self._session.execute(
                select(current_balance_view.c.balance_days).where(
                    current_balance_view.c.employee_id == employee_id
                )
            )
        ).one_or_none()
        return Decimal(row.balance_days) if row is not None else None


class MovementJournal:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def page(
        self,
        *,
        employee_id: UUID,
        period_start: date | None,
        period_end: date | None,
        page: int,
        page_size: int,
    ) -> tuple[list[BalanceMovement], int]:
        filters = [balance_movement_table.c.employee_id == employee_id]
        if period_start is not None:
            filters.append(balance_movement_table.c.movement_date >= period_start)
        if period_end is not None:
            # Полуинтервал: движение 1 апреля принадлежит апрелю, а не
            # марту, и ни одно не попадает в два периода сразу.
            filters.append(balance_movement_table.c.movement_date < period_end)

        total = await self._session.scalar(
            select(func.count()).select_from(balance_movement_table).where(*filters)
        )

        result = await self._session.execute(
            select(BalanceMovement)
            .where(*filters)
            .order_by(
                balance_movement_table.c.movement_date.desc(),
                balance_movement_table.c.created_at.desc(),
            )
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
        return list(result.scalars().all()), int(total or 0)
