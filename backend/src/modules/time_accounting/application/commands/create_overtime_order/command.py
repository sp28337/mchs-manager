"""`CreateOvertimeOrderCommand` — TA013. Зеркало `openapi.yaml`
`CreateOvertimeOrderRequest`."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CreateOvertimeOrderCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    order_number: str
    issued_date: date
    issued_by: UUID
    reason: str
