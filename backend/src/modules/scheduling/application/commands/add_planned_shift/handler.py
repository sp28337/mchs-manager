"""Обработчик `AddPlannedShiftCommand` (SD005) — самый насыщенный в модуле,
потому что здесь сходятся все четыре инварианта Domain Model 5.1, и каждый
проверяется на своём уровне.

Порядок проверок выбран так, чтобы отказ приходил от самой дешёвой из
применимых, и чтобы сообщение объясняло причину, а не следствие:

1. **График существует и редактируем** — иначе всё остальное бессмысленно.
2. **Сотрудник активен** (инвариант 5.1.4). Межмодульный факт: статус
   живёт в `personnel`, спрашивается через `EmployeeAvailabilityPort`.
   Проверяется до проверки отдыха, потому что «сотрудник в отпуске» —
   более фундаментальная причина отказа, чем «мало отдыха», и получить
   вторую вместо первой значило бы отправить табельщика чинить не то.
3. **Минимальный межсменный отдых** (инвариант 5.1.2). Требует ВСЕХ
   действующих смен сотрудника — и своего графика, и соседних: отдых
   нарушается и внутри месяца, и на стыке периодов. Проверяемая смена в
   выборку не попадает, потому что ещё не сохранена.
4. **Непересечение** (инвариант 5.1.1) — внутри `add_shift()` агрегата, а
   глобально по сотруднику ещё и `EXCLUDE` в БД.

Почему п. 3 идёт до п. 4, хотя пересечение «грубее»: пересечение внутри
графика поймает агрегат, а пересечение через границу периодов — БД, и оба
дадут понятный отказ. Отдых же не поймает никто, кроме этого шага.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.domain.time_interval import TimeInterval
from src.modules.scheduling.application.commands.add_planned_shift.command import (
    AddPlannedShiftCommand,
)
from src.modules.scheduling.application.ports import (
    DutyScheduleRepositoryPort,
    EmployeeAvailabilityPort,
    MinimumRestPeriodPort,
)
from src.modules.scheduling.application.services.rest_period_policy import (
    RestPeriodPolicyService,
)
from src.modules.scheduling.domain.duty_schedule import PlannedShift
from src.modules.scheduling.domain.errors import (
    EmployeeNotAvailableForShiftError,
    ScheduleNotFoundError,
)

_ACTIVE = "active"


class AddPlannedShiftHandler:
    def __init__(
        self,
        session: AsyncSession,
        repo: DutyScheduleRepositoryPort,
        employees: EmployeeAvailabilityPort,
        rest_period: MinimumRestPeriodPort,
    ) -> None:
        self._session = session
        self._repo = repo
        self._employees = employees
        self._rest_period = rest_period

    async def handle(self, command: AddPlannedShiftCommand) -> PlannedShift:
        schedule = await self._repo.get(command.schedule_id)
        if schedule is None:
            raise ScheduleNotFoundError(str(command.schedule_id))

        status = await self._employees.employment_status_of(command.employee_id)
        if status is None:
            raise EmployeeNotAvailableForShiftError(
                f"сотрудник {command.employee_id} не найден"
            )
        if status != _ACTIVE:
            raise EmployeeNotAvailableForShiftError(
                f"сотруднику {command.employee_id} нельзя назначить плановую смену: "
                f"статус {status}, требуется {_ACTIVE} (Domain Model инвариант 5.1.4). "
                f"Внеплановый вызов оформляется не графиком, а фактом привлечения "
                f"(SRS разд. 8 п.1)"
            )

        time_range = TimeInterval(start=command.start_time, end=command.end_time)

        neighbours = await self._repo.active_shift_intervals_of(command.employee_id)
        policy = RestPeriodPolicyService(
            lambda as_of, scope: self._rest_period.minimum_rest_hours(as_of=as_of, scope=scope)
        )
        await policy.ensure_rest_before(
            employee_id=command.employee_id,
            candidate=time_range,
            existing_shifts=neighbours,
            scope=command.rule_scope,
        )

        shift = schedule.add_shift(
            employee_id=command.employee_id,
            time_range=time_range,
            duty_type=command.duty_type,
        )
        await self._session.commit()
        return shift
