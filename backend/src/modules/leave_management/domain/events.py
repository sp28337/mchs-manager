"""Доменные события LeaveManagement.

`LeaveGrantRecalled` таблица Domain Model разд. 11 называет прямо.
`LeaveGrantCreated` — нет, но у него есть названный потребитель за
границей модуля: `scheduling` обязан узнать, что на эти даты сотрудника
планировать нельзя (инвариант 9.1.4 с обратной стороны — сегодня он
проверяется только в момент выдачи отпуска, а смену могут поставить
позже).

Подписчика у него пока не существует, и это названо честно: событие
публикуется, потому что факт значим вовне, а не потому, что кто-то уже
слушает. Обратный порядок — «заведём событие, когда понадобится» —
означал бы, что первый же потребитель не найдёт истории.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID

from src.building_blocks.domain.domain_event import DomainEvent
from src.modules.leave_management.domain.value_objects import LeaveType


@dataclass(frozen=True, kw_only=True)
class LeaveGrantCreated(DomainEvent):
    grant_id: UUID
    employee_id: UUID
    leave_type: LeaveType
    period_start: date
    period_end: date
    entitlement_basis_rule_version_id: UUID
    attached_rest_days: Decimal


@dataclass(frozen=True, kw_only=True)
class LeaveGrantRecalled(DomainEvent):
    """Отзыв из отпуска (ФЗ-141 ст. 65).

    Несёт `unused_days` не для удобства: инвариант 9.1.3 запрещает
    «тихое» аннулирование неиспользованных дней, и число, уехавшее вместе
    с событием, — то, по чему кадровая служба заведёт остаток. Событие,
    сообщающее только «отпуск прерван», оставило бы этот вопрос
    получателю, а считать он стал бы по своей копии периода.
    """

    grant_id: UUID
    employee_id: UUID
    recall_event_id: UUID
    recall_date: date
    effective_from: date
    used_days: int
    unused_days: int
