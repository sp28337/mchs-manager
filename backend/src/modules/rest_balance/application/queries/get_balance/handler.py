"""RB007 — остаток ДДО сотрудника.

Два пути, и выбирает между ними не оптимизация, а вопрос.

Без даты — материализованное представление: экрану нужен остаток
«сейчас», и загружать ради этого весь журнал службы значило бы платить за
точность, которой у показанного числа всё равно нет (пока страница
рисуется, движение может появиться).

С датой — журнал: «сколько было на 1 марта» спрашивают при разборе
жалобы, и ответ обязан быть выведен из записей, а не из числа,
пересчитанного неизвестно когда.

--- DoD «сотрудник видит только свой остаток» --------------------------

Это правило доступа, а не запроса: обработчик отдаёт остаток того, о ком
спросили. Кто вправе спрашивать — решает авторизация на эндпоинте
(`API_Conventions` разд. 2), и дублировать её здесь значило бы иметь два
ответа на вопрос о правах, которые однажды разойдутся.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID

from src.modules.rest_balance.application.ports import (
    CurrentBalanceReaderPort,
    RestDaysBalanceRepositoryPort,
)
from src.modules.rest_balance.application.queries.get_balance.query import GetBalanceQuery


@dataclass(frozen=True, kw_only=True)
class BalanceView:
    employee_id: UUID
    balance_days: Decimal
    as_of: date | None
    # Из журнала (точно на дату) или из представления (быстро, но с
    # отставанием). Потребитель вправе знать, что именно ему показали.
    computed_from_journal: bool


class GetBalanceHandler:
    def __init__(
        self, repo: RestDaysBalanceRepositoryPort, current: CurrentBalanceReaderPort
    ) -> None:
        self._repo = repo
        self._current = current

    async def handle(self, query: GetBalanceQuery) -> BalanceView:
        if query.as_of is not None:
            balance = await self._repo.get(query.employee_id)
            return BalanceView(
                employee_id=query.employee_id,
                balance_days=balance.balance_as_of(query.as_of),
                as_of=query.as_of,
                computed_from_journal=True,
            )

        days = await self._current.balance_days(query.employee_id)

        # `None` — значит ни одного движения. Ноль, а не 404: «у
        # сотрудника нет накопленных суток» и «сотрудника нет» — разные
        # ответы, и второй здесь неверен.
        return BalanceView(
            employee_id=query.employee_id,
            balance_days=days if days is not None else Decimal(0),
            as_of=None,
            computed_from_journal=False,
        )
