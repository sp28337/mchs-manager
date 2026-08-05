"""`ReviseScheduleCommand` — SD009. Зеркало `ReviseScheduleRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ReviseScheduleCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    schedule_id: UUID
    reason: str = Field(min_length=1, max_length=1000)
