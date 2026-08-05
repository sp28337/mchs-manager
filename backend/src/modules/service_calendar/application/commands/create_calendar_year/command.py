"""`CreateCalendarYearCommand` — SC003. Mirrors `openapi.yaml`
`CreateCalendarYearRequest`."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class CreateCalendarYearCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    # Bounds mirror both `openapi.yaml` and `ck_calendar_year_range`
    # (migration 0009).
    year: int = Field(ge=2000, le=2100)
