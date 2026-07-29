"""`CreateNormativeDocumentCommand` — LR006. Mirrors `openapi.yaml`
`CreateNormativeDocumentRequest`."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from src.modules.legal_rules.domain.value_objects import DocumentType


class CreateNormativeDocumentCommand(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    doc_type: DocumentType
    reg_number: str = Field(min_length=1, max_length=50)
    adopted_date: date
    title: str = Field(min_length=1, max_length=500)
    valid_from: date
    valid_to: date | None = None
