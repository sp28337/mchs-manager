"""Value Objects and enums for the PersonnelAndOrganization domain
(Domain_Model_DDD_Sluzhebnoe_Vremya_FPS.md, разд. 3). Plain dataclasses
only — no Pydantic, no SQLAlchemy (Backend_Architecture разд. 3.1).

Every enum below mirrors, name for name, both the PostgreSQL enum type
created in migration 0006 and the corresponding `openapi.yaml` schema
(`EmploymentStatus`, `RegimeType`, `PositionCategory`,
`ServiceConditionCategory`, `CreateEmployeeRequest.legalBase`,
`CreateServiceRecordEntryRequest.eventType`) — three declarations of one
vocabulary, kept literally identical rather than mapped between.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from src.building_blocks.domain.value_object import ValueObject


class EmploymentStatus(StrEnum):
    """Mirrors personnel.employment_status (migration 0006)."""

    ACTIVE = "active"
    ON_LEAVE = "on_leave"
    SICK = "sick"
    SUSPENDED = "suspended"
    DISMISSED = "dismissed"


class RegimeType(StrEnum):
    """Режим служебного времени, заданный должностью по умолчанию —
    the input every norm-calculation Rule keys off (Rule Engine: a
    `RuleVersion.scope` typically names `regimeType` among its
    dimensions)."""

    FIVE_DAY_WEEK = "five_day_week"
    SHIFT_SCHEDULE = "shift_schedule"
    TWENTY_FOUR_HOUR_DUTY = "twenty_four_hour_duty"
    UNSTANDARDIZED = "unstandardized"


class PositionCategory(StrEnum):
    OPERATIONAL = "operational"
    ADMINISTRATIVE = "administrative"
    PEDAGOGICAL = "pedagogical"
    HAZARDOUS_TECHNICAL = "hazardous_technical"


class ServiceConditionCategory(StrEnum):
    """Категория условий службы — one of the `scope` dimensions that
    decides WHICH RuleVersion applies to this employee (Domain Model
    разд. 0: `Rule → Calculation → Employee`), which is why it lives on
    the employee rather than being derived at calculation time."""

    NORMAL = "normal"
    HAZARDOUS_OR_DANGEROUS = "hazardous_or_dangerous"
    PEDAGOGICAL = "pedagogical"


class LegalBase(StrEnum):
    """Правовое основание прохождения службы: сотрудник ФПС (ФЗ-141) либо
    работник по ТК РФ. Also a `scope` dimension — `openapi.yaml`'s own
    example of one: 'JSON-строка scope, например {"legalBase":"fps_service"}'."""

    FPS_SERVICE = "fps_service"
    LABOR_CODE = "labor_code"


class ServiceRecordEventType(StrEnum):
    ASSIGNMENT = "assignment"
    TRANSFER = "transfer"
    RANK_CHANGE = "rank_change"
    DISMISSAL = "dismissal"


_LTREE_LABEL = re.compile(r"^[A-Za-z0-9_]+$")


@dataclass(frozen=True, kw_only=True)
class HierarchyPath(ValueObject):
    """Materialized path of a `Unit` in the org tree — the domain-side
    counterpart of the `ltree` column (migration 0006).

    Held as a tuple of labels rather than a pre-joined string so that
    "is this unit under that one?" is answerable in the domain without
    string surgery; `as_ltree()` renders the dotted form the DB stores.

    **Labels are derived from unit ids, not unit codes**, and that choice
    is load-bearing rather than incidental. ltree labels admit only
    `[A-Za-z0-9_]`, while `Unit.code` is free text (`openapi.yaml`
    `CreateUnitRequest.code`: `maxLength: 50`, no pattern) — so a code has
    to be transformed before it can be a label, and every transformation
    that discards characters is non-injective: "ПЧ-12" and "ПЧ 12" both
    sanitize to the same label, which would give two distinct units the
    same path and quietly corrupt every subtree query. Ids need no
    transformation at all, are unique by construction, and — unlike codes
    — never change, so renaming a unit does not require rewriting the
    paths of everything beneath it.

    The readable identifiers are not lost: `code`, `name` and
    `parent_unit_id` all sit on the same row.
    """

    labels: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.labels:
            raise ValueError("HierarchyPath must contain at least one label")
        for label in self.labels:
            if not _LTREE_LABEL.match(label):
                raise ValueError(f"invalid ltree label: {label!r}")

    @staticmethod
    def label_for(unit_id: UUID) -> str:
        """`u` + the id's 32 hex digits. The `u` prefix keeps the label
        from ever starting with a digit, which is legal ltree but reads
        ambiguously in a dotted path."""
        return f"u{unit_id.hex}"

    @classmethod
    def root(cls, unit_id: UUID) -> HierarchyPath:
        return cls(labels=(cls.label_for(unit_id),))

    @classmethod
    def from_ltree(cls, value: str) -> HierarchyPath:
        return cls(labels=tuple(value.split(".")))

    def child(self, unit_id: UUID) -> HierarchyPath:
        return HierarchyPath(labels=(*self.labels, self.label_for(unit_id)))

    def as_ltree(self) -> str:
        return ".".join(self.labels)

    @property
    def depth(self) -> int:
        """`nlevel(hierarchy_path)` — the value `ck_unit_root_path`
        (migration 0006) constrains: exactly 1 for a root, >1 otherwise."""
        return len(self.labels)

    def is_ancestor_of(self, other: HierarchyPath) -> bool:
        """Domain-side equivalent of ltree's `@>`. Strict: a path is not
        its own ancestor."""
        return len(other.labels) > len(self.labels) and (
            other.labels[: len(self.labels)] == self.labels
        )

    def __composite_values__(self) -> tuple[str]:
        """Required by SQLAlchemy's `composite()` to decompose this VO back
        into the single `hierarchy_path` column on write — same convention
        as `legal_rules`' `LegalBasis`/`EffectivePeriod`."""
        return (self.as_ltree(),)
