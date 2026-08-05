"""`ListServiceRecordEntriesQuery` —
`GET /personnel/employees/{employeeId}/service-record-entries`.

Unpaged, matching the contract: that operation declares no `page`/
`pageSize` parameters and returns a bare array. A service history is
bounded by one person's career, not by the size of the organization.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ListServiceRecordEntriesQuery(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    employee_id: UUID
