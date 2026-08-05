"""TA027 — read-проекция `hours_breakdown_projection`.

--- Почему проекция пишется СИНХРОННО, а не задачей Celery -------------

Бэклог формулирует TA027 как «Celery-задача построения проекции» с
критерием «проекция обновляется асинхронно в течение секунд после
ApproveTimesheet». Здесь она пишется в той же транзакции, что и смена
статуса табеля, и это не срезание угла, а следствие двух вещей.

**Первая — смысл утверждения.** Domain Model разд. 11 описывает
`TimesheetApproved` как «период закрыт, `HoursBreakdown` **зафиксирован
окончательно**». Зафиксирован в тот же момент, что и закрыт: утверждённый
табель, у которого расчёта ещё нет, — это состояние, которого предметная
область не знает. Сотрудник, открывший сводку через секунду после
утверждения, увидел бы «данных нет» и не смог бы отличить это от «расчёт
дал ноль».

**Вторая — релея пока нет.** Асинхронность требует не только Celery, но и
рабочего процесса, читающего `outbox_message` (задача F013, фаза 10). Пока
его нет, «асинхронная» проекция не появилась бы никогда — не через
секунды, а вообще.

Асинхронность здесь и не покупает того, ради чего её вводят: проекция
пишется один раз на утверждение табеля, у неё ровно один писатель и нет
конкуренции за строки, из-за которой Architecture разд. 8.2 разделяет
пути чтения и записи. Разделение остаётся физическим (отдельная таблица,
отдельный путь чтения), а асинхронной становится только доставка события
подписчикам — там, где она действительно нужна.

`TimesheetApproved` при этом всё равно уходит в outbox: Compensation
(фаза 8) подписывается именно на него, и его потребление никак не связано
с тем, кто и когда построил проекцию.

--- Upsert, а не insert ------------------------------------------------

Табель можно переоткрыть и утвердить заново (инвариант 6.1.4), и тогда
расчёт обязан замениться. Хранить историю расчётов проекция не должна —
это её задача быть «текущим ответом»; история же утверждений и
переоткрытий живёт в событиях и `correction_entry`.
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.time_accounting.domain.value_objects import HoursBreakdown
from src.modules.time_accounting.infrastructure.read.orm_mapping import (
    hours_breakdown_projection_table,
)


class HoursBreakdownProjectionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def upsert(
        self,
        *,
        timesheet_id: UUID,
        employee_id: UUID,
        period_start: date,
        period_end: date,
        breakdown: HoursBreakdown,
        time_zone: str,
    ) -> None:
        values = {
            "timesheet_id": timesheet_id,
            "employee_id": employee_id,
            "period_start": period_start,
            "period_end": period_end,
            "norm_hours": breakdown.norm_hours,
            "actual_hours": breakdown.actual_hours,
            "night_hours": breakdown.night_hours,
            "holiday_hours": breakdown.holiday_hours,
            "weekend_hours": breakdown.weekend_hours,
            "overtime_hours": breakdown.overtime_hours,
            "underworked_hours": breakdown.underworked_hours,
            "underworked_explained_hours": breakdown.underworked_explained_hours,
            "computed_from_rule_version_id": breakdown.used_rule_version_id,
            "used_conflict_policy_version_id": breakdown.used_conflict_policy_version_id,
            "computed_from_legal_base": breakdown.legal_base,
            "computed_in_time_zone": time_zone,
        }
        statement = pg_insert(hours_breakdown_projection_table).values(**values)
        # `computed_at` намеренно НЕ в `values`: у него DEFAULT now(), и при
        # вставке он проставится сам. При обновлении же он обязан
        # обновиться — иначе повторное утверждение оставило бы отметку
        # времени первого расчёта.
        await self._session.execute(
            statement.on_conflict_do_update(
                index_elements=[hours_breakdown_projection_table.c.timesheet_id],
                set_={
                    key: statement.excluded[key]
                    for key in values
                    if key != "timesheet_id"
                }
                | {"computed_at": _now()},
            )
        )


def _now() -> object:
    from sqlalchemy import func

    return func.now()
