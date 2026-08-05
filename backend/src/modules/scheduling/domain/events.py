"""Доменные события Scheduling (Domain Model разд. 11)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from uuid import UUID

from src.building_blocks.domain.domain_event import DomainEvent


@dataclass(frozen=True, kw_only=True)
class ScheduleApproved(DomainEvent):
    """«График зафиксирован, дальнейшие изменения требуют пересмотра»
    (Domain Model разд. 11).

    Будущий потребитель конкретен: `TimeAccounting` открывает табели
    периода по утверждённому графику, а `ActualShiftRecord` ссылается на
    `PlannedShift`. Пока подписчика нет — событие ложится в outbox, как и
    все остальные."""

    duty_schedule_id: UUID
    unit_id: UUID
    period_start: date
    period_end: date
    approval_order_ref: str


@dataclass(frozen=True, kw_only=True)
class ScheduleRevised(DomainEvent):
    """Утверждённый график пересмотрен: породил новую версию и закрыт сам.

    Потребитель тот же, что у `ScheduleApproved`, и причина та же: смены,
    на которые ссылались уже зарегистрированные факты
    (`ActualShiftRecord.plannedShiftId`), в новой версии имеют другие
    идентификаторы. Узнать об этом `TimeAccounting` может только из
    события."""

    duty_schedule_id: UUID
    successor_schedule_id: UUID
    unit_id: UUID
    revision_no: int
    reason: str
