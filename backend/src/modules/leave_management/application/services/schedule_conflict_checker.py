"""LM014 — инвариант 9.1.4: отпуск и утверждённая смена несовместимы.

    «`LeaveGrant` не может быть создан с `LeavePeriod`, пересекающимся с
    уже утверждённой `PlannedShift` того же сотрудника в `Scheduling` без
    предварительной отмены/переноса этой смены (согласованность между
    контекстами обеспечивается доменным сервисом, а не прямой ссылкой
    между агрегатами разных контекстов)».

Отдельный сервис, а не условие внутри `LeaveEligibilityService`, по
причине, названной в самом инварианте: это единственная проверка,
пересекающая границу bounded context. Смешать её с проверками по
собственной истории отпусков значило бы спрятать межконтекстную
зависимость среди внутренних — и первый же, кто станет менять правила
отпусков, не заметил бы, что трогает связь с `scheduling`.

--- Что значит «утверждённая» -----------------------------------------

Только утверждённый график: смена из черновика — намерение, а не
обязательство, и запрещать по ней отпуск значило бы дать планировщику
власть, которой у него нет. Отбор по `schedule_status` делает адаптер
(`infrastructure/anticorruption`), потому что значение статуса
принадлежит `scheduling`.

--- Почему отказ, а не автоматическая отмена смены --------------------

Инвариант говорит «без предварительной отмены/переноса». Отменять смену
за командира — решение о боевом расчёте, принятое системой учёта
отпусков. Отказ с указанием конфликтующей смены (DoD LM015) оставляет
решение тому, кто вправе его принять.
"""

from __future__ import annotations

from uuid import UUID

from src.modules.leave_management.application.ports import ApprovedShiftPort
from src.modules.leave_management.domain.errors import ScheduleConflictError
from src.modules.leave_management.domain.value_objects import LeavePeriod


class ScheduleConflictChecker:
    def __init__(self, shifts: ApprovedShiftPort) -> None:
        self._shifts = shifts

    async def ensure_free(self, *, employee_id: UUID, period: LeavePeriod) -> None:
        shifts = await self._shifts.approved_shifts(
            employee_id=employee_id, period_start=period.start, period_end=period.end
        )
        if not shifts:
            return

        shift_id, starts, ends = shifts[0]
        raise ScheduleConflictError(
            f"на [{period.start}, {period.end}) у сотрудника {employee_id} есть "
            f"утверждённая смена {shift_id} ({starts} - {ends}): отпуск на эти даты "
            f"невозможен без отмены или переноса смены (Domain Model "
            f"инвариант 9.1.4)"
        )
