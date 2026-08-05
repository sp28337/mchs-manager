"""`CreateCorrectionEntryCommand` — TA014. Зеркало `openapi.yaml`
`CreateCorrectionEntryRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CreateCorrectionEntryCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    timesheet_id: UUID
    original_event_id: UUID
    reason: str
    created_by: UUID
