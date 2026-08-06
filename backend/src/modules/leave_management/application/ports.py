"""Порты, от которых зависит Application-слой LeaveManagement."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Protocol
from uuid import UUID

from src.modules.leave_management.domain.leave_grant import LeaveGrant
from src.modules.leave_management.domain.value_objects import LeavePeriod, LeaveType


class LeaveGrantRepositoryPort(Protocol):
    async def get(self, grant_id: UUID) -> LeaveGrant | None: ...
    async def list_for_employee(self, employee_id: UUID) -> list[LeaveGrant]: ...
    async def overlapping(
        self, *, employee_id: UUID, period: LeavePeriod
    ) -> list[LeaveGrant]: ...
    async def has_once_per_service_grant(
        self, *, employee_id: UUID, leave_type: LeaveType
    ) -> bool: ...
    def add(self, grant: LeaveGrant) -> None: ...


class ApprovedShiftPort(Protocol):
    """Утверждённые плановые смены сотрудника за период — инвариант 9.1.4.

    Возвращает описания, а не агрегаты `scheduling`: между контекстами
    ходит проекция (Architecture разд. 4.2 п.3). Кортеж, а не собственный
    DTO, потому что нужны ровно две вещи — когда смена и как назвать её в
    отказе.
    """

    async def approved_shifts(
        self, *, employee_id: UUID, period_start: date, period_end: date
    ) -> list[tuple[UUID, date, date]]: ...


class SeniorityPort(Protocol):
    """Выслуга сотрудника в полных годах на дату.

    ФЗ-141 ст. 58 ч. 3 ставит продолжительность основного отпуска в
    зависимость от стажа службы, поэтому расчёт права без неё невозможен.
    """

    async def seniority_years(self, *, employee_id: UUID, as_of: date) -> int | None: ...


class LeaveEntitlementRulePort(Protocol):
    """Действующая на дату версия правила категории `leave_entitlement`.

    Отдаёт идентификатор версии и число дней: обоснование и величина
    приходят вместе, потому что порознь не значат ничего.
    """

    async def entitled_days(
        self, *, leave_type: LeaveType, seniority_years: int | None, as_of: date
    ) -> tuple[UUID, int]: ...


class RestBalanceConsumptionPort(Protocol):
    """LM009 — списание ДДО при присоединении к отпуску (Приказ № 410
    п. 12).

    Возвращает идентификатор движения: он же попадёт в провенанс приказа,
    а без него «присоединено три дня» осталось бы утверждением, которое
    нечем проверить.
    """

    async def consume(
        self,
        *,
        employee_id: UUID,
        days: Decimal,
        movement_date: date,
        leave_grant_id: UUID,
    ) -> UUID: ...
