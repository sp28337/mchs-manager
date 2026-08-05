"""`GetCalendarYearQuery` — SC005. `GET /service-calendar/years/{year}`."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class GetCalendarYearQuery(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    year: int = Field(ge=2000, le=2100)
