"""SD015 — публичный контракт `scheduling`.

Потребитель известен и конкретен: `TimeAccounting`. `ActualShiftRecord`
(Domain Model разд. 6.1) хранит необязательную ссылку на `PlannedShift` —
«факт по плану» и «внеплановый вызов» различаются именно её наличием, и
проверить, что ссылка ведёт на существующую действующую смену, можно
только отсюда.

Отдаются ТОЛЬКО действующие смены (`NOT superseded`). Смена отменённой
версии графика — история: привязывать к ней факт значило бы обосновывать
отработанное время приказом, который уже отменён.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from src.modules.scheduling.infrastructure.orm_mapping import (
    duty_schedule_table,
    planned_shift_table,
)

__all__ = ["GetPlannedShifts", "PlannedShiftDto", "get_planned_shifts_for_employee"]


class PlannedShiftDto(BaseModel):
    """Проекция, а не `scheduling.domain.PlannedShift` (Architecture разд.
    4.2 п.3). `duty_type` строкой — enum принадлежит этому модулю."""

    model_config = ConfigDict(frozen=True)

    shift_id: UUID
    duty_schedule_id: UUID
    employee_id: UUID
    start_time: datetime
    end_time: datetime
    duty_type: str
    schedule_status: str


class GetPlannedShifts(Protocol):
    async def __call__(
        self, *, employee_id: UUID, period_start: date, period_end: date
    ) -> list[PlannedShiftDto]: ...


async def get_planned_shifts_for_employee(
    session: AsyncSession, *, employee_id: UUID, period_start: date, period_end: date
) -> list[PlannedShiftDto]:
    """Действующие плановые смены сотрудника, пересекающиеся с периодом.

    Пересекающиеся, а не «начинающиеся внутри»: суточное дежурство,
    начавшееся 31-го числа предыдущего месяца, попадает в этот период
    своей второй половиной, и потерять его значило бы потерять часы.

    `schedule_status` отдаётся, чтобы потребитель мог отличить смену
    утверждённого графика от черновика: факт по неутверждённому графику —
    повод для проверки, а не нормальный ход событий (SRS разд. 8 п.11).
    """
    if period_end <= period_start:
        raise ValueError("period_end должен быть строго позже period_start")

    rows = await session.execute(
        select(
            planned_shift_table.c.id,
            planned_shift_table.c.duty_schedule_id,
            planned_shift_table.c.employee_id,
            planned_shift_table.c.time_range,
            planned_shift_table.c.duty_type,
            duty_schedule_table.c.status,
        )
        .select_from(
            planned_shift_table.join(
                duty_schedule_table,
                planned_shift_table.c.duty_schedule_id == duty_schedule_table.c.id,
            )
        )
        .where(
            planned_shift_table.c.employee_id == employee_id,
            planned_shift_table.c.superseded.is_(False),
            planned_shift_table.c.time_range.op("&&")(
                _tstzrange(period_start, period_end)
            ),
        )
        .order_by(planned_shift_table.c.time_range)
    )

    return [
        PlannedShiftDto(
            shift_id=row.id,
            duty_schedule_id=row.duty_schedule_id,
            employee_id=row.employee_id,
            start_time=row.time_range.start,
            end_time=row.time_range.end,
            duty_type=row.duty_type,
            schedule_status=row.status,
        )
        for row in rows
    ]


def _tstzrange(period_start: date, period_end: date) -> ColumnElement[Any]:
    """Период как `tstzrange`, чтобы оператор пересечения `&&` работал
    против колонки того же типа и мог опереться на GiST-индекс ограничения
    `excl_planned_shift_no_overlap`.

    Даты приводятся к `timestamptz` самой БД: граница периода — это
    полночь в часовом поясе сервера, и делать это приведение в Python
    значило бы зафиксировать здесь ту таймзону, которая случайно окажется
    у процесса.
    """
    return func.tstzrange(
        cast(period_start, Date), cast(period_end, Date), "[)"
    )
