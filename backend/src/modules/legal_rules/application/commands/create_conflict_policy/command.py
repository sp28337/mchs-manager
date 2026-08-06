"""`CreateConflictPolicyCommand` — заведение политики разрешения конфликта
категорий часов."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class CreateConflictPolicyCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    code: str
