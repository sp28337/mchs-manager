"""Ports (interfaces) the Application layer depends on. Concrete
implementations live in `infrastructure/write/*_repository.py` and are
constructed by the caller (a test, or Composition/di.py once it exists)
and injected into a handler's constructor — a handler must never import a
concrete `infrastructure` class directly (Architecture разд. 3, 7:
"Application импортирует только Domain... Infrastructure реализует
интерфейсы, объявленные в Application/Domain — инверсия зависимостей").

This was a real violation caught by `.importlinter`'s `layers-legal-rules`
contract (`application -> infrastructure` is a forbidden direction) after
LR006-LR010 handlers were first written importing `RuleRepository`/
`NormativeDocumentRepository` directly — fixed here rather than relaxing
the contract.
"""

from __future__ import annotations

from datetime import date
from typing import Protocol
from uuid import UUID

from src.modules.legal_rules.domain.normative_document import NormativeDocument
from src.modules.legal_rules.domain.rule import Rule
from src.modules.legal_rules.domain.value_objects import DocumentType, RuleCategory
from src.rule_engine.interpreter.version_resolver import ResolvedRuleVersion


class RuleRepositoryPort(Protocol):
    async def get(self, rule_id: UUID) -> Rule | None: ...
    async def get_by_code(self, code: str) -> Rule | None: ...
    async def get_by_version_id(self, version_id: UUID) -> Rule | None: ...
    async def list(
        self, *, category: RuleCategory | None, page: int, page_size: int
    ) -> tuple[list[Rule], int]: ...
    def add(self, rule: Rule) -> None: ...


class NormativeDocumentRepositoryPort(Protocol):
    async def get(self, document_id: UUID) -> NormativeDocument | None: ...

    async def get_by_identity(
        self, *, doc_type: DocumentType, reg_number: str, adopted_date: date
    ) -> NormativeDocument | None: ...

    def add(self, document: NormativeDocument) -> None: ...


class RuleVersionCachePort(Protocol):
    """LR011 — cache-aside for `GetEffectiveRuleVersion`. See
    `infrastructure/cache/rule_version_cache.py` for the honest gap this
    carries (TTL-only, no event-based invalidation yet)."""

    async def get(
        self, *, rule_code: str, scope: dict[str, str], as_of: date
    ) -> ResolvedRuleVersion | None: ...

    async def set(
        self, *, rule_code: str, scope: dict[str, str], as_of: date, value: ResolvedRuleVersion
    ) -> None: ...
