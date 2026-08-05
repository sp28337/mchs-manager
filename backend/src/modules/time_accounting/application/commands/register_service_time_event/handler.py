"""Обработчик `RegisterServiceTimeEventCommand` (TA008-TA012).

Порядок проверок выбран так, чтобы отказ приходил от самой дешёвой из
применимых и объяснял причину, а не следствие:

1. **Табель существует и редактируем** — иначе всё остальное бессмысленно.
2. **Приказ существует**, если на него ссылаются. Проверяется здесь, а не
   в агрегате: приказ — отдельный агрегат, а агрегаты друг друга не
   обходят. В БД тот же факт держит внешний ключ, но 404 с внятным телом
   лучше, чем расшифровка `IntegrityError`.
3. **Суточный предел 24 ч** (инвариант 6.1.6). Требует ВСЕХ фактических
   смен сотрудника — и своего табеля, и соседних: содержательным
   инвариант становится ровно на их стыке.
4. **Непересечение и правила полей** (инварианты 6.1.1, 6.1.2) — внутри
   `register_event()` агрегата, плюс `EXCLUDE` в БД.

Пункт 3 идёт до пункта 4 по той же причине, что в `scheduling`:
пересечение внутри табеля поймает агрегат, а пересечение через границу
двух табелей — БД, и оба дадут понятный отказ. Суточный предел же не
поймает никто, кроме этого шага, — а поймав, он назовёт конкретные сутки
и конкретное число часов, чего `EXCLUDE` сделать не может.
"""

from __future__ import annotations

from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.domain.time_interval import TimeInterval
from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.time_accounting.application.commands.register_service_time_event.command import (
    RegisterServiceTimeEventCommand,
)
from src.modules.time_accounting.application.ports import (
    EmployeeCalculationContextPort,
    OvertimeOrderRepositoryPort,
    TimesheetRepositoryPort,
)
from src.modules.time_accounting.application.services.daily_service_time_limit import (
    DailyServiceTimeLimitService,
)
from src.modules.time_accounting.domain.errors import (
    OvertimeWithoutOrderError,
    TimesheetNotFoundError,
)
from src.modules.time_accounting.domain.timesheet import ServiceTimeEvent
from src.modules.time_accounting.domain.value_objects import ServiceTimeEventType


class RegisterServiceTimeEventHandler:
    def __init__(
        self,
        session: AsyncSession,
        repo: TimesheetRepositoryPort,
        orders: OvertimeOrderRepositoryPort,
        outbox: OutboxWriter,
        daily_limit: DailyServiceTimeLimitService,
        employees: EmployeeCalculationContextPort,
    ) -> None:
        self._session = session
        self._repo = repo
        self._orders = orders
        self._outbox = outbox
        self._daily_limit = daily_limit
        self._employees = employees

    async def handle(self, command: RegisterServiceTimeEventCommand) -> ServiceTimeEvent:
        timesheet = await self._repo.get(command.timesheet_id)
        if timesheet is None:
            raise TimesheetNotFoundError(str(command.timesheet_id))

        if command.overtime_order_id is not None:
            if await self._orders.get(command.overtime_order_id) is None:
                raise OvertimeWithoutOrderError(
                    f"приказ {command.overtime_order_id} не найден: привлечение сверх "
                    f"нормы обосновывается существующим документом "
                    f"(Domain Model инвариант 6.1.2)"
                )

        time_range = TimeInterval(start=command.start_time, end=command.end_time)

        if command.event_type is ServiceTimeEventType.ACTUAL_SHIFT:
            # Инвариант 6.1.6 — только о фактических сменах. Болезнь и
            # командировка суточного предела не образуют: человек может
            # болеть все 24 часа суток, и это не ошибка ввода.
            neighbours = await self._repo.actual_shift_intervals_of(timesheet.employee_id)
            context = await self._employees.context_of(timesheet.employee_id)
            if context is None:
                raise TimesheetNotFoundError(
                    f"сотрудник {timesheet.employee_id} не найден: без его подразделения "
                    f"неизвестен часовой пояс отсчёта суток (миграция 0016)"
                )
            self._daily_limit.ensure_within_daily_limit(
                employee_id=timesheet.employee_id,
                candidate=time_range,
                existing_shifts=neighbours,
                time_zone=ZoneInfo(context.time_zone),
            )

        event = timesheet.register_event(
            event_type=command.event_type,
            time_range=time_range,
            planned_shift_id=command.planned_shift_id,
            overtime_order_id=command.overtime_order_id,
            business_trip_place=command.business_trip_place,
        )
        await self._outbox.enqueue(timesheet)
        await self._session.commit()
        return event
