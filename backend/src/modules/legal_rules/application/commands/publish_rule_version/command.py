"""`PublishRuleVersionCommand` — LR008. Mirrors `openapi.yaml`
`PublishRuleVersionRequest` (`changeReason`) plus the path/security
parameters (`ruleId`, `versionId`, `publishedBy` from the JWT `sub` claim
— API_Conventions разд. 2) that the API layer will supply once it exists
(LR012)."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PublishRuleVersionCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    rule_id: UUID
    version_id: UUID
    published_by: UUID
    change_reason: str = Field(min_length=10, max_length=2000)
