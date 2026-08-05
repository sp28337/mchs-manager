"""`AddPlannedShiftCommand` — SD005. Зеркало `CreatePlannedShiftRequest`
плюс `scheduleId` из пути.

`rule_scope` в openapi нет — и не должно быть: это не то, что присылает
клиент, а то, чем Application-слой ищет применимую `RuleVersion`
минимального отдыха (Алгоритм А: правовая база — параметр `scope`, а не
развилка в логике). Роутер заполняет его сам из данных сотрудника.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.modules.scheduling.domain.value_objects import DutyType


class AddPlannedShiftCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    schedule_id: UUID
    employee_id: UUID
    start_time: datetime
    end_time: datetime
    duty_type: DutyType
    rule_scope: dict[str, str] = Field(default_factory=dict)
