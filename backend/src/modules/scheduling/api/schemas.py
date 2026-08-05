"""SD011 — схемы API, зеркало Scheduling-DTO из `openapi.yaml`.

Одно ADDITIVE-отклонение, названное явно: `DutyScheduleResponse` несёт
`revisionNo`, `previousScheduleId` и `revisionReason`, которых в
`openapi.yaml` нет. Без них ответ на `POST .../revise` («Новая версия
графика создана») не позволяет отличить новую версию от исходной и не
показывает, чем она обоснована, — то есть не отвечает на вопрос, ради
которого операция существует.

Разрешено политикой изменений API_Conventions разд. 1: «Добавление
необязательного поля в ответ» новой версии не требует. Эталонный
`openapi.yaml` стоит дополнить при следующей ревизии.
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.modules.scheduling.domain.value_objects import (
    AccountingPeriodType,
    DutyType,
    ScheduleStatus,
)


class CreateDutyScheduleRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    unit_id: UUID = Field(alias="unitId")
    period_type: AccountingPeriodType = Field(alias="periodType")
    period_start: date = Field(alias="periodStart")
    period_end: date = Field(alias="periodEnd")


class PlannedShiftResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    duty_schedule_id: UUID = Field(alias="dutyScheduleId")
    employee_id: UUID = Field(alias="employeeId")
    start_time: datetime = Field(alias="startTime")
    end_time: datetime = Field(alias="endTime")
    duty_type: DutyType = Field(alias="dutyType")


class DutyScheduleResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    unit_id: UUID = Field(alias="unitId")
    period_type: AccountingPeriodType = Field(alias="periodType")
    period_start: date = Field(alias="periodStart")
    period_end: date = Field(alias="periodEnd")
    status: ScheduleStatus
    approval_order_ref: str | None = Field(default=None, alias="approvalOrderRef")
    # Additive — см. докстринг модуля.
    revision_no: int = Field(alias="revisionNo")
    previous_schedule_id: UUID | None = Field(default=None, alias="previousScheduleId")
    revision_reason: str | None = Field(default=None, alias="revisionReason")
    shifts: list[PlannedShiftResponse] = Field(default_factory=list)


class CreatePlannedShiftRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    employee_id: UUID = Field(alias="employeeId")
    start_time: datetime = Field(alias="startTime")
    # openapi: «Должно быть строго позже startTime (бизнес-инвариант,
    # проверяется на 422, не в JSON Schema)» — это и делает
    # `TimeInterval.__post_init__`.
    end_time: datetime = Field(alias="endTime")
    duty_type: DutyType = Field(alias="dutyType")


class ApproveScheduleRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    approval_order_ref: str = Field(alias="approvalOrderRef", min_length=1, max_length=100)


class ReviseScheduleRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    reason: str = Field(min_length=1, max_length=1000)
