"""SD003 — Data Mapper для `scheduling` (миграции 0012-0013).

Единственное, чего не было в предыдущих модулях, — `tstzrange`.

`PlannedShift.time_range` — это VO `TimeInterval` {start, end}, а в БД одна
колонка диапазона. SQLAlchemy 2.0 умеет `TSTZRANGE` и представляет
значение объектом `postgresql.Range`; asyncpg диапазоны поддерживает
нативно, поэтому в отличие от `ltree` (см. `personnel/orm_mapping.py`)
никаких обходных приведений к тексту здесь не нужно — достаточно
`TypeDecorator`, переводящего `Range` в VO и обратно.

Границы жёстко `'[)'`: полуоткрытый интервал — это семантика `TimeInterval`
(смена, кончающаяся в 08:00, и смена, начинающаяся в 08:00, не
пересекаются), и она обязана совпадать с тем, что проверяет
`excl_planned_shift_no_overlap`. Разойдись эти две стороны — пересменка
начала бы считаться пересечением или наоборот, и разница вылезла бы
ровно на суточных дежурствах, то есть на самом частом режиме ФПС.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Boolean, Column, Date, ForeignKey, Integer, MetaData, Table, Text
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import TSTZRANGE
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.dialects.postgresql import Range as PgRange
from sqlalchemy.orm import composite, registry, relationship
from sqlalchemy.types import TypeDecorator

from src.building_blocks.infrastructure.outbox import build_outbox_table
from src.modules.scheduling.domain.duty_schedule import DutySchedule, PlannedShift
from src.modules.scheduling.domain.value_objects import (
    AccountingPeriod,
    AccountingPeriodType,
    DutyType,
    ScheduleStatus,
    TimeInterval,
)

mapper_registry = registry()
metadata = MetaData(schema="scheduling")

outbox_message_table = build_outbox_table(metadata)

_period_type_enum = PgEnum(
    *[p.value for p in AccountingPeriodType],
    name="accounting_period_type",
    schema="scheduling",
    create_type=False,
)
_schedule_status_enum = PgEnum(
    *[s.value for s in ScheduleStatus],
    name="schedule_status",
    schema="scheduling",
    create_type=False,
)
_duty_type_enum = PgEnum(
    *[d.value for d in DutyType], name="duty_type", schema="scheduling", create_type=False
)


class _TimeIntervalType(TypeDecorator[TimeInterval]):
    """`tstzrange` <-> `TimeInterval`."""

    impl = TSTZRANGE
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, TimeInterval):
            return PgRange(value.start, value.end, bounds="[)")
        return value

    def process_result_value(self, value: Any, dialect: Any) -> TimeInterval | None:
        if value is None:
            return None
        # `ck_planned_shift_range_not_empty` (миграция 0012) не даёт пустому
        # или вывернутому диапазону попасть в таблицу, поэтому границы здесь
        # всегда есть — но `TimeInterval.__post_init__` всё равно перепроверит.
        return TimeInterval(start=value.lower, end=value.upper)


duty_schedule_table = Table(
    "duty_schedule",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column("unit_id", PgUUID(as_uuid=True), nullable=False),
    Column("period_type", _period_type_enum, nullable=False),
    Column("period_start", Date, nullable=False),
    Column("period_end", Date, nullable=False),
    Column("status", _schedule_status_enum, nullable=False),
    Column("approval_order_ref", Text, nullable=True),
    Column("revision_no", Integer, nullable=False),
    Column(
        "previous_schedule_id",
        PgUUID(as_uuid=True),
        ForeignKey("scheduling.duty_schedule.id"),
        nullable=True,
    ),
    Column("revision_reason", Text, nullable=True),
    # created_at: DB DEFAULT now(), доменом не читается.
)

planned_shift_table = Table(
    "planned_shift",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column(
        "duty_schedule_id",
        PgUUID(as_uuid=True),
        ForeignKey("scheduling.duty_schedule.id"),
        nullable=False,
    ),
    # Без внешнего ключа: ссылка на personnel.employee межсхемная
    # (PostgreSQL_Logical_Model разд. 10).
    Column("employee_id", PgUUID(as_uuid=True), nullable=False),
    Column("time_range", _TimeIntervalType, nullable=False),
    Column("duty_type", _duty_type_enum, nullable=False),
    Column("superseded", Boolean, nullable=False),
)


def _accounting_period_factory(
    period_type: Any, period_start: Any, period_end: Any
) -> AccountingPeriod:
    """`composite()` зовёт цель позиционно, а все VO в кодовой базе
    `kw_only=True` — тот же переходник, что `_effective_period_factory` в
    `legal_rules`."""
    return AccountingPeriod(
        period_type=AccountingPeriodType(period_type), start=period_start, end=period_end
    )


_mapped = False


def start_mappers() -> None:
    """Идемпотентно — тот же контракт, что и у остальных модулей."""
    global _mapped
    if _mapped:
        return

    mapper_registry.map_imperatively(PlannedShift, planned_shift_table)
    mapper_registry.map_imperatively(
        DutySchedule,
        duty_schedule_table,
        properties={
            "period": composite(
                _accounting_period_factory,
                duty_schedule_table.c.period_type,
                duty_schedule_table.c.period_start,
                duty_schedule_table.c.period_end,
            ),
            "shifts": relationship(
                PlannedShift,
                primaryjoin=(
                    duty_schedule_table.c.id == planned_shift_table.c.duty_schedule_id
                ),
                foreign_keys=[planned_shift_table.c.duty_schedule_id],
                order_by=planned_shift_table.c.time_range,
                cascade="all, delete-orphan",
                # Как и во всех агрегатах: `approve()` и `revise()` работают
                # со всем составом смен, и половинчато загруженный график
                # утвердил бы не то, что в нём есть.
                lazy="selectin",
            ),
        },
    )
    _mapped = True
