"""CO016 — схемы API, зеркало Compensation-DTO из `openapi.yaml`.

Два отклонения, оба ADDITIVE и оба названные (политика изменений
API_Conventions разд. 1 разрешает добавление необязательного поля).

**`hourCategory` вместо `ruleCategory`.** `openapi.yaml` типизирует поле
строки и запроса волеизъявления схемой `RuleCategory`. Это то же
несоответствие, что уже было найдено в `precedence_list` и в логической
модели разд. 6: перечисленные Domain Model разд. 7.1 значения
(«Overtime/Night/Holiday») категориями ПРАВИЛ не являются, а про выходные
у `RuleCategory` нет ничего вовсе — то есть компенсацию за работу в
выходной (ТК РФ ст. 153) описать этой схемой невозможно. Поле принимает
обе формы имени, чтобы клиент по старой спецификации не сломался, но
значения — категории часов.

**`periodStart`/`periodEnd` в запросе создания.** `openapi.yaml` требует
`employeeId` и `timesheetId`; период делу нужен как ключ уникальности.
`timesheetId` при этом НЕ принимается: он определяется периодом
однозначно, и позволять клиенту назвать чужой табель значило бы дать
способ начислить компенсацию по чужому расчёту.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.modules.compensation.domain.value_objects import (
    CaseStatus,
    CompensationForm,
    HourCategory,
)


class CreateCompensationCaseRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    employee_id: UUID = Field(alias="employeeId")
    period_start: date = Field(alias="periodStart")
    period_end: date = Field(alias="periodEnd")


class CompensationLineResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    hour_category: HourCategory = Field(alias="hourCategory")
    hours_amount: Decimal = Field(alias="hoursAmount")
    compensation_form: CompensationForm = Field(alias="compensationForm")
    legal_basis_rule_version_id: UUID = Field(alias="legalBasisRuleVersionId")
    employee_election_at: datetime | None = Field(default=None, alias="employeeElectionAt")
    # Additive: без него клиент не знает, у каких строк вообще есть выбор,
    # и вынужден предлагать его везде — то есть обещать сотруднику право,
    # которого правило ему не даёт (инвариант 7.1.3).
    election_allowed: bool = Field(alias="electionAllowed")


class CompensationCaseResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    employee_id: UUID = Field(alias="employeeId")
    timesheet_id: UUID = Field(alias="timesheetId")
    period_start: date = Field(alias="periodStart")
    period_end: date = Field(alias="periodEnd")
    status: CaseStatus
    corrects_case_id: UUID | None = Field(default=None, alias="correctsCaseId")
    finalized_at: datetime | None = Field(default=None, alias="finalizedAt")
    lines: list[CompensationLineResponse] = Field(default_factory=list)


class RecordEmployeeElectionRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", populate_by_name=True)

    # `ruleCategory` принимается как псевдоним — см. докстринг модуля.
    hour_category: HourCategory = Field(alias="hourCategory")
    compensation_form: CompensationForm = Field(alias="compensationForm")
