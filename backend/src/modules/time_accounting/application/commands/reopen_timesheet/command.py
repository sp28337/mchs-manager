"""`ReopenTimesheetCommand` — TA016. Зеркало `openapi.yaml`
`ReopenTimesheetRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ReopenTimesheetCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    timesheet_id: UUID
    reason: str
