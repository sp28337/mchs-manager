"""`ApproveScheduleCommand` — SD008. Зеркало `ApproveScheduleRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ApproveScheduleCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    schedule_id: UUID
    # Обязателен и непуст: утверждение без документа-основания запрещено
    # (SRS разд. 8 п.11, `ck_duty_schedule_approved_has_order`).
    approval_order_ref: str = Field(min_length=1, max_length=100)
