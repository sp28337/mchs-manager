"""SD003 — write-side репозиторий `DutySchedule`.

`Scheduling` — не CQRS-модуль (Architecture разд. 8.2: «чтение графика по
сложности сопоставимо с записью»), поэтому чтение идёт через тот же
репозиторий.
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.domain.time_interval import TimeInterval
from src.modules.scheduling.domain.duty_schedule import DutySchedule
from src.modules.scheduling.domain.value_objects import ScheduleStatus
from src.modules.scheduling.infrastructure.orm_mapping import (
    duty_schedule_table,
    planned_shift_table,
)


class DutyScheduleRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, schedule_id: UUID) -> DutySchedule | None:
        return await self._session.get(DutySchedule, schedule_id)

    async def get_active_for_period(
        self, *, unit_id: UUID, period_start: date, period_end: date
    ) -> DutySchedule | None:
        """Действующая версия графика подразделения на период.

        `status <> 'closed'` — то же условие, что у частичного индекса
        `uq_duty_schedule_unit_period_active` (миграция 0013): закрытые
        версии остаются историей и в ответ на «какой сейчас график» не
        попадают.
        """
        result = await self._session.execute(
            select(DutySchedule).where(
                duty_schedule_table.c.unit_id == unit_id,
                duty_schedule_table.c.period_start == period_start,
                duty_schedule_table.c.period_end == period_end,
                duty_schedule_table.c.status != ScheduleStatus.CLOSED.value,
            )
        )
        return result.scalar_one_or_none()

    async def list_for_unit(
        self, *, unit_id: UUID, period_start: date, period_end: date
    ) -> list[DutySchedule]:
        """SD010 — графики подразделения, пересекающиеся с запрошенным
        периодом.

        Именно пересекающиеся, а не «начинающиеся внутри»: запрос за
        квартал обязан вернуть и месячный график, начавшийся до его начала,
        иначе из выдачи выпадут смены, которые в этот квартал попадают.
        """
        result = await self._session.execute(
            select(DutySchedule)
            .where(
                duty_schedule_table.c.unit_id == unit_id,
                duty_schedule_table.c.period_start < period_end,
                duty_schedule_table.c.period_end > period_start,
            )
            .order_by(duty_schedule_table.c.period_start, duty_schedule_table.c.revision_no)
        )
        return list(result.scalars().all())

    async def active_shift_intervals_of(self, employee_id: UUID) -> list[TimeInterval]:
        """ВСЕ действующие смены сотрудника, по всем графикам.

        Это то, чего агрегат увидеть не может и без чего
        `RestPeriodPolicyService` бессмыслен: межсменный отдых нарушается и
        между сменами одного графика, и на стыке двух соседних периодов,
        то есть между двумя разными агрегатами (Domain Model инвариант
        5.1.2).

        Здесь был параметр `exclude_schedule_id` — «чтобы график не
        сравнивался сам с собой». Он оказался ловушкой: исключая текущий
        график, он выбрасывал соседние смены ТОГО ЖЕ графика, то есть
        самый частый случай (смены одного месяца), и проверка отдыха
        внутри графика молча не срабатывала. Поймано интеграционным
        тестом `test_a_shift_violating_the_minimum_rest_is_422`.

        Исключать при этом нечего: проверяемая смена в момент запроса ещё
        не сохранена (`add_shift` вызывается после проверки, коммит — в
        самом конце), поэтому в выборку она не попадает по построению.
        """
        result = await self._session.execute(
            select(planned_shift_table.c.time_range)
            .where(
                planned_shift_table.c.employee_id == employee_id,
                planned_shift_table.c.superseded.is_(False),
            )
            .order_by(planned_shift_table.c.time_range)
        )
        return [row.time_range for row in result]

    def add(self, schedule: DutySchedule) -> None:
        self._session.add(schedule)
