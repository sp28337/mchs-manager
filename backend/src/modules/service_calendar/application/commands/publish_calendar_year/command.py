"""`PublishCalendarYearCommand` — SC004.

`openapi.yaml`'s publish operation has no request body, only the `{year}`
path parameter and `Idempotency-Key`.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class PublishCalendarYearCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    year: int = Field(ge=2000, le=2100)
