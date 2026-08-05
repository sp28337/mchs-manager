"""TA029-TA031 — чтение read-проекции.

Три запроса, и ни один из них не трогает write-модель: в этом весь смысл
разделения (Architecture разд. 8.2). Путь чтения — один индекс
`ix_hours_breakdown_employee_period (employee_id, period_start DESC)` и
одна денормализованная строка, без соединений с `timesheet` и
`service_time_event`.

Функции модуля, а не класс-репозиторий: у чтения нет состояния, нет
агрегата и нет инвариантов, которые кто-то мог бы нарушить. Класс здесь
был бы пространством имён с `self`, не несущим смысла.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import Numeric, cast, func, select
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.time_accounting.infrastructure.read.orm_mapping import (
    hours_breakdown_projection_table as t,
)


@dataclass(frozen=True, kw_only=True)
class HoursBreakdownRow:
    """Строка проекции как она есть. Не `HoursBreakdown` VO: тот —
    результат РАСЧЁТА и несёт его инварианты, а это прочитанная запись,
    которая вдобавок знает, когда её посчитали."""

    timesheet_id: UUID
    employee_id: UUID
    period_start: date
    period_end: date
    norm_hours: Decimal
    actual_hours: Decimal
    night_hours: Decimal
    holiday_hours: Decimal
    weekend_hours: Decimal
    overtime_hours: Decimal
    underworked_hours: Decimal
    underworked_explained_hours: Decimal
    computed_from_rule_version_id: UUID
    used_conflict_policy_version_id: UUID | None
    computed_from_legal_base: str
    computed_in_time_zone: str
    computed_at: datetime


@dataclass(frozen=True, kw_only=True)
class UnitDashboard:
    unit_id: UUID
    period_start: date
    period_end: date
    total_employees: int
    total_overtime_hours: Decimal
    total_underworked_hours: Decimal
    pending_approval_count: int


def _to_row(row: Row[Any]) -> HoursBreakdownRow:
    """Колонки таблицы и поля `HoursBreakdownRow` названы одинаково и
    намеренно: проекция денормализована ровно под этот ответ, поэтому
    перекладывание поле-в-поле было бы пятнадцатью строками, каждая из
    которых может однажды разъехаться. `_mapping` — публичный интерфейс
    `Row` в SQLAlchemy 2, а несовпадение имён свалится сразу и целиком,
    а не молча в одном поле."""
    return HoursBreakdownRow(**dict(row._mapping))


async def get_timesheet_summary(
    session: AsyncSession, *, employee_id: UUID, period_start: date, period_end: date
) -> HoursBreakdownRow | None:
    """TA029. Сводка сотрудника за конкретный период.

    Период сравнивается на точное совпадение, а не на пересечение: сводка
    существует для учётного периода как целого, и «сводка за 10-20 марта»
    не является ни существующей записью, ни осмысленным вопросом —
    норма определена для периода, а не для его куска.
    """
    row = (
        await session.execute(
            select(t).where(
                t.c.employee_id == employee_id,
                t.c.period_start == period_start,
                t.c.period_end == period_end,
            )
        )
    ).one_or_none()
    return None if row is None else _to_row(row)


async def get_hours_breakdown_history(
    session: AsyncSession, *, employee_id: UUID, page: int = 1, page_size: int = 20
) -> list[HoursBreakdownRow]:
    """TA030. История сводок сотрудника, новые сверху.

    Сортировка `period_start DESC` — ровно порядок индекса
    `ix_hours_breakdown_employee_period`, поэтому пагинация не требует
    сортировки результата.
    """
    rows = await session.execute(
        select(t)
        .where(t.c.employee_id == employee_id)
        .order_by(t.c.period_start.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    return [_to_row(row) for row in rows]


async def get_unit_dashboard(
    session: AsyncSession,
    *,
    unit_id: UUID,
    employee_ids: list[UUID],
    period_start: date,
    period_end: date,
) -> UnitDashboard:
    """TA031. Агрегаты по подразделению.

    Состав сотрудников приходит СПИСКОМ, а не выбирается здесь join'ом к
    `personnel.employee`: межсхемный join сделал бы модуль зависящим от
    чужой таблицы, а не от чужого контракта (PostgreSQL_Logical_Model
    разд. 10, Architecture разд. 4.2). Список формирует вызывающий,
    спросив `personnel`.

    `pending_approval_count` считается как «сотрудников без строки в
    проекции», а не запросом к `timesheet.status`: проекция и есть ответ
    на вопрос «за кого период посчитан», и обращение к write-модели ради
    одного числа вернуло бы конкуренцию за строки, ради устранения которой
    проекция и заведена.
    """
    if not employee_ids:
        return UnitDashboard(
            unit_id=unit_id,
            period_start=period_start,
            period_end=period_end,
            total_employees=0,
            total_overtime_hours=Decimal(0),
            total_underworked_hours=Decimal(0),
            pending_approval_count=0,
        )

    row = (
        await session.execute(
            select(
                func.count().label("computed"),
                func.coalesce(
                    func.sum(t.c.overtime_hours), cast(0, Numeric(8, 2))
                ).label("overtime"),
                func.coalesce(
                    func.sum(t.c.underworked_hours), cast(0, Numeric(8, 2))
                ).label("underworked"),
            ).where(
                t.c.employee_id.in_(employee_ids),
                t.c.period_start == period_start,
                t.c.period_end == period_end,
            )
        )
    ).one()

    return UnitDashboard(
        unit_id=unit_id,
        period_start=period_start,
        period_end=period_end,
        total_employees=len(employee_ids),
        total_overtime_hours=row.overtime,
        total_underworked_hours=row.underworked,
        pending_approval_count=len(employee_ids) - row.computed,
    )
