"""Публичный контракт `time_accounting`: утверждённый расчёт периода.

Единственный вопрос, который задаёт `Compensation`, и он двойной по
необходимости: «утверждён ли табель» (инвариант 7.1.1) и «сколько часов
каких категорий в нём зафиксировано» (инвариант 7.1.2). Оба ответа
приходят из ОДНОГО источника — read-проекции, — и это не оптимизация, а
условие согласованности: спроси их порознь, и между двумя запросами
табель успел бы переоткрыться, а компенсация посчиталась бы по числам,
которые уже перестали быть окончательными.

--- Почему проекция, а не write-модель ---------------------------------

Строка `hours_breakdown_projection` появляется ровно в момент утверждения
табеля и в той же транзакции (см. `infrastructure/read/projection.py`).
Поэтому её НАЛИЧИЕ и есть ответ на вопрос «утверждён ли период»:
отдельный запрос к `timesheet.status` дал бы то же самое, но ценой
обращения к write-модели, от конкуренции за строки которой проекция и
заведена.

Следствие, важное для потребителя: переоткрытый и ещё не утверждённый
заново табель ОСТАВЛЯЕТ строку проекции с прежними числами. Это
сознательно — иначе сотрудник, чей табель переоткрыли для исправления
одной смены, на всё время исправления терял бы доступ к своей сводке. Но
для компенсации этого мало, поэтому контракт отдаёт и `status`: дело
заводится только по `approved`.

--- Что здесь НЕ отдаётся ----------------------------------------------

Ни нормы, ни фактических, ни недоработки. Компенсации подлежат четыре
категории Алгоритма К шаг 2, и только они; отдавать норму значило бы дать
возможность начислить компенсацию за неё (Architecture разд. 4.2 п. 3:
контракт отдаёт проекцию под конкретный вопрос, а не всё, что нашёл).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.time_accounting.infrastructure.read.orm_mapping import (
    hours_breakdown_projection_table,
)
from src.modules.time_accounting.infrastructure.write.orm_mapping import timesheet_table

APPROVED = "approved"


class ApprovedBreakdownNotFound(LookupError):
    """За период нет утверждённого расчёта.

    Отдельная ошибка, а не `None`: «табель не утверждён» — это причина
    отказать в создании дела о компенсации (инвариант 7.1.1), а не
    пустой результат, который потребитель мог бы забыть проверить.
    """


class ApprovedBreakdown(BaseModel):
    """Проекция под вопрос `Compensation`, а не `HoursBreakdown` VO —
    тот принадлежит домену `time_accounting`."""

    model_config = ConfigDict(frozen=True)

    timesheet_id: UUID
    employee_id: UUID
    period_start: date
    period_end: date
    status: str
    night_hours: Decimal
    holiday_hours: Decimal
    weekend_hours: Decimal
    overtime_hours: Decimal
    # Провенанс расчёта — нужен потребителю, чтобы объяснить, из чего
    # выросла компенсация, если расчёт впоследствии пересмотрят.
    computed_from_rule_version_id: UUID
    computed_from_legal_base: str

    @property
    def is_approved(self) -> bool:
        return self.status == APPROVED


class GetApprovedBreakdown(Protocol):
    async def __call__(
        self, *, employee_id: UUID, period_start: date, period_end: date
    ) -> ApprovedBreakdown: ...


async def get_approved_breakdown(
    session: AsyncSession, *, employee_id: UUID, period_start: date, period_end: date
) -> ApprovedBreakdown:
    """Расчёт периода вместе с текущим статусом табеля.

    Соединение проекции с `timesheet` — единственное место, где контракт
    трогает write-модель, и трогает он ровно одну колонку. Без неё
    ответить на инвариант 7.1.1 нечем: наличие проекции говорит, что
    период КОГДА-ТО был утверждён, а не что он утверждён СЕЙЧАС.
    """
    p = hours_breakdown_projection_table
    row = (
        await session.execute(
            select(
                p.c.timesheet_id,
                p.c.employee_id,
                p.c.period_start,
                p.c.period_end,
                timesheet_table.c.status,
                p.c.night_hours,
                p.c.holiday_hours,
                p.c.weekend_hours,
                p.c.overtime_hours,
                p.c.computed_from_rule_version_id,
                p.c.computed_from_legal_base,
            )
            .select_from(
                p.join(timesheet_table, timesheet_table.c.id == p.c.timesheet_id)
            )
            .where(
                p.c.employee_id == employee_id,
                p.c.period_start == period_start,
                p.c.period_end == period_end,
            )
        )
    ).one_or_none()

    if row is None:
        raise ApprovedBreakdownNotFound(
            f"за период [{period_start}, {period_end}) табель сотрудника {employee_id} "
            f"не утверждался: компенсация не может опережать факт "
            f"(Domain Model инвариант 7.1.1)"
        )

    return ApprovedBreakdown(**dict(row._mapping))
