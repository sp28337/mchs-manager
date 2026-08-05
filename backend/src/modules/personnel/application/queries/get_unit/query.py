"""`GetUnitQuery` — `GET /personnel/units/{unitId}`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class GetUnitQuery(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    unit_id: UUID
