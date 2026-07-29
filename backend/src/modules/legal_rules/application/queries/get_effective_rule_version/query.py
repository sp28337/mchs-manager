"""`GetEffectiveRuleVersionQuery` — LR010. Mirrors `openapi.yaml`
`GET /legal-rules/rules/{ruleId}/effective-version` — but takes `rule_code`
rather than `ruleId` since that's what `version_resolver` (and every
Formula `rule_reference` node, RE014) actually keys off; the API layer
(LR012) resolves `ruleId` -> `code` if needed."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict


class GetEffectiveRuleVersionQuery(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    rule_code: str
    scope: dict[str, str]
    as_of: date
