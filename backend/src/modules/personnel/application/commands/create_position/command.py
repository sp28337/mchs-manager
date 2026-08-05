"""`CreatePositionCommand` — PE006. Mirrors `openapi.yaml` `CreatePositionRequest`."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from src.modules.personnel.domain.value_objects import PositionCategory, RegimeType


class CreatePositionCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    code: str = Field(min_length=1, max_length=50)
    title: str = Field(min_length=1, max_length=300)
    category: PositionCategory
    default_regime_type: RegimeType
