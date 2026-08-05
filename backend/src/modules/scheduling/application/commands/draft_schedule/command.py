"""`DraftScheduleCommand` — SD004. Зеркало `openapi.yaml`
`CreateDutyScheduleRequest`."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from src.modules.scheduling.domain.value_objects import AccountingPeriodType


class DraftScheduleCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    unit_id: UUID
    period_type: AccountingPeriodType
    period_start: date
    period_end: date
