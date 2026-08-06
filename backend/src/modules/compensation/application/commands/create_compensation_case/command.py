"""`CreateCompensationCaseCommand` — CO005. Зеркало openapi
`CreateCompensationCaseRequest`, плюс период.

`openapi.yaml` требует только `employeeId` и `timesheetId`, но период
делу нужен: его ключ уникальности — «сотрудник + период», а не табель, и
восстанавливать период из табеля значило бы задавать `time_accounting`
второй вопрос ради того, что вызывающий и так знает. ADDITIVE-поле,
разрешено политикой API_Conventions разд. 1.
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CreateCompensationCaseCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    employee_id: UUID
    period_start: date
    period_end: date
