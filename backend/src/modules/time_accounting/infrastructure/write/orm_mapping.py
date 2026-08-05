"""TA005 — Data Mapper для write-стороны `time_accounting` (миграции
0014-0015).

Imperative mapping, как и во всех модулях: доменные классы
(`Timesheet`, `ServiceTimeEvent`, `CorrectionEntry`, `OvertimeOrder`) не
знают о SQLAlchemy вовсе (Backend_Architecture разд. 3.1).

Здесь впервые в кодовой базе агрегат состоит из ДВУХ коллекций дочерних
сущностей — фактов и исправлений, — и обе загружаются `selectin` по той
же причине, что смены в `scheduling`: `approve()` работает со всем
составом, а половинчато загруженный табель утвердил бы не то, что в нём
есть.

`employee_id` продублирован в `service_time_event` (см. п. 2 докстринга
миграции 0014). В маппинге он ЗАПОЛНЯЕТСЯ ДОМЕНОМ, а не БД:
`Timesheet.register_event` проставляет его из себя, поэтому составной
внешний ключ `(timesheet_id, employee_id)` для приложения — проверка, а
не источник значения.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Column, Date, DateTime, ForeignKey, MetaData, Table, Text
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import TSTZRANGE
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.dialects.postgresql import Range as PgRange
from sqlalchemy.orm import composite, registry, relationship
from sqlalchemy.types import TypeDecorator

from src.building_blocks.domain.time_interval import TimeInterval
from src.building_blocks.infrastructure.outbox import build_outbox_table
from src.modules.time_accounting.domain.overtime_order import OvertimeOrder
from src.modules.time_accounting.domain.timesheet import (
    CorrectionEntry,
    ServiceTimeEvent,
    Timesheet,
)
from src.modules.time_accounting.domain.value_objects import (
    AccountingPeriod,
    AccountingPeriodType,
    ServiceTimeEventType,
    TimesheetStatus,
)

mapper_registry = registry()
metadata = MetaData(schema="time_accounting")

outbox_message_table = build_outbox_table(metadata)

# Перечисления объявлены ЧЕРЕЗ КЛАСС, а не через список значений, и это
# не стилистика.
#
# `PgEnum(*[e.value for e in E], ...)` — форма, применённая в остальных
# модулях, — возвращает из БД голые строки. Для сравнений `==` это
# незаметно (`StrEnum` сравнивается со строкой), но у `ServiceTimeEvent`
# есть свойства `counts_as_service_time` / `is_explained_absence`, которые
# спрашивают у значения его СОБСТВЕННЫЙ атрибут. На загруженном из БД
# табеле это падало с `'str' object has no attribute
# 'counts_as_service_time'` — то есть Алгоритм В не мог разделить события
# на группы ровно тогда, когда работал с сохранёнными данными.
#
# `values_callable` нужен, чтобы SQLAlchemy писал в БД `.value`
# (`actual_shift`), а не имя члена (`ACTUAL_SHIFT`) — иначе тип в БД и тип
# в коде разошлись бы уже при вставке.
_ENUM_VALUES = lambda enum_class: [member.value for member in enum_class]  # noqa: E731

_timesheet_status_enum = PgEnum(
    TimesheetStatus,
    name="timesheet_status",
    schema="time_accounting",
    create_type=False,
    values_callable=_ENUM_VALUES,
)
_event_type_enum = PgEnum(
    ServiceTimeEventType,
    name="service_time_event_type",
    schema="time_accounting",
    create_type=False,
    values_callable=_ENUM_VALUES,
)
_period_type_enum = PgEnum(
    AccountingPeriodType,
    name="accounting_period_type",
    schema="time_accounting",
    create_type=False,
    values_callable=_ENUM_VALUES,
)


class _TimeIntervalType(TypeDecorator[TimeInterval]):
    """`tstzrange` <-> `TimeInterval`, границы жёстко `'[)'`.

    Копия того же типа из `scheduling`, и это осознанно НЕ вынесено в
    общее место: `TypeDecorator` — деталь инфраструктуры модуля, а не
    часть общего языка. Общим сделан сам VO (`building_blocks`), потому
    что расходиться не должна СЕМАНТИКА; способ же положить его в колонку
    каждый модуль волен иметь свой, и завтра один из них может хранить
    интервал иначе, не ломая второй.
    """

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
        return TimeInterval(start=value.lower, end=value.upper)


timesheet_table = Table(
    "timesheet",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column("employee_id", PgUUID(as_uuid=True), nullable=False),
    Column("period_type", _period_type_enum, nullable=False),
    Column("period_start", Date, nullable=False),
    Column("period_end", Date, nullable=False),
    Column("status", _timesheet_status_enum, nullable=False),
    # created_at: DB DEFAULT now(), доменом не читается.
)

overtime_order_table = Table(
    "overtime_order",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column("order_number", Text, nullable=False),
    Column("issued_date", Date, nullable=False),
    Column("issued_by", PgUUID(as_uuid=True), nullable=False),
    Column("reason", Text, nullable=False),
)

service_time_event_table = Table(
    "service_time_event",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column(
        "timesheet_id",
        PgUUID(as_uuid=True),
        ForeignKey("time_accounting.timesheet.id"),
        nullable=False,
    ),
    Column("employee_id", PgUUID(as_uuid=True), nullable=False),
    Column("event_type", _event_type_enum, nullable=False),
    Column("time_range", _TimeIntervalType, nullable=False),
    # Ссылка на scheduling.planned_shift без ForeignKey: межсхемная
    # (PostgreSQL_Logical_Model разд. 10, см. п. 3(а) миграции 0014).
    Column("planned_shift_id", PgUUID(as_uuid=True), nullable=True),
    Column(
        "overtime_order_id",
        PgUUID(as_uuid=True),
        ForeignKey("time_accounting.overtime_order.id"),
        nullable=True,
    ),
    Column("business_trip_place", Text, nullable=True),
)

correction_entry_table = Table(
    "correction_entry",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column(
        "timesheet_id",
        PgUUID(as_uuid=True),
        ForeignKey("time_accounting.timesheet.id"),
        nullable=False,
    ),
    Column(
        "original_event_id",
        PgUUID(as_uuid=True),
        ForeignKey("time_accounting.service_time_event.id"),
        nullable=False,
    ),
    Column("reason", Text, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("created_by", PgUUID(as_uuid=True), nullable=False),
)


def _accounting_period_factory(
    period_type: Any, period_start: Any, period_end: Any
) -> AccountingPeriod:
    """`composite()` зовёт цель позиционно, а все VO кодовой базы
    `kw_only=True`."""
    return AccountingPeriod(
        period_type=AccountingPeriodType(period_type), start=period_start, end=period_end
    )


_mapped = False


def start_mappers() -> None:
    """Идемпотентно — тот же контракт, что и у остальных модулей."""
    global _mapped
    if _mapped:
        return

    mapper_registry.map_imperatively(ServiceTimeEvent, service_time_event_table)
    mapper_registry.map_imperatively(CorrectionEntry, correction_entry_table)
    mapper_registry.map_imperatively(OvertimeOrder, overtime_order_table)
    mapper_registry.map_imperatively(
        Timesheet,
        timesheet_table,
        properties={
            "period": composite(
                _accounting_period_factory,
                timesheet_table.c.period_type,
                timesheet_table.c.period_start,
                timesheet_table.c.period_end,
            ),
            "events": relationship(
                ServiceTimeEvent,
                primaryjoin=(
                    timesheet_table.c.id == service_time_event_table.c.timesheet_id
                ),
                foreign_keys=[service_time_event_table.c.timesheet_id],
                order_by=service_time_event_table.c.time_range,
                cascade="all, delete-orphan",
                lazy="selectin",
            ),
            "corrections": relationship(
                CorrectionEntry,
                primaryjoin=(timesheet_table.c.id == correction_entry_table.c.timesheet_id),
                foreign_keys=[correction_entry_table.c.timesheet_id],
                order_by=correction_entry_table.c.created_at,
                cascade="all, delete-orphan",
                lazy="selectin",
            ),
        },
    )
    _mapped = True
