"""LM010 — DTO эндпоинтов `/leave` (`openapi.yaml`).

Отступления от спецификации — ADDITIVE, каждое названо.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.modules.leave_management.domain.value_objects import LeaveStatus, LeaveType


class CreateLeaveGrantRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    employee_id: UUID = Field(alias="employeeId")
    leave_type: LeaveType = Field(alias="leaveType")
    period_start: date = Field(alias="periodStart")
    # Граница ИСКЛЮЧАЮЩАЯ: отпуск по 20 марта включительно — это
    # `periodEnd = 2026-03-21`. Так во всей кодовой базе и в `daterange`
    # таблицы; иначе присоединение смежных отпусков (Приказ № 410 п. 12)
    # считалось бы пересечением.
    period_end: date = Field(alias="periodEnd")
    # ADDITIVE: сутки ДДО, присоединяемые к отпуску (Приказ № 410 п. 12).
    # Спецификация такого поля не знает, а операция предусмотрена
    # приказом и уже обеспечена ссылкой `leave_grant_id` в движении
    # баланса.
    attached_rest_days: Decimal = Field(default=Decimal(0), alias="attachedRestDays", ge=0)


class LeaveGrantResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    employee_id: UUID = Field(alias="employeeId")
    leave_type: LeaveType = Field(alias="leaveType")
    period_start: date = Field(alias="periodStart")
    period_end: date = Field(alias="periodEnd")
    status: LeaveStatus
    entitlement_basis_rule_version_id: UUID = Field(alias="entitlementBasisRuleVersionId")
    # ADDITIVE: продолжительность, на которую было право, и стаж, из
    # которого она выведена. Без них карточка отпуска не объясняет, почему
    # дней именно столько.
    entitled_days: int = Field(alias="entitledDays")
    seniority_years: int | None = Field(default=None, alias="seniorityYears")
    attached_rest_days: Decimal = Field(alias="attachedRestDays")
    # ADDITIVE и главное: инвариант 9.1.3 запрещает «тихое» аннулирование
    # неиспользованных дней. Остаток, невидимый в карточке, — ровно то
    # молчание, которое инвариант и запрещает.
    used_days: int = Field(alias="usedDays")
    unused_days: int = Field(alias="unusedDays")


class RecallFromLeaveRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    recall_date: date = Field(alias="recallDate")
    effective_from: date = Field(alias="effectiveFrom")


class RecallEventResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    leave_grant_id: UUID = Field(alias="leaveGrantId")
    recall_date: date = Field(alias="recallDate")
    effective_from: date = Field(alias="effectiveFrom")
    # ADDITIVE: DoD LM007 — «остаток дней после отзыва явно зафиксирован».
    # Ответ на отзыв, не называющий остаток, оставлял бы кадровику считать
    # его самому.
    used_days: int = Field(alias="usedDays")
    unused_days: int = Field(alias="unusedDays")
