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
from decimal import Decimal
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


class HoursBreakdownResponse(BaseModel):
    """Зеркало openapi `HoursBreakdown`.

    Четыре поля сверх спецификации — `weekendHours`,
    `underworkedExplainedHours`, `usedConflictPolicyVersionId` и
    `computedInTimeZone`. Все четыре ADDITIVE (разрешено политикой
    API_Conventions разд. 1) и все четыре не украшения:

    * без `weekendHours` пропадает результат целого Алгоритма Е;
    * без разбивки недоработки нельзя отличить пропуск по болезни от
      пропуска без причины (инвариант 6.1.3), а это разные правовые
      последствия;
    * два поля провенанса отвечают на вопрос «по каким правилам это
      посчитано», без которого пересчёт задним числом не проверить
      (инвариант 6.1.5).
    """

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    timesheet_id: UUID = Field(alias="timesheetId")
    employee_id: UUID = Field(alias="employeeId")
    period_start: date = Field(alias="periodStart")
    period_end: date = Field(alias="periodEnd")
    norm_hours: Decimal = Field(alias="normHours")
    actual_hours: Decimal = Field(alias="actualHours")
    night_hours: Decimal = Field(alias="nightHours")
    holiday_hours: Decimal = Field(alias="holidayHours")
    weekend_hours: Decimal = Field(alias="weekendHours")
    overtime_hours: Decimal = Field(alias="overtimeHours")
    underworked_hours: Decimal = Field(alias="underworkedHours")
    underworked_explained_hours: Decimal = Field(alias="underworkedExplainedHours")
    computed_from_rule_version_id: UUID = Field(alias="computedFromRuleVersionId")
    used_conflict_policy_version_id: UUID | None = Field(
        default=None, alias="usedConflictPolicyVersionId"
    )
    computed_from_legal_base: str = Field(alias="computedFromLegalBase")
    computed_in_time_zone: str = Field(alias="computedInTimeZone")
    computed_at: datetime = Field(alias="computedAt")


class UnitTimesheetDashboardResponse(BaseModel):
    """Зеркало openapi `UnitTimesheetDashboard`."""

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    unit_id: UUID = Field(alias="unitId")
    period_start: date = Field(alias="periodStart")
    period_end: date = Field(alias="periodEnd")
    total_employees: int = Field(alias="totalEmployees")
    total_overtime_hours: Decimal = Field(alias="totalOvertimeHours")
    total_underworked_hours: Decimal = Field(alias="totalUnderworkedHours")
    pending_approval_count: int = Field(alias="pendingApprovalCount")
