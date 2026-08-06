"""Порты, от которых зависит Application-слой RestBalance.

Тот же приём, что в `legal_rules` и `compensation`: обработчик не
импортирует конкретный репозиторий из `infrastructure` — направление
зависимости обратное (Architecture разд. 3, 7), и контракт
`layers-rest-balance` это проверяет.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Protocol
from uuid import UUID

from src.modules.rest_balance.domain.balance import BalanceMovement, RestDaysBalance


class RestDaysBalanceRepositoryPort(Protocol):
    async def get(self, employee_id: UUID) -> RestDaysBalance: ...
    async def get_movement(self, movement_id: UUID) -> BalanceMovement | None: ...
    def save(self, balance: RestDaysBalance) -> None: ...


class CurrentBalanceReaderPort(Protocol):
    """Материализованный остаток «на сейчас».

    Отдельный порт, а не метод репозитория: репозиторий отдаёт агрегат
    для изменения и обязан считать по журналу, а это — быстрый ответ на
    вопрос экрана. Смешать их значило бы дать обработчику команды способ
    проверить инвариант по отставшему числу.

    `None` означает «движений нет», а не «сотрудник неизвестен»: второго
    этот модуль не знает и знать не должен.
    """

    async def balance_days(self, employee_id: UUID) -> Decimal | None: ...


class MovementJournalPort(Protocol):
    """Постраничное чтение журнала (RB008)."""

    async def page(
        self,
        *,
        employee_id: UUID,
        period_start: date | None,
        period_end: date | None,
        page: int,
        page_size: int,
    ) -> tuple[list[BalanceMovement], int]: ...
