"""`CreateDocumentNodeCommand` — not an explicit backlog line item, but a
necessary prerequisite: a `RuleVersion`'s `LegalBasis.node_id` (LR007) must
point at a real `document_node` row, and nothing before this created one.
Mirrors `openapi.yaml` `CreateDocumentNodeRequest`.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.modules.legal_rules.domain.value_objects import DocumentNodeType


class CreateDocumentNodeCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    document_id: UUID
    parent_node_id: UUID | None = None
    node_type: DocumentNodeType
    ordinal_number: str = Field(min_length=1, max_length=20)
    title: str | None = Field(default=None, max_length=500)
    text_content: str | None = Field(default=None, max_length=5000)
