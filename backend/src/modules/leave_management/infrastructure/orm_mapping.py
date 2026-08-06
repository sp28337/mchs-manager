"""LM003 — Data Mapper для `leave_management` (миграция 0022).

`daterange` <-> `LeavePeriod` через `TypeDecorator`, как `tstzrange` <->
`TimeInterval` в `scheduling`. Границы `[)` задаются при записи явно:
именно они делают присоединение смежных отпусков не пересечением
(инвариант 9.1.1), и полагаться здесь на умолчание драйвера значило бы
поставить правовое требование в зависимость от версии библиотеки.

`EntitlementBasis` — композит: обоснование продолжительности хранится
рядом с самой продолжительностью, потому что порознь они не значат
ничего. Ссылка без числа дней не объясняет, сколько именно причиталось;
число без ссылки не объясняет, на каком основании.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, MetaData, Numeric, Table
from sqlalchemy.dialects.postgresql import DATERANGE
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.dialects.postgresql import Range as PgRange
from sqlalchemy.orm import composite, registry, relationship
from sqlalchemy.types import TypeDecorator

from src.building_blocks.infrastructure.outbox import build_outbox_table
from src.modules.leave_management.domain.leave_grant import LeaveGrant, RecallEvent
from src.modules.leave_management.domain.value_objects import (
    EntitlementBasis,
    LeavePeriod,
    LeaveStatus,
    LeaveType,
)

mapper_registry = registry()
metadata = MetaData(schema="leave_management")

outbox_message_table = build_outbox_table(metadata)


def _enum_values(enum_class: type[StrEnum]) -> list[str]:
    return [member.value for member in enum_class]


_leave_type_enum = PgEnum(
    LeaveType,
    name="leave_type",
    schema="leave_management",
    create_type=False,
    values_callable=_enum_values,
)
_leave_status_enum = PgEnum(
    LeaveStatus,
    name="leave_status",
    schema="leave_management",
    create_type=False,
    values_callable=_enum_values,
)


class _LeavePeriodType(TypeDecorator[LeavePeriod]):
    """`daterange` <-> `LeavePeriod`."""

    impl = DATERANGE
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, LeavePeriod):
            # `[)` явно: от этой границы зависит, считается ли
            # присоединение смежных отпусков пересечением.
            return PgRange(value.start, value.end, bounds="[)")
        return value

    def process_result_value(self, value: Any, dialect: Any) -> LeavePeriod | None:
        if value is None:
            return None
        return LeavePeriod(start=value.lower, end=value.upper)


leave_grant_table = Table(
    "leave_grant",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column("employee_id", PgUUID(as_uuid=True), nullable=False),
    Column("leave_type", _leave_type_enum, nullable=False),
    Column("leave_period", _LeavePeriodType(), nullable=False),
    Column("entitlement_basis_rule_version_id", PgUUID(as_uuid=True), nullable=False),
    Column("status", _leave_status_enum, nullable=False),
    Column("attached_rest_days", Numeric(6, 2), nullable=False),
    # ADDITIVE к логической модели: продолжительность, на которую было
    # право, и стаж, из которого она выведена. Без них пересчёт задним
    # числом дал бы другое число дней (ФЗ-141 ст. 58 ч. 3 ставит его в
    # зависимость от выслуги), и объяснить расхождение было бы нечем.
    Column("entitled_days", Integer, nullable=False),
    Column("seniority_years", Integer, nullable=True),
)

recall_event_table = Table(
    "recall_event",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column(
        "leave_grant_id",
        PgUUID(as_uuid=True),
        ForeignKey("leave_management.leave_grant.id"),
        nullable=False,
    ),
    Column("recall_date", Date, nullable=False),
    Column("effective_from", Date, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)


def _entitlement_factory(
    rule_version_id: object, entitled_days: object, seniority_years: object
) -> EntitlementBasis:
    return EntitlementBasis(
        rule_version_id=rule_version_id,  # type: ignore[arg-type]
        entitled_days=entitled_days,  # type: ignore[arg-type]
        seniority_years=seniority_years,  # type: ignore[arg-type]
    )


_mapped = False


def start_mappers() -> None:
    """Идемпотентно — тот же контракт, что и у остальных модулей."""
    global _mapped
    if _mapped:
        return

    mapper_registry.map_imperatively(RecallEvent, recall_event_table)
    mapper_registry.map_imperatively(
        LeaveGrant,
        leave_grant_table,
        properties={
            "period": leave_grant_table.c.leave_period,
            "entitlement": composite(
                _entitlement_factory,
                leave_grant_table.c.entitlement_basis_rule_version_id,
                leave_grant_table.c.entitled_days,
                leave_grant_table.c.seniority_years,
            ),
            "recalls": relationship(
                RecallEvent,
                primaryjoin=(
                    leave_grant_table.c.id == recall_event_table.c.leave_grant_id
                ),
                foreign_keys=[recall_event_table.c.leave_grant_id],
                order_by=recall_event_table.c.effective_from,
                cascade="all, delete-orphan",
                # `effective_end` считается по ВСЕМ отзывам: половинчато
                # загруженный агрегат сообщил бы неверный остаток, а
                # остаток — то, что сотруднику причитается.
                lazy="selectin",
            ),
        },
    )
    _mapped = True
