"""TA032 — схемы командной стороны API, зеркало TimeAccounting-DTO из
`openapi.yaml`.

`issuedBy` и `createdBy` в запросах отсутствуют, хотя в ответах они есть,
и так же — в `openapi.yaml`. Это «кто совершил действие»: брать его из
тела запроса значило бы позволить клиенту назвать себя кем угодно.
Значение обязано приходить из удостоверения (JWT `sub`, API_Conventions
разд. 2); пока зависимости аутентификации нет, роутер ставит заглушку с
`TODO(auth)` — ровно так же, как `legal_rules` для `publishedBy`.
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.modules.time_accounting.domain.value_objects import (
    AccountingPeriodType,
    ServiceTimeEventType,
    TimesheetStatus,
)


class CreateTimesheetRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    employee_id: UUID = Field(alias="employeeId")
    period_type: AccountingPeriodType = Field(alias="periodType")
    period_start: date = Field(alias="periodStart")
    period_end: date = Field(alias="periodEnd")


class ServiceTimeEventResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    timesheet_id: UUID = Field(alias="timesheetId")
    event_type: ServiceTimeEventType = Field(alias="eventType")
    start_time: datetime = Field(alias="startTime")
    end_time: datetime = Field(alias="endTime")
    planned_shift_id: UUID | None = Field(default=None, alias="plannedShiftId")
    overtime_order_id: UUID | None = Field(default=None, alias="overtimeOrderId")
    business_trip_place: str | None = Field(default=None, alias="businessTripPlace")


class TimesheetResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    employee_id: UUID = Field(alias="employeeId")
    period_type: AccountingPeriodType = Field(alias="periodType")
    period_start: date = Field(alias="periodStart")
    period_end: date = Field(alias="periodEnd")
    status: TimesheetStatus
    # Additive относительно openapi `Timesheet` (разрешено политикой
    # изменений API_Conventions разд. 1: добавление необязательного поля в
    # ответ новой версии не требует). Без состава фактов ответ на
    # `GET /timesheets/{id}` — «Табель (Write-модель, для табельщика)» —
    # не показывает того единственного, ради чего write-модель читают:
    # что в табеле уже зарегистрировано.
    events: list[ServiceTimeEventResponse] = Field(default_factory=list)


class CreateServiceTimeEventRequest(BaseModel):
    """Зеркало `ServiceTimeEventRequest` с `discriminator: eventType`.

    Дискриминатор здесь — поле, а не пять подтипов Pydantic: openapi
    объявляет `discriminator` при ЕДИНСТВЕННОЙ схеме, без `oneOf`, то
    есть описывает одну форму с типом внутри. Правила «какие поля
    обязательны при каком типе» проверяет домен
    (`ServiceTimeEvent.__post_init__`) и отдаёт 422 — ровно так, как
    openapi и описывает: «Обязателен, если eventType = overtime_attraction
    (проверяется на 422)». Перенести их сюда значило бы получить 400 от
    Pydantic вместо предусмотренного контрактом 422.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    event_type: ServiceTimeEventType = Field(alias="eventType")
    start_time: datetime = Field(alias="startTime")
    end_time: datetime = Field(alias="endTime")
    planned_shift_id: UUID | None = Field(default=None, alias="plannedShiftId")
    overtime_order_id: UUID | None = Field(default=None, alias="overtimeOrderId")
    business_trip_place: str | None = Field(
        default=None, alias="businessTripPlace", max_length=300
    )


class CreateCorrectionEntryRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    original_event_id: UUID = Field(alias="originalEventId")
    reason: str = Field(min_length=10, max_length=2000)


class CorrectionEntryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    timesheet_id: UUID = Field(alias="timesheetId")
    original_event_id: UUID = Field(alias="originalEventId")
    reason: str
    created_at: datetime = Field(alias="createdAt")
    created_by: UUID = Field(alias="createdBy")


class ReopenTimesheetRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    reason: str = Field(min_length=10, max_length=2000)


class CreateOvertimeOrderRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    order_number: str = Field(alias="orderNumber", max_length=50)
    issued_date: date = Field(alias="issuedDate")
    reason: str = Field(max_length=1000)


class OvertimeOrderResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    order_number: str = Field(alias="orderNumber")
    issued_date: date = Field(alias="issuedDate")
    issued_by: UUID = Field(alias="issuedBy")
    reason: str
