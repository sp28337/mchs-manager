"""Обработчик `ApproveTimesheetCommand` (TA015 + TA026).

Утверждение — единственное место, где запускается полный пайплайн расчёта
(Алгоритмы А-З). Порядок здесь существенен и выбран так, чтобы неудачный
расчёт не оставил утверждённого табеля без чисел:

1. **Сначала считаем, потом утверждаем.** Если календарь не опубликован,
   нормы нет или политика приоритетов не найдена — отказ приходит до
   смены статуса, и табель остаётся открытым. Обратный порядок дал бы
   утверждённый (то есть неизменяемый, инвариант 6.1.4) табель, расчёт
   которого не удался, — состояние, из которого нет выхода, кроме
   переоткрытия.
2. **Проекция и статус — одной транзакцией.** «Период закрыт,
   `HoursBreakdown` зафиксирован окончательно» (Domain Model разд. 11)
   описывает одно событие, а не два; см. докстринг
   `infrastructure/read/projection.py` о том, почему это не задача Celery.
3. **Событие — туда же.** `TimesheetApproved` уходит в outbox той же
   транзакцией: на него подписаны Compensation (фаза 8) и, в будущем,
   релей проекций.

Инвариант 6.1.5 («повторный расчёт тех же данных обязан дать идентичный
результат») выполняется здесь по построению: пайплайн — чистая функция
табеля, календаря и версий правил, а `upsert` проекции заменяет строку
целиком, а не досчитывает к ней.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.time_accounting.application.commands.approve_timesheet.command import (
    ApproveTimesheetCommand,
)
from src.modules.time_accounting.application.ports import (
    EmployeeCalculationContextPort,
    HoursBreakdownProjectionPort,
    TimesheetRepositoryPort,
)
from src.modules.time_accounting.application.services.hours_breakdown_pipeline import (
    HoursBreakdownPipeline,
)
from src.modules.time_accounting.domain.errors import TimesheetNotFoundError
from src.modules.time_accounting.domain.timesheet import Timesheet
from src.modules.time_accounting.domain.value_objects import HoursBreakdown


class ApproveTimesheetHandler:
    def __init__(
        self,
        session: AsyncSession,
        repo: TimesheetRepositoryPort,
        outbox: OutboxWriter,
        employees: EmployeeCalculationContextPort,
        pipeline: HoursBreakdownPipeline,
        projection: HoursBreakdownProjectionPort,
    ) -> None:
        self._session = session
        self._repo = repo
        self._outbox = outbox
        self._employees = employees
        self._pipeline = pipeline
        self._projection = projection

    async def handle(
        self, command: ApproveTimesheetCommand
    ) -> tuple[Timesheet, HoursBreakdown]:
        timesheet = await self._repo.get(command.timesheet_id)
        if timesheet is None:
            raise TimesheetNotFoundError(str(command.timesheet_id))

        context = await self._employees.context_of(timesheet.employee_id)
        if context is None:
            raise TimesheetNotFoundError(
                f"сотрудник {timesheet.employee_id} не найден: расчёт периода невозможен "
                f"без его правовой базы и часового пояса (Алгоритм А шаг 1)"
            )

        # Шаг 1: расчёт. До смены статуса — см. докстринг модуля.
        outcome = await self._pipeline.run(timesheet=timesheet, context=context)

        # Шаг 2: утверждение. Инвариант 6.1.4 проверит сам агрегат.
        timesheet.approve()

        await self._projection.upsert(
            timesheet_id=timesheet.id,
            employee_id=timesheet.employee_id,
            period_start=timesheet.period.start,
            period_end=timesheet.period.end,
            breakdown=outcome.breakdown,
            time_zone=outcome.time_zone,
        )
        await self._outbox.enqueue(timesheet)
        await self._session.commit()
        return timesheet, outcome.breakdown
