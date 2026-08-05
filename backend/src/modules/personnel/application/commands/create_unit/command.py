"""`CreateUnitCommand` — PE006. Mirrors `openapi.yaml` `CreateUnitRequest`.

Pydantic IS allowed at the Application boundary (Backend_Architecture
разд. 6.1), unlike inside Domain — this validates the FORM of the request
(lengths, types); the business invariants stay in `Unit`.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CreateUnitCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=300)
    parent_unit_id: UUID | None = None
