"""`ApproveTimesheetCommand` — TA015.

Тела запроса у операции нет (openapi `POST /timesheets/{id}/approve`
принимает только `Idempotency-Key`), но команда всё равно объявлена
явным типом, а не голым UUID: обработчик обязан принимать команду, а не
идентификатор, иначе первый же дополнительный параметр (а он придёт с
TA026 — сборкой `HoursBreakdown`) поменяет сигнатуру всем вызывающим.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ApproveTimesheetCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    timesheet_id: UUID
