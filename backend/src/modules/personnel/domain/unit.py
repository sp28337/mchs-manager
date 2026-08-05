"""`Unit` aggregate — Domain_Model_DDD_Sluzhebnoe_Vremya_FPS.md разд. 3.

Организационное подразделение ФПС. A `Unit` is its own aggregate, not a
node inside one big "org tree" aggregate: the tree spans the whole
country, so loading it as a single consistency boundary to rename one
station would be absurd. What holds the tree together instead is the
materialized path (`HierarchyPath` / `ltree`), which each unit carries a
copy of.

Consequence, and it is deliberate: `create_child()` takes the parent
`Unit` transiently, only to read its `code`/`hierarchy_path`, and stores
nothing but `parent_unit_id` — Domain Model разд. 1.1: "ни один агрегат
не хранит ссылку на объект другого агрегата целиком".
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID, uuid4

from src.building_blocks.domain.aggregate_root import AggregateRoot
from src.modules.personnel.domain.value_objects import HierarchyPath


@dataclass(eq=False, kw_only=True)
class Unit(AggregateRoot):
    code: str
    name: str
    parent_unit_id: UUID | None = None
    hierarchy_path: HierarchyPath

    @classmethod
    def create_root(cls, *, code: str, name: str) -> Unit:
        """A root unit (МЧС России / региональный центр) — `nlevel == 1`,
        which `ck_unit_root_path` (migration 0006) requires of exactly the
        rows whose `parent_unit_id` is NULL."""
        unit_id = uuid4()
        return cls(
            id=unit_id,
            code=code,
            name=name,
            parent_unit_id=None,
            hierarchy_path=HierarchyPath.root(unit_id),
        )

    @classmethod
    def create_child(cls, *, code: str, name: str, parent: Unit) -> Unit:
        """Path is derived from the parent's, never supplied by the caller —
        a caller-supplied path could disagree with `parent_unit_id`, and
        the two are meant to be one fact stored twice, not two facts."""
        unit_id = uuid4()
        return cls(
            id=unit_id,
            code=code,
            name=name,
            parent_unit_id=parent.id,
            hierarchy_path=parent.hierarchy_path.child(unit_id),
        )

    @property
    def is_root(self) -> bool:
        return self.parent_unit_id is None

    def contains(self, other: Unit) -> bool:
        """"Находится ли `other` где-то под этим подразделением" — the
        `unit_scope` question every authorization check asks
        (API_Conventions разд. 2: JWT carries `unit_scope[]`, row-level
        checks are the Application layer's job). Answered from the path
        alone, with no repository round-trip."""
        return self.hierarchy_path.is_ancestor_of(other.hierarchy_path)
