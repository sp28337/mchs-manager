"""Data Mapper: maps the plain-dataclass `Rule`/`RuleVersion` domain
objects (domain/rule.py) onto the already-migrated
`legal_rules.rule`/`legal_rules.rule_version` tables (migrations 0002-0005)
via `registry.map_imperatively()` — Backend_Architecture_FastAPI_Stack_FPS.md
разд. 3.1: the domain classes stay plain dataclasses, SQLAlchemy is told
about the mapping from here, never the other way around (no
`Mapped`/`mapped_column` inside `domain/rule.py`).

Imperative-mapping + composite() syntax verified against Context7
(/websites/sqlalchemy_en_20, orm/dataclasses.html and orm/composites.html).

Table columns mirror PostgreSQL_Logical_Model_FPS.md разд. 1.4-1.5 (+
migration 0005's `description` column) exactly — this file does not
redefine the schema, only describes it to SQLAlchemy so the ORM can
read/write rows the migrations already created. `create_type=False` on
every native-enum column is mandatory: the enum TYPEs were created by raw
DDL in migration 0002, and SQLAlchemy must never attempt to CREATE TYPE
again (would fail on every subsequent run/test).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, MetaData, Table, Text
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import composite, registry, relationship
from sqlalchemy.types import TypeDecorator

from src.modules.legal_rules.domain.rule import Rule, RuleVersion
from src.modules.legal_rules.domain.value_objects import LegalBasis, RuleCategory, RuleStatus, Scope

mapper_registry = registry()
metadata = MetaData(schema="legal_rules")

_rule_category_enum = PgEnum(
    *[c.value for c in RuleCategory], name="rule_category", schema="legal_rules", create_type=False
)
_rule_status_enum = PgEnum(
    *[s.value for s in RuleStatus], name="rule_status", schema="legal_rules", create_type=False
)


class _ScopeType(TypeDecorator[Scope]):
    """jsonb <-> `Scope` VO. The `scope_key` generated column
    (`GENERATED ALWAYS AS (scope::text) STORED`) is intentionally NOT
    mapped here — it's read-only and DB-computed; the EXCLUDE constraint
    that consumes it operates purely at the SQL level and the ORM never
    needs to write it."""

    impl = JSONB
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> Any:
        return value.as_dict() if isinstance(value, Scope) else value

    def process_result_value(self, value: Any, dialect: Any) -> Scope | None:
        return Scope.from_dict(value) if value is not None else None


class _OpaqueJsonType(TypeDecorator[Any]):
    """jsonb <-> plain Python dict/list, used for `formula_definition` —
    the domain treats this as an opaque blob (see rule.py docstring); only
    Rule Engine (RE005 `Action`) knows how to interpret its shape."""

    impl = JSONB
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> Any:
        return value

    def process_result_value(self, value: Any, dialect: Any) -> Any:
        return value


rule_table = Table(
    "rule",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column("code", Text, nullable=False, unique=True),
    Column("category", _rule_category_enum, nullable=False),
    Column("display_name", Text, nullable=False),
    Column("description", Text, nullable=True),
)

rule_version_table = Table(
    "rule_version",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column("rule_id", PgUUID(as_uuid=True), ForeignKey("legal_rules.rule.id"), nullable=False),
    Column("version_no", Integer, nullable=False),
    Column("scope", _ScopeType, nullable=False),
    # scope_key: GENERATED column, deliberately absent from this mapping.
    Column("legal_basis_node_id", PgUUID(as_uuid=True), nullable=False),
    Column("formula_definition", _OpaqueJsonType, nullable=False),
    Column("valid_from", Date, nullable=False),
    Column("valid_to", Date, nullable=True),
    Column("status", _rule_status_enum, nullable=False),
    Column("published_at", DateTime(timezone=True), nullable=True),
    Column("published_by", PgUUID(as_uuid=True), nullable=True),
)


def _legal_basis_factory(node_id: Any) -> LegalBasis:
    """`composite()` invokes its target positionally (Context7
    /websites/sqlalchemy_en_20, orm/composites.html, "Custom Factory
    Methods") — but every VO in this codebase is `kw_only=True`
    (building_blocks/domain/value_object.py convention), so `LegalBasis`
    itself can't be passed directly to `composite()`. This thin factory
    bridges the two calling conventions."""
    return LegalBasis(node_id=node_id)


def start_mappers() -> None:
    """Idempotent-by-caller: call exactly once per process (Composition
    Root / test fixture), mirroring the Data Mapper pattern's usual
    lifecycle. Calling twice raises SQLAlchemy's own
    `ArgumentError: Class ... already has a primary mapper defined`."""
    mapper_registry.map_imperatively(
        RuleVersion,
        rule_version_table,
        properties={
            "legal_basis": composite(
                _legal_basis_factory, rule_version_table.c.legal_basis_node_id
            ),
        },
    )
    mapper_registry.map_imperatively(
        Rule,
        rule_table,
        properties={
            "versions": relationship(
                RuleVersion,
                order_by=rule_version_table.c.version_no,
                cascade="all, delete-orphan",
                lazy="selectin",
            ),
        },
    )
