"""`RegisterEmployeeCommand` — PE007. Mirrors `openapi.yaml`
`CreateEmployeeRequest`.

`personnelNumber`'s `^[0-9]{6,10}$` pattern comes straight from the
contract and is a FORM rule, so it belongs here rather than in the
`Employee` aggregate — the aggregate's business is what an employee may
DO, not how their personnel number is spelled.
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.modules.personnel.domain.value_objects import LegalBase, ServiceConditionCategory


class RegisterEmployeeCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    personnel_number: str = Field(pattern=r"^[0-9]{6,10}$")
    full_name: str = Field(min_length=1, max_length=300)
    rank: str = Field(min_length=1, max_length=100)
    legal_base: LegalBase
    # `openapi.yaml` lists `serviceConditionCategory` outside `required`,
    # so it is optional on the wire; `normal` is the only defensible
    # default (it is also the DB column's DEFAULT, migration 0007).
    service_condition_category: ServiceConditionCategory = ServiceConditionCategory.NORMAL
    current_position_id: UUID
    current_unit_id: UUID
    hired_at: date
