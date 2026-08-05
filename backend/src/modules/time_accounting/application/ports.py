"""Порты Application-слоя `time_accounting`.

Та же инверсия, что и в остальных модулях: `.importlinter` запрещает
`application -> infrastructure`, поэтому обработчики зависят от Protocol,
а конкретные реализации подставляет вызывающий.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from src.building_blocks.domain.time_interval import TimeInterval
from src.modules.time_accounting.domain.overtime_order import OvertimeOrder
from src.modules.time_accounting.domain.timesheet import Timesheet
from src.modules.time_accounting.domain.value_objects import HoursBreakdown


class EmployeeCalculationContext(BaseModel):
    """Снимок сотрудника в том виде, в каком его читает расчёт.

    Отдельный тип, а не `personnel.EmployeeSnapshot`: тот принадлежит
    чужому модулю и несёт лишнее (ФИО, табельный номер), а зависеть от
    чужого DTO в сигнатуре порта значило бы протащить его форму во все
    обработчики. Порт описывает ФОРМУ ВОПРОСА, и она наша.
    """

    model_config = ConfigDict(frozen=True)

    employee_id: UUID
    unit_id: UUID
    legal_base: str
    service_condition_category: str
    regime_type: str
    time_zone: str
    hired_at: date
    dismissed_at: date | None


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


class EmployeeCalculationContextPort(Protocol):
    """Всё, что расчёт обязан узнать о сотруднике у `personnel`, одним
    вопросом.

    Один порт, а не три (`legal_base`, `regime_type`, `time_zone`), потому
    что контракт `get_employee_snapshot` и так отдаёт снимок целиком: три
    порта означали бы три обращения за одной и той же строкой.

    Все три — измерения ОДНОГО расчёта, и все три обязаны попасть в его
    провенанс (Алгоритм Б шаг 10, Алгоритм А шаг 4): `legal_base` и
    `service_condition_category` образуют `scope` поиска `RuleVersion`,
    `regime_type` нужен Алгоритму Е, а `time_zone` — Алгоритмам Г-Е,
    переводящим моменты в календарные даты.
    """

    async def context_of(self, employee_id: UUID) -> EmployeeCalculationContext | None: ...


class NormRulePort(Protocol):
    """Недельная норма из `RuleVersion` категории `norm_calculation`
    вместе с идентификатором версии (Алгоритм Б шаги 3-4, 10).

    Возвращает пару, а не одно число: провенанс не «дополнительно
    полезен», а обязателен — норма без ссылки на версию правила
    непересчитываема (инвариант 6.1.5).
    """

    async def weekly_norm_hours(
        self, *, as_of: date, scope: dict[str, str]
    ) -> tuple[Decimal, UUID]: ...


class ProductionCalendarPort(Protocol):
    """Два разных вопроса к производственному календарю, потому что их
    задают разные алгоритмы: Алгоритму Б нужны СЧЁТЧИКИ по типам дней, а
    Алгоритмам Д/Е — тип КАЖДОГО дня. Отдавать первому список из 365
    записей ради двух чисел было бы расточительно, второму счётчики —
    бесполезно."""

    async def count_days_by_type(
        self, *, period_start: date, period_end: date
    ) -> dict[str, int]: ...

    async def day_types(
        self, *, period_start: date, period_end: date
    ) -> dict[date, str]: ...


class ConflictPolicyPort(Protocol):
    """Порядок приоритетов категорий на дату (Алгоритм Ж шаг 3) вместе с
    версией политики (шаг 6)."""

    async def precedence_list(self, *, as_of: date) -> tuple[list[str], UUID]: ...


class PlannedShiftsPort(Protocol):
    """Плановые смены сотрудника за период — контракт SD015 модуля
    `scheduling`.

    Нужны ровно одному шагу: Алгоритм В шаг 6 засчитывает как объяснённое
    отсутствие только ту часть болезни, которая пересекается с плановой
    сменой.
    """

    async def planned_intervals(
        self, *, employee_id: UUID, period_start: date, period_end: date
    ) -> list[TimeInterval]: ...


class HoursBreakdownProjectionPort(Protocol):
    """Запись read-проекции (TA027)."""

    async def upsert(
        self,
        *,
        timesheet_id: UUID,
        employee_id: UUID,
        period_start: date,
        period_end: date,
        breakdown: HoursBreakdown,
        time_zone: str,
    ) -> None: ...
