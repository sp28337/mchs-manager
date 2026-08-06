"""`RecordEmployeeElectionCommand` — CO008."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from src.modules.compensation.domain.value_objects import CompensationForm, HourCategory


class RecordEmployeeElectionCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    case_id: UUID
    hour_category: HourCategory
    form: CompensationForm
    elected_at: datetime
