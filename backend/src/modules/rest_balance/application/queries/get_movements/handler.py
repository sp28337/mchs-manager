"""RB008 — журнал движений сотрудника с пагинацией.

Новые сверху: журнал открывают, чтобы посмотреть последнее движение, а не
первое за всю службу.

Сторно отдаётся наравне с обычными движениями и НЕ сворачивается с
исправляемым: инвариант 8.1.3 требует полной трассируемости для служебной
проверки, а свёрнутая пара скрыла бы, что ошибка была.
"""

from __future__ import annotations

from dataclasses import dataclass

from src.modules.rest_balance.application.ports import MovementJournalPort
from src.modules.rest_balance.application.queries.get_movements.query import GetMovementsQuery
from src.modules.rest_balance.domain.balance import BalanceMovement


@dataclass(frozen=True, kw_only=True)
class MovementsPage:
    items: list[BalanceMovement]
    page: int
    page_size: int
    total_count: int


class GetMovementsHandler:
    def __init__(self, journal: MovementJournalPort) -> None:
        self._journal = journal

    async def handle(self, query: GetMovementsQuery) -> MovementsPage:
        items, total = await self._journal.page(
            employee_id=query.employee_id,
            period_start=query.period_start,
            period_end=query.period_end,
            page=query.page,
            page_size=query.page_size,
        )
        return MovementsPage(
            items=items,
            page=query.page,
            page_size=query.page_size,
            total_count=total,
        )
