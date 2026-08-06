"""`PublishConflictPolicyVersionCommand`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class PublishConflictPolicyVersionCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    version_id: UUID
