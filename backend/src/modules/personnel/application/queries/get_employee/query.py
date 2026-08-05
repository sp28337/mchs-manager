"""`GetEmployeeQuery` — PE010. `GET /personnel/employees/{employeeId}`.

`PersonnelAndOrganization` is not a CQRS module (Architecture разд. 8.2),
so this query reads through the same repository the commands write
through — no separate read model. The Vertical Slice shape still applies
to every use case, CQRS or not (Architecture разд. 6).
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class GetEmployeeQuery(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    employee_id: UUID
