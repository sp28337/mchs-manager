"""Read-сторона `time_accounting`: таблица проекции (миграции 0015-0016).

Только `Table`, без `map_imperatively`. Это не упущение, а свойство
CQRS-стороны чтения (Architecture разд. 8.2): у проекции нет ни агрегата,
ни инвариантов, ни поведения — она денормализованный ответ на вопрос.
Маппить её на доменный класс значило бы завести второй объект, изображающий
`HoursBreakdown`, и обязательно однажды разойтись с ним.

Отдельный `MetaData` от write-стороны — по той же причине: две стороны
модуля физически разделены, и общий `MetaData` позволил бы, например,
`relationship` из агрегата в проекцию, то есть ровно то, что разделение
запрещает.
"""

from __future__ import annotations

from sqlalchemy import Column, Date, DateTime, MetaData, Numeric, Table, Text
from sqlalchemy.dialects.postgresql import UUID as PgUUID

metadata = MetaData(schema="time_accounting")

hours_breakdown_projection_table = Table(
    "hours_breakdown_projection",
    metadata,
    Column("timesheet_id", PgUUID(as_uuid=True), primary_key=True),
    Column("employee_id", PgUUID(as_uuid=True), nullable=False),
    Column("period_start", Date, nullable=False),
    Column("period_end", Date, nullable=False),
    Column("norm_hours", Numeric(8, 2), nullable=False),
    Column("actual_hours", Numeric(8, 2), nullable=False),
    Column("night_hours", Numeric(8, 2), nullable=False),
    Column("holiday_hours", Numeric(8, 2), nullable=False),
    Column("weekend_hours", Numeric(8, 2), nullable=False),
    Column("overtime_hours", Numeric(8, 2), nullable=False),
    Column("underworked_hours", Numeric(8, 2), nullable=False),
    Column("underworked_explained_hours", Numeric(8, 2), nullable=False),
    Column("computed_from_rule_version_id", PgUUID(as_uuid=True), nullable=False),
    Column("used_conflict_policy_version_id", PgUUID(as_uuid=True), nullable=True),
    Column("computed_from_legal_base", Text, nullable=False),
    Column("computed_in_time_zone", Text, nullable=False),
    Column("computed_at", DateTime(timezone=True), nullable=False),
)
