"""SC002 — Data Mapper for `service_calendar`: maps the plain-dataclass
domain objects onto the already-migrated `service_calendar.*` tables
(migration 0009) via `registry.map_imperatively()` (Backend_Architecture
разд. 3.1).

One thing here that neither `legal_rules` nor `personnel` needed: the
`calendar_day -> calendar_year` foreign key is COMPOSITE
(`(calendar_year_id, year)` -> `(id, year)`, migration 0009 guarantee 1),
so the relationship below spells out `foreign_keys`/`primaryjoin`
explicitly. SQLAlchemy can infer a single-column FK on its own; with two
columns, one of which (`year`) is also a plain mapped attribute on both
sides, leaving it to inference produces an ambiguous-join error rather
than a wrong guess — so it is stated.
"""

from __future__ import annotations

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKeyConstraint,
    Integer,
    MetaData,
    Table,
)
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import registry, relationship

from src.building_blocks.infrastructure.outbox import build_outbox_table
from src.modules.service_calendar.domain.calendar_year import CalendarDay, CalendarYear
from src.modules.service_calendar.domain.value_objects import DayType

mapper_registry = registry()
metadata = MetaData(schema="service_calendar")

# Transactional Outbox (Architecture разд. 9.2). Форма таблицы общая для
# всех модулей — описывается один раз в building_blocks, создаётся
# миграцией 0010. Здесь она попадает в MetaData ЭТОГО модуля, чтобы
# запись события шла той же сессией и той же транзакцией, что и
# изменение агрегата.
outbox_message_table = build_outbox_table(metadata)

# The enum's values as plain strings. Exported so the public Contract can
# zero-fill its per-type counts without importing `domain.DayType` — the
# Contract deals in strings by design (see its docstring).
DAY_TYPE_VALUES: tuple[str, ...] = tuple(d.value for d in DayType)

_day_type_enum = PgEnum(
    *DAY_TYPE_VALUES, name="day_type", schema="service_calendar", create_type=False
)

calendar_year_table = Table(
    "calendar_year",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column("year", Integer, nullable=False, unique=True),
    Column("published", Boolean, nullable=False),
    Column("published_at", DateTime(timezone=True), nullable=True),
    # created_at: DB DEFAULT now(), never read/written by the domain.
)

calendar_day_table = Table(
    "calendar_day",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column("calendar_year_id", PgUUID(as_uuid=True), nullable=False),
    Column("year", Integer, nullable=False),
    Column("day", Date, nullable=False),
    Column("day_type", _day_type_enum, nullable=False),
    ForeignKeyConstraint(
        ["calendar_year_id", "year"],
        ["service_calendar.calendar_year.id", "service_calendar.calendar_year.year"],
        name="fk_calendar_day_year",
    ),
)

_mapped = False


def start_mappers() -> None:
    """Idempotent — same contract, and same reason, as the other modules'."""
    global _mapped
    if _mapped:
        return

    mapper_registry.map_imperatively(CalendarDay, calendar_day_table)
    mapper_registry.map_imperatively(
        CalendarYear,
        calendar_year_table,
        properties={
            "days": relationship(
                CalendarDay,
                primaryjoin=calendar_year_table.c.id == calendar_day_table.c.calendar_year_id,
                foreign_keys=[calendar_day_table.c.calendar_year_id],
                order_by=calendar_day_table.c.day,
                cascade="all, delete-orphan",
                # `selectin`, like every other aggregate here: a
                # `CalendarYear` without its days cannot answer
                # `is_complete`, which `publish()` depends on — a
                # half-loaded one would publish a year with a gap.
                lazy="selectin",
            ),
        },
    )
    _mapped = True
