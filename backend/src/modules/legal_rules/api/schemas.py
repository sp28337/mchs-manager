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

from src.building_blocks.application.problem import Problem
from src.modules.legal_rules.domain.value_objects import (
    DocumentNodeType,
    DocumentType,
    HourCategory,
    RuleCategory,
    RuleStatus,
)
from src.rule_engine.schemas.action import Action

# `Problem` (RFC 7807) is re-exported, not redeclared: it is the error
# envelope of the WHOLE API, so it lives in `building_blocks/application`
# where every module can reach it without importing another module's `api`
# package (which Architecture разд. 4.2 forbids). Re-exported here so the
# existing `from ...legal_rules.api.schemas import Problem` imports keep
# resolving to the one shared definition.
__all__ = ["Problem"]


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


class CreateConflictPolicyRequest(BaseModel):
    """ADDITIVE относительно `openapi.yaml`, которая не описывает над
    политикой разрешения конфликта категорий НИ ОДНОЙ операции, хотя
    Domain Model разд. 2.3 объявляет её агрегатом, а логическая модель
    разд. 1.6 — парой таблиц.

    Пробел спецификации, а не расширение по вкусу: Алгоритм Ж требует
    действующую политику как обязательный вход, и без этих операций
    утверждение любого табеля отказывало бы навсегда — завести порядок
    приоритетов было бы нечем. Эталонный `openapi.yaml` следует дополнить
    при ближайшей ревизии.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    code: str = Field(min_length=1, max_length=100)


class ConflictPolicyVersionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    policy_id: UUID = Field(alias="policyId")
    version_no: int = Field(alias="versionNo")
    precedence_list: list[str] = Field(alias="precedenceList")
    valid_from: date = Field(alias="validFrom")
    valid_to: date | None = Field(default=None, alias="validTo")
    status: RuleStatus


class ConflictPolicyResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: UUID
    code: str
    versions: list[ConflictPolicyVersionResponse] = Field(default_factory=list)


class CreateConflictPolicyVersionRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    # Список, а не множество, и порядок — это и есть содержание:
    # первая применимая категория забирает час целиком (Алгоритм Ж шаг 4).
    precedence_list: list[HourCategory] = Field(alias="precedenceList", min_length=1)
    valid_from: date = Field(alias="validFrom")
    valid_to: date | None = Field(default=None, alias="validTo")
