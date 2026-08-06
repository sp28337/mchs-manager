"""RB003 — Data Mapper для `rest_balance` (миграция 0021).

--- У агрегата нет своей таблицы, и это не упущение --------------------

`RestDaysBalance` — область действия «один сотрудник за всю службу», и
собственного состояния у него нет: он целиком выводится из журнала
движений. Таблица `rest_balance_balance` содержала бы одну колонку
`employee_id`, дублирующую `personnel.employee`, и ни одного факта сверх
неё.

Поэтому маппится только `BalanceMovement`, а агрегат собирается
репозиторием из выборки движений. Так же устроен и остаток: он не
колонка, а сумма (см. докстринг миграции 0021).

--- Что не маппится ----------------------------------------------------

`RestDays` и `MovementGround` — композиты, а не отдельные колонки:
величина живёт в `amount_days`, основание — в паре
`compensation_line_id`/`leave_grant_id`. Композит нужен, чтобы агрегат
получал из БД те же типы, которыми оперирует в памяти, — иначе
`movement.amount.days` на загруженном движении падал бы с
`AttributeError`, ровно как это было с `PgEnum` в `time_accounting`.

`current_balance` (материализованное представление) здесь тоже не
объявлено: его читает запрос остатка напрямую (`read_orm_mapping`), а
агрегату оно не нужно — он считает по журналу, и только так проверка
инварианта 8.1.1 остаётся честной.
"""

from __future__ import annotations

from enum import StrEnum

from sqlalchemy import Column, Date, DateTime, ForeignKey, MetaData, Numeric, Table, Text
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import composite, registry

from src.building_blocks.infrastructure.outbox import build_outbox_table
from src.modules.rest_balance.domain.balance import BalanceMovement
from src.modules.rest_balance.domain.value_objects import (
    MovementGround,
    MovementType,
    RestDays,
)

mapper_registry = registry()
metadata = MetaData(schema="rest_balance")

outbox_message_table = build_outbox_table(metadata)


def _enum_values(enum_class: type[StrEnum]) -> list[str]:
    return [member.value for member in enum_class]


_movement_type_enum = PgEnum(
    MovementType,
    name="movement_type",
    schema="rest_balance",
    create_type=False,
    values_callable=_enum_values,
)

balance_movement_table = Table(
    "balance_movement",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column("employee_id", PgUUID(as_uuid=True), nullable=False),
    Column("movement_type", _movement_type_enum, nullable=False),
    Column("amount_days", Numeric(6, 2), nullable=False),
    Column("movement_date", Date, nullable=False),
    Column("compensation_line_id", PgUUID(as_uuid=True), nullable=True),
    Column("leave_grant_id", PgUUID(as_uuid=True), nullable=True),
    Column(
        "reverses_movement_id",
        PgUUID(as_uuid=True),
        ForeignKey("rest_balance.balance_movement.id"),
        nullable=True,
    ),
    Column("reversal_reason", Text, nullable=True),
    Column("created_at", DateTime(timezone=True), nullable=False),
)


def _amount_factory(amount_days: object) -> RestDays:
    return RestDays(days=amount_days)  # type: ignore[arg-type]


def _ground_factory(compensation_line_id: object, leave_grant_id: object) -> MovementGround:
    return MovementGround(
        compensation_line_id=compensation_line_id,  # type: ignore[arg-type]
        leave_grant_id=leave_grant_id,  # type: ignore[arg-type]
    )


_mapped = False


def start_mappers() -> None:
    """Идемпотентно — тот же контракт, что и у остальных модулей."""
    global _mapped
    if _mapped:
        return

    mapper_registry.map_imperatively(
        BalanceMovement,
        balance_movement_table,
        properties={
            "amount": composite(_amount_factory, balance_movement_table.c.amount_days),
            "ground": composite(
                _ground_factory,
                balance_movement_table.c.compensation_line_id,
                balance_movement_table.c.leave_grant_id,
            ),
        },
    )
    _mapped = True
