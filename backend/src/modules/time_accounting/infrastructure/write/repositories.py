"""TA006 — write-side репозитории `time_accounting`.

Запись агрегата и запись в `outbox_message` идут одной транзакцией: сессия
у них общая, коммитит её обработчик (`OutboxWriter` намеренно не
коммитит — см. его докстринг). Именно это делает Transactional Outbox
транзакционным: событие не может уйти, если состояние не сохранилось, и
наоборот.
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.domain.time_interval import TimeInterval
from src.modules.time_accounting.domain.overtime_order import OvertimeOrder
from src.modules.time_accounting.domain.timesheet import Timesheet
from src.modules.time_accounting.domain.value_objects import ServiceTimeEventType
from src.modules.time_accounting.infrastructure.write.orm_mapping import (
    overtime_order_table,
    service_time_event_table,
    timesheet_table,
)


class TimesheetRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, timesheet_id: UUID) -> Timesheet | None:
        return await self._session.get(Timesheet, timesheet_id)

    async def get_for_period(
        self, *, employee_id: UUID, period_start: date, period_end: date
    ) -> Timesheet | None:
        """Пара «сотрудник + период» — ключ уникальности табеля
        (`uq_timesheet_employee_period`)."""
        result = await self._session.execute(
            select(Timesheet).where(
                timesheet_table.c.employee_id == employee_id,
                timesheet_table.c.period_start == period_start,
                timesheet_table.c.period_end == period_end,
            )
        )
        return result.scalar_one_or_none()

    async def actual_shift_intervals_of(self, employee_id: UUID) -> list[TimeInterval]:
        """ВСЕ фактические смены сотрудника, по всем его табелям.

        То, чего агрегат увидеть не может, и без чего
        `DailyServiceTimeLimitService` бессмыслен: инвариант 6.1.6
        содержателен только на стыке двух табелей (суточное дежурство с
        31-го на 1-е).

        Проверяемое событие в выборку не попадает по построению: оно ещё
        не сохранено. Параметра «исключить текущий табель» здесь нет
        намеренно — ровно такой параметр в `scheduling` оказался ошибкой,
        выбрасывавшей из проверки как раз те смены, ради которых проверка
        и делалась.
        """
        result = await self._session.execute(
            select(service_time_event_table.c.time_range)
            .where(
                service_time_event_table.c.employee_id == employee_id,
                service_time_event_table.c.event_type
                == ServiceTimeEventType.ACTUAL_SHIFT.value,
            )
            .order_by(service_time_event_table.c.time_range)
        )
        return [row.time_range for row in result]

    def add(self, timesheet: Timesheet) -> None:
        self._session.add(timesheet)


class OvertimeOrderRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, order_id: UUID) -> OvertimeOrder | None:
        return await self._session.get(OvertimeOrder, order_id)

    async def exists_with_number(self, order_number: str) -> bool:
        result = await self._session.execute(
            select(overtime_order_table.c.id).where(
                overtime_order_table.c.order_number == order_number
            )
        )
        return result.first() is not None

    def add(self, order: OvertimeOrder) -> None:
        self._session.add(order)
