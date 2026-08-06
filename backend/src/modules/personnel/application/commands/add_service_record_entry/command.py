"""`AddServiceRecordEntryCommand` — PE009. Mirrors `openapi.yaml`
`CreateServiceRecordEntryRequest` plus the `employeeId` path parameter.

Note what is absent: there is no Update or Delete counterpart, at any
layer. `service_record_entry` is append-only (Domain Model разд. 13), and
the absence of the operation is how that is expressed in the Application
layer — the DB trigger (migration 0008) and the aggregate's `__setattr__`
guard are what enforce it if something tries anyway.
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.modules.personnel.domain.value_objects import LegalBase, ServiceRecordEventType


class AddServiceRecordEntryCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    employee_id: UUID
    event_type: ServiceRecordEventType
    effective_date: date
    position_id: UUID | None = None
    unit_id: UUID | None = None
    rank: str | None = Field(default=None, max_length=100)
    legal_base: LegalBase | None = None
