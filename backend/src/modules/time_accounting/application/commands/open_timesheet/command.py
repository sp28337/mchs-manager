"""`OpenTimesheetCommand` — TA007. Зеркало `openapi.yaml`
`CreateTimesheetRequest`."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from src.modules.time_accounting.domain.value_objects import AccountingPeriodType


class OpenTimesheetCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    employee_id: UUID
    period_type: AccountingPeriodType
    period_start: date
    period_end: date
