"""Таблицы `shift_accounting` (миграция 0001).

Core-таблицы без императивного маппинга на домен: агрегатов здесь нет,
есть профиль-запись и два списка при нём. Data Mapper поверх трёх плоских
таблиц дал бы слой, которому нечего скрывать.
"""

from __future__ import annotations

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    MetaData,
    Numeric,
    SmallInteger,
    String,
    Table,
    func,
)
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import UUID as PgUUID

metadata = MetaData(schema="shift_accounting")

employment_kind_enum = PgEnum(
    "attested", "civilian", name="employment_kind", schema="shift_accounting",
    create_type=False,
)
gender_enum = PgEnum(
    "male", "female", name="gender", schema="shift_accounting", create_type=False
)
working_conditions_enum = PgEnum(
    "normal", "harmful_or_dangerous", name="working_conditions",
    schema="shift_accounting", create_type=False,
)
day_type_enum = PgEnum(
    "working", "weekend", "holiday", "pre_holiday",
    name="day_type", schema="service_calendar", create_type=False,
)

absence_kind_enum = PgEnum(
    "annual_leave", "sick_leave", "study_leave", "unpaid_leave",
    "business_trip", "other_excused",
    name="absence_kind", schema="shift_accounting", create_type=False,
)

profile_table = Table(
    "profile",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column("display_name", String(200), nullable=False),
    Column("employment_kind", employment_kind_enum, nullable=False),
    Column("gender", gender_enum, nullable=False),
    Column("working_conditions", working_conditions_enum, nullable=False),
    Column("northern_locality", Boolean, nullable=False),
    Column("disability_i_or_ii", Boolean, nullable=False),
    Column("guard_number", SmallInteger, nullable=False),
    Column("first_shift_date", Date, nullable=False),
    Column("accounting_year", Integer, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

absence_table = Table(
    "absence",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column(
        "profile_id",
        PgUUID(as_uuid=True),
        ForeignKey("shift_accounting.profile.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("kind", absence_kind_enum, nullable=False),
    Column("starts_on", Date, nullable=False),
    Column("ends_on", Date, nullable=False),
    Column("note", String(500)),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)

calendar_override_table = Table(
    "calendar_override",
    metadata,
    Column(
        "profile_id",
        PgUUID(as_uuid=True),
        ForeignKey("shift_accounting.profile.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("day", Date, primary_key=True),
    Column("day_type", day_type_enum, nullable=False),
)

reported_timesheet_table = Table(
    "reported_timesheet",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column(
        "profile_id",
        PgUUID(as_uuid=True),
        ForeignKey("shift_accounting.profile.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("period_start", Date, nullable=False),
    Column("period_end", Date, nullable=False),
    Column("norm_hours", Numeric(8, 2)),
    Column("actual_hours", Numeric(8, 2)),
    Column("overtime_hours", Numeric(8, 2)),
    Column("recorded_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
)
