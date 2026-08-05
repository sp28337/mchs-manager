"""PE004 — Data Mapper for `personnel`: maps the plain-dataclass domain
objects (domain/*.py) onto the already-migrated `personnel.*` tables
(migrations 0006-0008) via `registry.map_imperatively()`, exactly as
`legal_rules/infrastructure/write/orm_mapping.py` does and for the same
reason (Backend_Architecture разд. 3.1 — the domain classes stay plain
dataclasses; SQLAlchemy is told about the mapping from here, never the
other way around).

This module does not define the schema, it describes it. Columns with a
DB-side DEFAULT the domain never reads back (`unit.created_at`,
`employee.created_at`) are deliberately absent from their `Table()`;
`create_type=False` on every native-enum column is mandatory, since the
enum TYPEs were created by raw DDL in migration 0006 and SQLAlchemy must
never attempt to CREATE TYPE again.

Two things here that `legal_rules` did not need:

**`ltree`.** SQLAlchemy has no built-in `ltree` type and asyncpg has no
codec for it, so a bare bind parameter against an `ltree` column fails to
encode. `_HierarchyPathType` sidesteps that entirely rather than
registering a driver-level codec: the value crosses the wire as plain
text in both directions — `CAST(%(param)s AS ltree)` on write
(`bind_expression`) and `hierarchy_path::text` on read
(`column_expression`) — so neither SQLAlchemy nor asyncpg ever has to
understand the type. The DB column stays a real `ltree`, which is what
the GiST index and the `@>`/`<@` operators need.

**`position` is a reserved word.** The table is `personnel."position"`
(see migration 0006). SQLAlchemy quotes it automatically from the plain
`"position"` name given below — the quoting lives in the DDL and the
dialect, never in the domain class, which is just `Position`.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import (
    Column,
    Date,
    DateTime,
    ForeignKey,
    MetaData,
    Table,
    Text,
    cast,
)
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import registry, relationship
from sqlalchemy.sql.elements import ColumnElement
from sqlalchemy.types import TypeDecorator, UserDefinedType

from src.building_blocks.infrastructure.outbox import build_outbox_table
from src.modules.personnel.domain.employee import Employee
from src.modules.personnel.domain.position import Position
from src.modules.personnel.domain.service_record import SecondaryAssignment, ServiceRecordEntry
from src.modules.personnel.domain.unit import Unit
from src.modules.personnel.domain.value_objects import (
    EmploymentStatus,
    HierarchyPath,
    LegalBase,
    PositionCategory,
    RegimeType,
    ServiceConditionCategory,
    ServiceRecordEventType,
)

mapper_registry = registry()
metadata = MetaData(schema="personnel")

# Transactional Outbox (Architecture разд. 9.2). Форма таблицы общая для
# всех модулей — описывается один раз в building_blocks, создаётся
# миграцией 0010. Здесь она попадает в MetaData ЭТОГО модуля, чтобы
# запись события шла той же сессией и той же транзакцией, что и
# изменение агрегата.
outbox_message_table = build_outbox_table(metadata)

_employment_status_enum = PgEnum(
    *[s.value for s in EmploymentStatus],
    name="employment_status",
    schema="personnel",
    create_type=False,
)
_regime_type_enum = PgEnum(
    *[r.value for r in RegimeType], name="regime_type", schema="personnel", create_type=False
)
_position_category_enum = PgEnum(
    *[c.value for c in PositionCategory],
    name="position_category",
    schema="personnel",
    create_type=False,
)
_service_condition_category_enum = PgEnum(
    *[c.value for c in ServiceConditionCategory],
    name="service_condition_category",
    schema="personnel",
    create_type=False,
)
_legal_base_enum = PgEnum(
    *[b.value for b in LegalBase], name="legal_base", schema="personnel", create_type=False
)
_service_record_event_type_enum = PgEnum(
    *[e.value for e in ServiceRecordEventType],
    name="service_record_event_type",
    schema="personnel",
    create_type=False,
)


class _RawLtree(UserDefinedType[str]):
    """Renders the bare SQL type name so `CAST(... AS ltree)` can be
    written. Never used as a column type itself — only as a cast target."""

    cache_ok = True

    def get_col_spec(self, **kw: Any) -> str:
        return "ltree"


class _HierarchyPathType(TypeDecorator[HierarchyPath]):
    """`ltree` <-> `HierarchyPath` VO. See the module docstring for why the
    value is cast to/from text at the SQL level rather than taught to the
    driver."""

    impl = Text
    cache_ok = True

    def bind_expression(self, bindparam: Any) -> ColumnElement[Any]:
        return cast(bindparam, _RawLtree())

    def column_expression(self, colexpr: Any) -> ColumnElement[Any]:
        # `cast(colexpr, self)`, NOT `cast(colexpr, Text)`: the cast's own
        # type is what governs result processing, so casting to a bare
        # `Text` would render the right SQL and then hand back a plain
        # string, silently skipping `process_result_value` — a loaded
        # `Unit.hierarchy_path` would be `str` while a freshly built one
        # is a `HierarchyPath`. Casting to the decorator itself renders
        # identically (`TypeDecorator` compiles as its `impl`) and keeps
        # the conversion.
        return cast(colexpr, self)

    def process_bind_param(self, value: Any, dialect: Any) -> Any:
        return value.as_ltree() if isinstance(value, HierarchyPath) else value

    def process_result_value(self, value: Any, dialect: Any) -> HierarchyPath | None:
        return HierarchyPath.from_ltree(value) if value is not None else None


unit_table = Table(
    "unit",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column("code", Text, nullable=False, unique=True),
    Column("name", Text, nullable=False),
    Column("parent_unit_id", PgUUID(as_uuid=True), ForeignKey("personnel.unit.id"), nullable=True),
    Column("hierarchy_path", _HierarchyPathType, nullable=False),
    Column("time_zone", Text, nullable=False),
    # created_at: DB DEFAULT now(), never read/written by the domain.
)

position_table = Table(
    "position",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column("code", Text, nullable=False, unique=True),
    Column("title", Text, nullable=False),
    Column("category", _position_category_enum, nullable=False),
    Column("default_regime_type", _regime_type_enum, nullable=False),
)

employee_table = Table(
    "employee",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column("personnel_number", Text, nullable=False, unique=True),
    Column("full_name", Text, nullable=False),
    Column("rank", Text, nullable=False),
    Column("legal_base", _legal_base_enum, nullable=False),
    Column("service_condition_category", _service_condition_category_enum, nullable=False),
    Column(
        "current_position_id",
        PgUUID(as_uuid=True),
        ForeignKey("personnel.position.id"),
        nullable=False,
    ),
    Column(
        "current_unit_id", PgUUID(as_uuid=True), ForeignKey("personnel.unit.id"), nullable=False
    ),
    Column("hired_at", Date, nullable=False),
    Column("employment_status", _employment_status_enum, nullable=False),
    Column("dismissed_at", Date, nullable=True),
)

service_record_entry_table = Table(
    "service_record_entry",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column(
        "employee_id", PgUUID(as_uuid=True), ForeignKey("personnel.employee.id"), nullable=False
    ),
    Column("event_type", _service_record_event_type_enum, nullable=False),
    Column("effective_date", Date, nullable=False),
    Column("position_id", PgUUID(as_uuid=True), ForeignKey("personnel.position.id"), nullable=True),
    Column("unit_id", PgUUID(as_uuid=True), ForeignKey("personnel.unit.id"), nullable=True),
    Column("rank", Text, nullable=True),
    Column("recorded_at", DateTime(timezone=True), nullable=False),
)

secondary_assignment_table = Table(
    "secondary_assignment",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column(
        "employee_id", PgUUID(as_uuid=True), ForeignKey("personnel.employee.id"), nullable=False
    ),
    Column(
        "position_id", PgUUID(as_uuid=True), ForeignKey("personnel.position.id"), nullable=False
    ),
    Column("unit_id", PgUUID(as_uuid=True), ForeignKey("personnel.unit.id"), nullable=False),
    Column("valid_from", Date, nullable=False),
    Column("valid_to", Date, nullable=True),
)


_mapped = False


def start_mappers() -> None:
    """Idempotent — same contract, and same reason, as `legal_rules`'
    `start_mappers()`: several independent call sites (Composition's
    `di.py`, every integration test module) may legitimately call it, and
    SQLAlchemy raises on a second mapping of the same class."""
    global _mapped
    if _mapped:
        return

    # No `composite()` for `hierarchy_path`, unlike `legal_rules`'
    # `EffectivePeriod`/`LegalBasis`: a composite exists to assemble ONE
    # VO out of SEVERAL columns, and `HierarchyPath` maps to exactly one.
    # `_HierarchyPathType` already converts in both directions at the type
    # level, so a composite over the same single column would only collide
    # with it (SQLAlchemy rejects the pair outright).
    mapper_registry.map_imperatively(Unit, unit_table)
    mapper_registry.map_imperatively(Position, position_table)
    mapper_registry.map_imperatively(ServiceRecordEntry, service_record_entry_table)
    mapper_registry.map_imperatively(SecondaryAssignment, secondary_assignment_table)
    mapper_registry.map_imperatively(
        Employee,
        employee_table,
        properties={
            # Both collections are `cascade="all, delete-orphan"` +
            # `lazy="selectin"` for the same reason the `Rule.versions`
            # relationship is: they are INSIDE the aggregate boundary, so
            # they are always loaded with their root and never
            # independently — an `Employee` without its service record is
            # not a valid `Employee` to apply a domain method to.
            "service_record": relationship(
                ServiceRecordEntry,
                order_by=service_record_entry_table.c.effective_date,
                cascade="all, delete-orphan",
                lazy="selectin",
            ),
            "secondary_assignments": relationship(
                SecondaryAssignment,
                order_by=secondary_assignment_table.c.valid_from,
                cascade="all, delete-orphan",
                lazy="selectin",
            ),
        },
    )
    _mapped = True
