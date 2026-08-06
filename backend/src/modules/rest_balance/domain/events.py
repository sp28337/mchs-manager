"""Доменные события RestBalance.

Таблица Domain Model разд. 11 этих событий не называет, и это осознанно:
у баланса ДДО за пределами модуля пока нет подписчика — `leave_management`
(фаза 10) будет спрашивать остаток запросом, а не слушать поток, потому
что решение о предоставлении отгула принимается в момент рапорта, а не по
факту чужого начисления.

События заведены всё равно, и по одной причине: движение баланса — то,
что сотруднику причитается, и `balance_after` в каждом из них делает
журнал самодостаточным для служебной проверки. Восстанавливать остаток на
дату пересчётом всей истории при разборе жалобы означало бы доверять
пересчёту больше, чем записи.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID

from src.building_blocks.domain.domain_event import DomainEvent


@dataclass(frozen=True, kw_only=True)
class RestDaysAccrued(DomainEvent):
    """Сутки отдыха начислены по строке компенсации (Алгоритм Л).

    `legal_basis_rule_version_id` переносится из события компенсации:
    инвариант 8.1.2 требует, чтобы начисление было объяснимо ссылкой на
    норму, и объяснение это обязано ехать вместе с фактом, а не
    добываться потом обратным запросом.
    """

    employee_id: UUID
    movement_id: UUID
    amount_days: Decimal
    movement_date: date
    compensation_line_id: UUID
    legal_basis_rule_version_id: UUID | None = None
    balance_after: Decimal


@dataclass(frozen=True, kw_only=True)
class RestDaysConsumed(DomainEvent):
    employee_id: UUID
    movement_id: UUID
    amount_days: Decimal
    movement_date: date
    leave_grant_id: UUID | None = None
    balance_after: Decimal


@dataclass(frozen=True, kw_only=True)
class RestDaysMovementReversed(DomainEvent):
    """Движение сторнировано симметричной обратной записью (8.1.3).

    Несёт и сторнирующее движение, и сторнируемое: без второго событие
    сообщало бы «остаток изменился», не говоря, какая именно запись
    признана ошибочной, — а для служебной проверки существенно именно это.
    """

    employee_id: UUID
    movement_id: UUID
    reversed_movement_id: UUID
    amount_days: Decimal
    reason: str
    balance_after: Decimal
