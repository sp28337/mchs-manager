"""Формы запросов и ответов `shift_accounting`."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.modules.shift_accounting.domain.value_objects import (
    AbsenceKind,
    EmploymentKind,
    Gender,
    WorkingConditions,
)


class CreateProfileRequest(BaseModel):
    """Всё, что нужно, чтобы построить график и вывести норму.

    Ни фамилии в паспортном смысле, ни табельного номера, ни
    подразделения: инструмент личный, и данных, не нужных для расчёта, он
    не собирает. `displayName` — то, как человек хочет, чтобы к нему
    обращались, а не удостоверение личности.
    """

    model_config = ConfigDict(frozen=True, extra="forbid", populate_by_name=True)

    display_name: str = Field(alias="displayName", min_length=1, max_length=200)
    employment_kind: EmploymentKind = Field(alias="employmentKind")
    gender: Gender
    working_conditions: WorkingConditions = Field(
        default=WorkingConditions.NORMAL, alias="workingConditions"
    )
    rural_locality: bool = Field(default=False, alias="ruralLocality")
    guard_number: int = Field(alias="guardNumber", ge=1, le=4)
    first_shift_date: date = Field(alias="firstShiftDate")


class ProfileResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    display_name: str = Field(alias="displayName")
    employment_kind: EmploymentKind = Field(alias="employmentKind")
    gender: Gender
    working_conditions: WorkingConditions = Field(alias="workingConditions")
    rural_locality: bool = Field(alias="ruralLocality")
    guard_number: int = Field(alias="guardNumber")
    first_shift_date: date = Field(alias="firstShiftDate")
    accounting_year: int = Field(alias="accountingYear")
    weekly_norm_hours: Decimal = Field(alias="weeklyNormHours")
    weekly_norm_basis: str = Field(alias="weeklyNormBasis")


class CreateAbsenceRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", populate_by_name=True)

    kind: AbsenceKind
    starts_on: date = Field(alias="startsOn")
    ends_on: date = Field(alias="endsOn")
    note: str | None = Field(default=None, max_length=500)


class AbsenceResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    kind: AbsenceKind
    starts_on: date = Field(alias="startsOn")
    ends_on: date = Field(alias="endsOn")
    note: str | None = None
    basis: str
    """Норма, по которой это отсутствие исключается из нормы периода."""


class ShiftResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    started_on: date = Field(alias="startedOn")
    hours: Decimal
    night_hours: Decimal = Field(alias="nightHours")
    holiday_hours: Decimal = Field(alias="holidayHours")
    absence_kind: AbsenceKind | None = Field(default=None, alias="absenceKind")


class CalculationResponse(BaseModel):
    """Расчёт периода.

    Норма, исключённые часы и факт показаны РАЗДЕЛЬНО, а не сведены к
    итоговой разнице: именно из их соотношения видно, где ошибается
    работодатель. `wrongNormUndertimeHours` — не наш результат, а цена
    чужой ошибки: столько «долга» возникнет, если отсутствия из нормы не
    исключить.
    """

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    period_start: date = Field(alias="periodStart")
    period_end: date = Field(alias="periodEnd")

    weekly_norm_hours: Decimal = Field(alias="weeklyNormHours")
    weekly_norm_basis: str = Field(alias="weeklyNormBasis")
    working_days: int = Field(alias="workingDays")
    pre_holiday_days: int = Field(alias="preHolidayDays")

    base_norm_hours: Decimal = Field(alias="baseNormHours")
    excluded_hours: Decimal = Field(alias="excludedHours")
    norm_hours: Decimal = Field(alias="normHours")
    actual_hours: Decimal = Field(alias="actualHours")
    overtime_hours: Decimal = Field(alias="overtimeHours")
    undertime_hours: Decimal = Field(alias="undertimeHours")
    wrong_norm_undertime_hours: Decimal = Field(alias="wrongNormUndertimeHours")

    night_hours: Decimal = Field(alias="nightHours")
    holiday_hours: Decimal = Field(alias="holidayHours")

    scheduled_shifts: int = Field(alias="scheduledShifts")
    worked_shifts: int = Field(alias="workedShifts")
    absent_shifts: int = Field(alias="absentShifts")

    calendar_published: bool = Field(alias="calendarPublished")
    """Опубликован ли производственный календарь года.

    Если нет — норма посчитана по неполному календарю, и человек обязан
    это знать прежде, чем нести расчёт начальнику.
    """

    shifts: list[ShiftResponse] = Field(default_factory=list)


class ReportedFiguresRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", populate_by_name=True)

    period_start: date = Field(alias="periodStart")
    period_end: date = Field(alias="periodEnd")
    norm_hours: Decimal | None = Field(default=None, alias="normHours", ge=0)
    actual_hours: Decimal | None = Field(default=None, alias="actualHours", ge=0)
    overtime_hours: Decimal | None = Field(default=None, alias="overtimeHours", ge=0)


class DiscrepancyResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    field_name: str = Field(alias="field")
    label: str
    expected: Decimal
    reported: Decimal
    delta: Decimal
    favours_employer: bool = Field(alias="favoursEmployer")
    explanation: str
    basis: str


class ReconciliationResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    calculation: CalculationResponse
    reported: ReportedFiguresRequest
    discrepancies: list[DiscrepancyResponse] = Field(default_factory=list)
