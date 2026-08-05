"""`GetScheduleForUnitQuery` — SD010.
`GET /scheduling/units/{unitId}/duty-schedules`."""

from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class GetScheduleForUnitQuery(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    unit_id: UUID
    period_start: date
    period_end: date
