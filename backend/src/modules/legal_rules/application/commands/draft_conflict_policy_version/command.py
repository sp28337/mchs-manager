"""`DraftConflictPolicyVersionCommand` — черновик новой редакции порядка
приоритетов."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict

from src.modules.legal_rules.domain.value_objects import HourCategory


class DraftConflictPolicyVersionCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    policy_code: str
    precedence_list: tuple[HourCategory, ...]
    valid_from: date
    valid_to: date | None = None
