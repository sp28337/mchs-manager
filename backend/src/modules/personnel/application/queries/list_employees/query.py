"""`ListEmployeesQuery` — PE010. `GET /personnel/employees`.

Paging defaults (`page=1`, `pageSize=50`, max `200`) are `openapi.yaml`'s
own `Page`/`PageSize` parameter definitions, restated here so the
Application layer refuses an out-of-range page even when a caller reaches
a handler without going through the HTTP layer (tests, future workers).
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ListEmployeesQuery(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    unit_id: UUID | None = None
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=200)
