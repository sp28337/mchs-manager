"""`CreateRuleVersionCommand` — LR007. Mirrors `openapi.yaml`
`CreateRuleVersionRequest`, with the schema gap already resolved in
`rule_engine/interpreter/version_resolver.py` applied here too: openapi
has separate `formulaDefinition`+`actions` fields, but the DB only has one
`formula_definition` jsonb column — this command accepts `actions`
directly (what actually gets persisted) and does not have a separate
`formula_definition` field at all, for the same reason documented there.
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.rule_engine.schemas.action import Action


class CreateRuleVersionCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    rule_id: UUID
    scope: dict[str, str]
    legal_basis_node_id: UUID
    actions: list[Action] = Field(min_length=1)
    valid_from: date
    valid_to: date | None = None
