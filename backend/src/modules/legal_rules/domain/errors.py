"""Domain-level exceptions for LegalRulesAndCalculation. These are raised
by aggregate methods (never by Application/Infrastructure), and mapped to
HTTP responses only at the Composition/API boundary (API_Conventions
разд. 3) — the domain itself knows nothing about HTTP status codes.
"""

from __future__ import annotations


class LegalRulesDomainError(Exception):
    """Base class for every error raised from this module's domain layer."""


class RuleVersionOverlapError(LegalRulesDomainError):
    """Domain Model инвариант 2.2.1: for the same (rule, scope), no two
    published/superseded RuleVersions may have overlapping effective
    periods. Maps to 409 Conflict at the API boundary."""


class RuleVersionImmutableError(LegalRulesDomainError):
    """Domain Model инвариант 2.2.2: a published/superseded RuleVersion's
    content fields cannot change; only the published->superseded status
    transition (with valid_to) is allowed. Maps to 423 Locked."""


class RuleVersionMissingLegalBasisError(LegalRulesDomainError):
    """Domain Model разд. 2.2 инвариант 3: a RuleVersion cannot be published
    without a LegalBasis. Structurally unreachable in the current design
    (LegalBasis is a required constructor argument) — kept as a defensive
    guard in case that constraint is ever relaxed. Maps to 422."""


class RuleVersionPredatesLegalBasisError(LegalRulesDomainError):
    """Domain Model разд. 2.2 инвариант 4: EffectivePeriod.validFrom cannot
    be earlier than the cited NormativeDocument's own validFrom — a rule
    cannot take effect before its legal basis did. Maps to 422."""


class ConflictPolicyDuplicateCategoryError(LegalRulesDomainError):
    """Domain Model разд. 2.3 инвариант 1: CategoryPrecedenceList must not
    contain duplicate RuleCategory entries. Maps to 400/422."""


class PolicyVersionOverlapError(LegalRulesDomainError):
    """Mirror of RuleVersionOverlapError for ConflictResolutionPolicyVersion
    (PostgreSQL_Logical_Model разд. 1.6: same EXCLUDE pattern as
    rule_version, minus the scope dimension). Maps to 409 Conflict."""


class PolicyVersionImmutableError(LegalRulesDomainError):
    """Mirror of RuleVersionImmutableError for ConflictResolutionPolicyVersion.
    Maps to 423 Locked."""


class DocumentNodeDuplicatePositionError(LegalRulesDomainError):
    """Domain Model разд. 2.1 инвариант 2: numbering of
    Chapter/Article/Paragraph must be unique within a document. Maps to 409."""


class RuleNotFoundError(LegalRulesDomainError):
    """No `Rule` with the given id exists. Maps to 404 Not Found."""


class RuleCodeAlreadyExistsError(LegalRulesDomainError):
    """`legal_rules.rule.code` is UNIQUE (`uq_rule_code`,
    PostgreSQL_Logical_Model разд. 1.4). Maps to 409 Conflict."""


class NormativeDocumentNotFoundError(LegalRulesDomainError):
    """No `NormativeDocument` with the given id exists. Maps to 404 Not Found."""


class NormativeDocumentAlreadyExistsError(LegalRulesDomainError):
    """`DocumentIdentity` (doc_type, reg_number, adopted_date) is UNIQUE
    (`uq_document_identity`, PostgreSQL_Logical_Model разд. 1.2) — the
    cross-aggregate check `NormativeDocument.add_node()` deliberately
    doesn't perform (see its docstring), done here at the repository/
    Application boundary instead. Maps to 409 Conflict."""

class PolicyNotFoundError(LegalRulesDomainError):
    """Политика разрешения конфликта категорий не найдена. Отображается
    в 404."""


class PolicyCodeAlreadyExistsError(LegalRulesDomainError):
    """`uq_conflict_resolution_policy_code` — код политики уникален.
    Отображается в 409."""
