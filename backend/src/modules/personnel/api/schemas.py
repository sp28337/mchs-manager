"""PE011 — API-layer Pydantic schemas: a direct mirror of `openapi.yaml`'s
Personnel DTOs (Backend_Architecture разд. 6.1). `extra="forbid"` on every
request model implements the strictness the contract implies.

`Problem` is deliberately imported from `legal_rules.api.schemas` rather
than redeclared: RFC 7807 is one envelope for the whole API
(API_Conventions разд. 3), and two copies of it would be two things to
keep in step. This is an `api -> api` import between modules, which the
module-boundary rule (Architecture разд. 4.2: only `Contracts/` crosses)
does not permit — so it is not done. See `_problem` in `router.py` for
where the shared shape actually lives.
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.modules.personnel.domain.value_objects import (
    EmploymentStatus,
    LegalBase,
    PositionCategory,
    RegimeType,
    ServiceConditionCategory,
    ServiceRecordEventType,
)

# ---------- Unit


class CreateUnitRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=300)
    parent_unit_id: UUID | None = Field(default=None, alias="parentUnitId")
    # Additive относительно openapi `CreateUnitRequest` (разрешено
    # политикой изменений API_Conventions разд. 1). Необязателен: у
    # дочернего подразделения по умолчанию пояс родителя, у корневого —
    # Europe/Moscow. Указывать его приходится ровно там, где подразделение
    # действительно в другом поясе.
    time_zone: str | None = Field(default=None, alias="timeZone", max_length=64)


class UnitResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    code: str
    name: str
    parent_unit_id: UUID | None = Field(default=None, alias="parentUnitId")
    # `openapi.yaml`'s `Unit.hierarchyPath` is a plain string — the dotted
    # ltree literal, exactly as stored. The `HierarchyPath` VO is a domain
    # concept and does not cross the wire.
    hierarchy_path: str = Field(alias="hierarchyPath")
    time_zone: str = Field(alias="timeZone")


# ---------- Position


class CreatePositionRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    code: str = Field(min_length=1, max_length=50)
    title: str = Field(min_length=1, max_length=300)
    category: PositionCategory
    default_regime_type: RegimeType = Field(alias="defaultRegimeType")


class PositionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    code: str
    title: str
    category: PositionCategory
    default_regime_type: RegimeType = Field(alias="defaultRegimeType")


# ---------- Employee


class CreateEmployeeRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    personnel_number: str = Field(alias="personnelNumber", pattern=r"^[0-9]{6,10}$")
    full_name: str = Field(alias="fullName", min_length=1, max_length=300)
    rank: str = Field(min_length=1, max_length=100)
    legal_base: LegalBase = Field(alias="legalBase")
    service_condition_category: ServiceConditionCategory = Field(
        default=ServiceConditionCategory.NORMAL, alias="serviceConditionCategory"
    )
    current_position_id: UUID = Field(alias="currentPositionId")
    current_unit_id: UUID = Field(alias="currentUnitId")
    hired_at: date = Field(alias="hiredAt")


class EmployeeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    personnel_number: str = Field(alias="personnelNumber")
    full_name: str = Field(alias="fullName")
    rank: str
    legal_base: LegalBase = Field(alias="legalBase")
    service_condition_category: ServiceConditionCategory = Field(
        alias="serviceConditionCategory"
    )
    current_position_id: UUID = Field(alias="currentPositionId")
    current_unit_id: UUID = Field(alias="currentUnitId")
    hired_at: date = Field(alias="hiredAt")
    employment_status: EmploymentStatus = Field(alias="employmentStatus")
    dismissed_at: date | None = Field(default=None, alias="dismissedAt")


class EmployeeListEnvelopeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    items: list[EmployeeResponse]
    page: int
    page_size: int = Field(alias="pageSize")
    total_count: int = Field(alias="totalCount")


class ChangeEmploymentStatusRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    new_status: EmploymentStatus = Field(alias="newStatus")
    effective_date: date = Field(alias="effectiveDate")
    reason: str = Field(min_length=1, max_length=1000)


# ---------- ServiceRecordEntry


class CreateServiceRecordEntryRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    event_type: ServiceRecordEventType = Field(alias="eventType")
    effective_date: date = Field(alias="effectiveDate")
    position_id: UUID | None = Field(default=None, alias="positionId")
    unit_id: UUID | None = Field(default=None, alias="unitId")
    rank: str | None = Field(default=None, max_length=100)
    # Additive (API_Conventions разд. 1). Правовая база, установленная
    # этим кадровым событием: переход из гражданского персонала в
    # аттестованный состав меняет применимый закон (ФЗ-141 против ТК РФ),
    # и без него пересчёт прошлого периода взял бы не тот.
    legal_base: LegalBase | None = Field(default=None, alias="legalBase")


class ServiceRecordEntryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    employee_id: UUID = Field(alias="employeeId")
    event_type: ServiceRecordEventType = Field(alias="eventType")
    effective_date: date = Field(alias="effectiveDate")
    position_id: UUID | None = Field(default=None, alias="positionId")
    unit_id: UUID | None = Field(default=None, alias="unitId")
    rank: str | None = None
    legal_base: LegalBase | None = Field(default=None, alias="legalBase")
    recorded_at: datetime = Field(alias="recordedAt")
