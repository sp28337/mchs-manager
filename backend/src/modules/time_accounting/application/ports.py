"""Порты Application-слоя `time_accounting`.

Та же инверсия, что и в остальных модулях: `.importlinter` запрещает
`application -> infrastructure`, поэтому обработчики зависят от Protocol,
а конкретные реализации подставляет вызывающий.
"""

from __future__ import annotations

from datetime import date
from typing import Protocol
from uuid import UUID

from src.building_blocks.domain.time_interval import TimeInterval
from src.modules.time_accounting.domain.overtime_order import OvertimeOrder
from src.modules.time_accounting.domain.timesheet import Timesheet


class TimesheetRepositoryPort(Protocol):
    async def get(self, timesheet_id: UUID) -> Timesheet | None: ...
    async def get_for_period(
        self, *, employee_id: UUID, period_start: date, period_end: date
    ) -> Timesheet | None: ...
    async def actual_shift_intervals_of(self, employee_id: UUID) -> list[TimeInterval]: ...
    def add(self, timesheet: Timesheet) -> None: ...


class OvertimeOrderRepositoryPort(Protocol):
    async def get(self, order_id: UUID) -> OvertimeOrder | None: ...
    async def exists_with_number(self, order_number: str) -> bool: ...
    def add(self, order: OvertimeOrder) -> None: ...


class EmployeeExistencePort(Protocol):
    """Межмодульный факт: сотрудник, на которого открывают табель,
    существует.

    Межсхемных FK нет (PostgreSQL_Logical_Model разд. 10), и разд. 10 сам
    относит эту проверку на Application-слой — «soft-проверка
    существования `employee_id` перед вставкой». Без неё опечатка в
    идентификаторе создала бы табель, который никогда никому не
    принадлежит и при этом занимает пару «сотрудник + период».

    Статус здесь НЕ проверяется, в отличие от `scheduling`: табель
    уволенного сотрудника за прошлый период открыть можно и нужно —
    служебное время за отработанный период считается независимо от того,
    служит ли человек сегодня (инвариант 6.1.5 требует возможности
    пересчитать любой прошлый период).
    """

    async def exists(self, employee_id: UUID) -> bool: ...
