"""CO003 — Data Mapper для `compensation` (миграция 0017).

Imperative mapping, как во всех модулях. Две вещи здесь стоит отметить,
потому что они отличаются от предыдущих модулей.

**`compensable` не маппится.** Предел компенсации
(`CompensableHours` — часы утверждённого `HoursBreakdown`) хранится в
агрегате, но в таблице `compensation_case` его нет и быть не должно: это
не состояние дела, а копия чужого факта, у которой уже есть единственный
источник истины — `hours_breakdown_projection`. Хранить её второй раз
значило бы завести два числа, обязанных совпадать, и однажды получить их
расхождение.

Отсюда следствие, с которым обязан считаться репозиторий: загруженное из
БД дело приходит БЕЗ предела, и добавлять к нему строки нельзя, пока
предел не восстановлен из контракта `time_accounting`. Репозиторий делает
это сам (`get_with_limits`), а обычный `get` отдаёт дело только для
чтения и финализации — операций, которым предел не нужен.

**`election_allowed` не маппится тоже.** Это свойство ПРАВИЛА, на которое
ссылается строка, а не самой строки: восстанавливается из
`legal_basis_rule_version_id`. Колонка в таблице означала бы второй
источник истины о содержании нормативного акта.
"""

from __future__ import annotations

from enum import StrEnum

from sqlalchemy import Column, Date, DateTime, ForeignKey, MetaData, Numeric, Table
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import composite, registry, relationship

from src.building_blocks.infrastructure.outbox import build_outbox_table
from src.modules.compensation.domain.compensation_case import (
    CompensationCase,
    CompensationLine,
)
from src.modules.compensation.domain.value_objects import (
    AccountingPeriod,
    CaseStatus,
    CompensationForm,
    HourCategory,
)

mapper_registry = registry()
metadata = MetaData(schema="compensation")

outbox_message_table = build_outbox_table(metadata)


def _enum_values(enum_class: type[StrEnum]) -> list[str]:
    return [member.value for member in enum_class]


# Через класс, а не через список значений — см. докстринг маппинга
# `time_accounting`: иначе из БД приходят голые строки, и свойства
# доменных enum'ов на загруженном агрегате падают с AttributeError.
_case_status_enum = PgEnum(
    CaseStatus,
    name="case_status",
    schema="compensation",
    create_type=False,
    values_callable=_enum_values,
)
_form_enum = PgEnum(
    CompensationForm,
    name="compensation_form",
    schema="compensation",
    create_type=False,
    values_callable=_enum_values,
)
_hour_category_enum = PgEnum(
    HourCategory,
    name="hour_category",
    schema="compensation",
    create_type=False,
    values_callable=_enum_values,
)

compensation_case_table = Table(
    "compensation_case",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column("employee_id", PgUUID(as_uuid=True), nullable=False),
    Column("timesheet_id", PgUUID(as_uuid=True), nullable=False),
    Column("period_start", Date, nullable=False),
    Column("period_end", Date, nullable=False),
    Column("status", _case_status_enum, nullable=False),
    Column(
        "corrects_case_id",
        PgUUID(as_uuid=True),
        ForeignKey("compensation.compensation_case.id"),
        nullable=True,
    ),
    Column("finalized_at", DateTime(timezone=True), nullable=True),
    # created_at: DB DEFAULT now(), доменом не читается.
)

compensation_line_table = Table(
    "compensation_line",
    metadata,
    Column("id", PgUUID(as_uuid=True), primary_key=True),
    Column(
        "case_id",
        PgUUID(as_uuid=True),
        ForeignKey("compensation.compensation_case.id"),
        nullable=False,
    ),
    Column("hour_category", _hour_category_enum, nullable=False),
    Column("hours_amount", Numeric(8, 2), nullable=False),
    Column("compensation_form", _form_enum, nullable=False),
    Column("legal_basis_rule_version_id", PgUUID(as_uuid=True), nullable=False),
    Column("employee_election_at", DateTime(timezone=True), nullable=True),
)


def _period_factory(period_start: object, period_end: object) -> AccountingPeriod:
    return AccountingPeriod(start=period_start, end=period_end)  # type: ignore[arg-type]


_mapped = False


def start_mappers() -> None:
    """Идемпотентно — тот же контракт, что и у остальных модулей."""
    global _mapped
    if _mapped:
        return

    mapper_registry.map_imperatively(CompensationLine, compensation_line_table)
    mapper_registry.map_imperatively(
        CompensationCase,
        compensation_case_table,
        properties={
            "period": composite(
                _period_factory,
                compensation_case_table.c.period_start,
                compensation_case_table.c.period_end,
            ),
            "lines": relationship(
                CompensationLine,
                primaryjoin=(
                    compensation_case_table.c.id == compensation_line_table.c.case_id
                ),
                foreign_keys=[compensation_line_table.c.case_id],
                order_by=compensation_line_table.c.hour_category,
                cascade="all, delete-orphan",
                # Инвариант 7.1.2 проверяется по ВСЕМ строкам дела, а
                # финализация публикует событие на каждую: половинчато
                # загруженное дело начислило бы не то, что в нём есть.
                lazy="selectin",
            ),
        },
    )
    _mapped = True
