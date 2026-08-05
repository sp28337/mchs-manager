"""Доменные события Time Accounting (Domain Model разд. 11).

TA004. Пять событий таблицы разд. 11, источник которых — `Timesheet`.

Заметно, что событий меньше, чем типов факта: `SuspensionRegistered` и
`BusinessTripRegistered` в таблице разд. 11 отсутствуют, хотя
соответствующие записи в агрегате есть. Это не пропуск — таблица
перечисляет «значимые с точки зрения бизнеса факты», а значимость здесь
определяется наличием последствия за границей модуля: болезнь меняет
недоработку (инвариант 6.1.3), привлечение сверх нормы порождает
компенсацию (Алгоритм К), а отстранение и командировка внутри расчёта
ничего не запускают. Заводить событие впрок значит объявить контракт,
который никто не обязан поддерживать.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from uuid import UUID

from src.building_blocks.domain.domain_event import DomainEvent


@dataclass(frozen=True, kw_only=True)
class ShiftActuallyPerformed(DomainEvent):
    """«Смена подтверждена фактом» (Domain Model разд. 11).

    `planned_shift_id` необязателен: внеплановый вызов — это факт без
    плановой смены, и именно поэтому Domain Model 6.1 делает ссылку
    опциональной."""

    timesheet_id: UUID
    employee_id: UUID
    event_id_of_record: UUID
    start_time: datetime
    end_time: datetime
    planned_shift_id: UUID | None


@dataclass(frozen=True, kw_only=True)
class SicknessRegistered(DomainEvent):
    """«Зарегистрирован факт временной нетрудоспособности».

    Потребитель — расчёт недоработки: инвариант 6.1.3 требует исключить
    эти периоды из вменяемой сотруднику недоработки."""

    timesheet_id: UUID
    employee_id: UUID
    event_id_of_record: UUID
    start_time: datetime
    end_time: datetime


@dataclass(frozen=True, kw_only=True)
class OvertimeAttracted(DomainEvent):
    """«Зафиксировано привлечение сверх нормы на основании приказа».

    `overtime_order_id` не `| None` — в отличие от плановой смены, здесь
    отсутствие приказа непредставимо (инвариант 6.1.2), и тип обязан это
    показывать так же, как `ck_overtime_requires_order` в БД."""

    timesheet_id: UUID
    employee_id: UUID
    event_id_of_record: UUID
    start_time: datetime
    end_time: datetime
    overtime_order_id: UUID


@dataclass(frozen=True, kw_only=True)
class TimesheetApproved(DomainEvent):
    """«Период закрыт, HoursBreakdown зафиксирован окончательно».

    Ключевое событие всей системы: на него подписаны построитель
    read-проекции (TA027) и модуль Compensation (фаза 8). Несёт период, а
    не сам расчёт: получатель обязан прочитать проекцию, иначе два
    источника одних и тех же чисел неизбежно разойдутся."""

    timesheet_id: UUID
    employee_id: UUID
    period_start: date
    period_end: date


@dataclass(frozen=True, kw_only=True)
class TimesheetReopened(DomainEvent):
    """«Утверждённый табель открыт повторно для исправления».

    Причина — часть события, а не служебная пометка: переоткрытие
    утверждённого документа обязано быть объяснено (инвариант 6.1.4), и
    подписчик, отменяющий уже начисленную компенсацию, должен получить
    основание вместе с фактом."""

    timesheet_id: UUID
    employee_id: UUID
    reason: str
