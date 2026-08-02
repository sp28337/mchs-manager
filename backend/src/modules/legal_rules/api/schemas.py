"""API-layer Pydantic schemas — direct mirror of `openapi.yaml`'s LegalRules
DTOs (Backend_Architecture разд. 6.1: "Прямое зеркало openapi.yaml").
`extra="forbid"` implements the same strictness openapi.yaml implies (no
undeclared fields silently accepted).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.modules.legal_rules.domain.value_objects import (
    DocumentNodeType,
    DocumentType,
    RuleCategory,
    RuleStatus,
)
from src.rule_engine.schemas.action import Action


class Problem(BaseModel):
    """RFC 7807 — API_Conventions_FPS.md разд. 3. Every error response
    across the whole API uses this envelope, not just `legal_rules`."""

    model_config = ConfigDict(frozen=True)

    type: str
    title: str
    status: int
    detail: str | None = None
    instance: str | None = None
    trace_id: str | None = Field(default=None, alias="traceId")


# ---------- NormativeDocument


class CreateNormativeDocumentRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    doc_type: DocumentType = Field(alias="docType")
    reg_number: str = Field(alias="regNumber", min_length=1, max_length=50)
    adopted_date: date = Field(alias="adoptedDate")
    title: str = Field(min_length=1, max_length=500)
    valid_from: date = Field(alias="validFrom")
    valid_to: date | None = Field(default=None, alias="validTo")


class NormativeDocumentResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    doc_type: DocumentType = Field(alias="docType")
    reg_number: str = Field(alias="regNumber")
    adopted_date: date = Field(alias="adoptedDate")
    title: str
    valid_from: date = Field(alias="validFrom")
    valid_to: date | None = Field(default=None, alias="validTo")


# ---------- DocumentNode


class CreateDocumentNodeRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    parent_node_id: UUID | None = Field(default=None, alias="parentNodeId")
    node_type: DocumentNodeType = Field(alias="nodeType")
    ordinal_number: str = Field(alias="ordinalNumber", min_length=1, max_length=20)
    title: str | None = Field(default=None, max_length=500)
    text_content: str | None = Field(default=None, alias="textContent", max_length=5000)


class DocumentNodeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    document_id: UUID = Field(alias="documentId")
    parent_node_id: UUID | None = Field(default=None, alias="parentNodeId")
    node_type: DocumentNodeType = Field(alias="nodeType")
    ordinal_number: str = Field(alias="ordinalNumber")
    title: str | None = None
    text_content: str | None = Field(default=None, alias="textContent")


# ---------- Rule


class CreateRuleRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    code: str = Field(min_length=1, max_length=100, pattern=r"^[A-Z0-9_.]+$")
    category: RuleCategory
    display_name: str = Field(alias="displayName", min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class RuleResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    code: str
    category: RuleCategory
    display_name: str = Field(alias="displayName")
    description: str | None = None


class RuleListEnvelopeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    items: list[RuleResponse]
    page: int
    page_size: int = Field(alias="pageSize")
    total_count: int = Field(alias="totalCount")


# ---------- RuleVersion


class CreateRuleVersionRequest(BaseModel):
    """openapi.yaml `CreateRuleVersionRequest` has separate `formulaDefinition`
    + `actions` fields; the schema gap this creates is already resolved in
    `rule_engine.interpreter.version_resolver` (only `actions` is actually
    persisted). `formula_definition` is accepted here for openapi-shape
    compatibility but is not required and is otherwise ignored — the
    documented resolution keeps `actions` as the single source of truth.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    scope: dict[str, str]
    legal_basis_node_id: UUID = Field(alias="legalBasisNodeId")
    formula_definition: Any | None = Field(default=None, alias="formulaDefinition")
    actions: list[Action] = Field(min_length=1)
    valid_from: date = Field(alias="validFrom")
    valid_to: date | None = Field(default=None, alias="validTo")


class PublishRuleVersionRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    change_reason: str = Field(alias="changeReason", min_length=10, max_length=2000)


class RuleVersionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    rule_id: UUID = Field(alias="ruleId")
    version_no: int = Field(alias="versionNo")
    scope: dict[str, str]
    legal_basis_node_id: UUID = Field(alias="legalBasisNodeId")
    valid_from: date = Field(alias="validFrom")
    valid_to: date | None = Field(default=None, alias="validTo")
    status: RuleStatus
    published_at: datetime | None = Field(default=None, alias="publishedAt")
    published_by: UUID | None = Field(default=None, alias="publishedBy")


class EffectiveRuleVersionResponse(BaseModel):
    """Response for `GET /legal-rules/rules/{ruleId}/effective-version` —
    projected from `rule_engine.ResolvedRuleVersion` (RE014), not
    `legal_rules.domain.RuleVersion` directly (that DTO has no
    `rule_code`/persisted actions shape identical to this one, and
    Architecture разд. 4.2 п.3 already requires Query results to be
    projections, not raw aggregates, even within one module's own API)."""

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    rule_id: UUID = Field(alias="ruleId")
    version_no: int = Field(alias="versionNo")
    valid_from: date = Field(alias="validFrom")
    valid_to: date | None = Field(default=None, alias="validTo")
    actions: list[Action]
