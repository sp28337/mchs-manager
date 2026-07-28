"""Value Objects and enums for the LegalRulesAndCalculation domain
(Domain_Model_DDD_Sluzhebnoe_Vremya_FPS.md, разд. 2). Plain dataclasses
only — no Pydantic, no SQLAlchemy (Backend_Architecture разд. 3.1).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import StrEnum
from uuid import UUID

from src.building_blocks.domain.value_object import ValueObject


class RuleCategory(StrEnum):
    """Mirrors legal_rules.rule_category (PostgreSQL_Logical_Model разд. 1.1)."""

    NORM_CALCULATION = "norm_calculation"
    NIGHT_HOURS_CLASSIFICATION = "night_hours_classification"
    HOLIDAY_HOURS_CLASSIFICATION = "holiday_hours_classification"
    OVERTIME_CLASSIFICATION = "overtime_classification"
    COMPENSATION_COEFFICIENT = "compensation_coefficient"
    LEAVE_ENTITLEMENT = "leave_entitlement"
    MINIMUM_REST_PERIOD = "minimum_rest_period"


class RuleStatus(StrEnum):
    """Mirrors legal_rules.rule_status."""

    DRAFT = "draft"
    PUBLISHED = "published"
    SUPERSEDED = "superseded"


class DocumentType(StrEnum):
    FEDERAL_LAW = "federal_law"
    GOVERNMENT_DECREE = "government_decree"
    DEPARTMENTAL_ORDER = "departmental_order"


class DocumentNodeType(StrEnum):
    CHAPTER = "chapter"
    ARTICLE = "article"
    PARAGRAPH = "paragraph"


@dataclass(frozen=True, kw_only=True)
class EffectivePeriod(ValueObject):
    """{validFrom, validTo (опционально открытый)} — Domain Model разд. 2.2.

    `valid_to=None` means "in effect indefinitely" (mirrors the DB's
    `coalesce(valid_to, 'infinity'::date)` treatment in the EXCLUDE
    constraint, PostgreSQL_Logical_Model разд. 1.5).
    """

    valid_from: date
    valid_to: date | None = None

    def __post_init__(self) -> None:
        if self.valid_to is not None and self.valid_to <= self.valid_from:
            raise ValueError("valid_to must be strictly after valid_from")

    def overlaps(self, other: EffectivePeriod) -> bool:
        """Half-open interval overlap: [self.start, self.end) ∩ [other.start, other.end) ≠ ∅."""
        self_end = self.valid_to or date.max
        other_end = other.valid_to or date.max
        return self.valid_from < other_end and other.valid_from < self_end

    def covers(self, as_of: date) -> bool:
        return self.valid_from <= as_of and (self.valid_to is None or self.valid_to > as_of)

    def __composite_values__(self) -> tuple[date, date | None]:
        """Required by SQLAlchemy's `composite()` to decompose this VO back
        into (valid_from, valid_to) column values on write — same reason
        as `LegalBasis.__composite_values__` (Context7
        /websites/sqlalchemy_en_20, orm/composites.html)."""
        return self.valid_from, self.valid_to


@dataclass(frozen=True, kw_only=True)
class LegalBasis(ValueObject):
    """{ссылка на Chapter/Article/Paragraph} — Domain Model разд. 2.2: "VO,
    not an aggregate (документ цитируется, но не владеется правилом)".

    Deliberately holds only `node_id`, not also `document_id`: the DB only
    persists `rule_version.legal_basis_node_id` (PostgreSQL_Logical_Model
    разд. 1.5) — `document_id` is reachable transitively via
    `document_node.document_id` and is never duplicated onto rule_version.
    A VO with an un-persisted field would silently drift from what's
    actually stored, so the VO's shape follows the DB's, not the other way
    around.
    """

    node_id: UUID

    def __composite_values__(self) -> tuple[UUID]:
        """Required by SQLAlchemy's `composite()` to decompose this VO back
        into column values on write (Context7 /websites/sqlalchemy_en_20,
        orm/composites.html) — the read-side reconstruction uses a
        separate factory function (`orm_mapping._legal_basis_factory`)
        since this VO's constructor is keyword-only."""
        return (self.node_id,)


@dataclass(frozen=True, kw_only=True)
class Scope(ValueObject):
    """{применимо к: категории условий службы / категории должностей / всем}
    — Domain Model разд. 2.2. Stored as a sorted tuple of (key, value) pairs
    rather than a dict so the VO stays hashable/immutable (ValueObject
    базовый класс: "remember to keep VOs free of mutable fields").
    """

    items: tuple[tuple[str, str], ...]

    @classmethod
    def from_dict(cls, values: dict[str, str]) -> Scope:
        return cls(items=tuple(sorted(values.items())))

    def as_dict(self) -> dict[str, str]:
        return dict(self.items)
