"""Read-сторона `compensation`: таблица прогноза (миграция 0018).

Только `Table`, без `map_imperatively` — как и в `time_accounting`: у
проекции нет ни агрегата, ни инвариантов, ни поведения.
"""

from __future__ import annotations

from sqlalchemy import Column, Date, DateTime, Integer, MetaData, Numeric, Table
from sqlalchemy.dialects.postgresql import UUID as PgUUID

metadata = MetaData(schema="compensation")

regional_forecast_table = Table(
    "regional_compensation_forecast_projection",
    metadata,
    Column("region_unit_id", PgUUID(as_uuid=True), primary_key=True),
    Column("period_start", Date, primary_key=True),
    Column("period_end", Date, primary_key=True),
    Column("forecast_monetary_hours", Numeric(12, 2), nullable=False),
    Column("forecast_rest_days", Numeric(12, 2), nullable=False),
    Column("employee_count", Integer, nullable=False),
    Column("case_count", Integer, nullable=False),
    Column("computed_at", DateTime(timezone=True), nullable=False),
)
