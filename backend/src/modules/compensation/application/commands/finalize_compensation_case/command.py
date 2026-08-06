"""`FinalizeCompensationCaseCommand` — CO009."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class FinalizeCompensationCaseCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    case_id: UUID
