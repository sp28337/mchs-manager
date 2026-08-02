"""`ListRulesQuery` — not an explicit backlog line item, but `openapi.yaml`
`GET /legal-rules/rules` needs it. Even though `LegalRulesAndCalculation`
is explicitly NOT a CQRS module (Architecture разд. 8.2), the Vertical
Slice anatomy (Architecture разд. 6) still applies to every use case,
CQRS or not — `PersonnelAndOrganization`'s `RegisterEmployee` slice
(Architecture разд. 6 table) is the documented example of exactly this
shape: a plain query slice reading through the same repository writes go
through, no separate read model.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from src.modules.legal_rules.domain.value_objects import RuleCategory


class ListRulesQuery(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    category: RuleCategory | None = None
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=200)
