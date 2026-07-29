"""`CreateRuleCommand` — not an explicit backlog line item (the backlog
goes straight to `CreateRuleVersion`, LR007), but `openapi.yaml` has a
standalone `POST /legal-rules/rules` creating the `Rule` *identity*
before any version can be drafted against it — added here as the
necessary prerequisite, not left implicit.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from src.modules.legal_rules.domain.value_objects import RuleCategory


class CreateRuleCommand(BaseModel):
    """Mirrors `openapi.yaml` `CreateRuleRequest` — Pydantic IS allowed at
    the Application boundary (Backend_Architecture разд. 6.1), unlike
    inside Domain."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    code: str = Field(min_length=1, max_length=100, pattern=r"^[A-Z0-9_.]+$")
    category: RuleCategory
    display_name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
