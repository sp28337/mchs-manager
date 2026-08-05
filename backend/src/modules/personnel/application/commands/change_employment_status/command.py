"""`ChangeEmploymentStatusCommand` — PE008. Mirrors `openapi.yaml`
`ChangeEmploymentStatusRequest` plus the `employeeId` path parameter."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.modules.personnel.domain.value_objects import EmploymentStatus


class ChangeEmploymentStatusCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    employee_id: UUID
    new_status: EmploymentStatus
    effective_date: date
    reason: str = Field(min_length=1, max_length=1000)
