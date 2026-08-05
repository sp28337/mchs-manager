"""Публичный контракт `personnel`: состав подразделения.

Второй контракт модуля, и появился он ровно тогда, когда понадобился, —
дашборду подразделения (TA031) нужно просуммировать сводки «по всем
сотрудникам части». Ответ на вопрос «кто в подразделении» принадлежит
`personnel`, и альтернативой контракту был бы межсхемный `JOIN` из
`time_accounting` в `personnel.employee`, то есть ровно то, что запрещает
PostgreSQL_Logical_Model разд. 10 и Architecture разд. 4.2.

--- Почему только идентификаторы ---------------------------------------

Возвращается список `UUID`, а не `EmployeeSnapshot`: потребителю нужно
пересечь состав с проекцией, а для этого достаточно идентичности.
Отдавать снимки значило бы тянуть ФИО и звания тысячи человек, чтобы
посчитать две суммы.

--- Почему по прямой принадлежности, а не по всей иерархии -------------

Отбираются сотрудники, у которых `current_unit_id` — это ЭТО
подразделение, а не всё поддерево `ltree`. Дашборд части показывает часть,
а не часть вместе со всеми её караулами: иначе сумма переработки
регионального центра включила бы каждого сотрудника округа, и число «всего
сотрудников» перестало бы что-либо значить для командира конкретного
подразделения.

Запрос по поддереву — законный, но ДРУГОЙ вопрос (и другая подпись, с
явным `include_subordinate_units`), и заводить его следует, когда
появится экран, который его задаёт.

--- Уволенные ----------------------------------------------------------

Исключаются: дашборд отвечает на вопрос о текущем составе. Сводки за
прошлые периоды у уволенных при этом сохраняются и доступны по прямому
запросу (`hours-breakdown-history`) — история не удаляется, она просто не
входит в «сколько людей в части сейчас».
"""

from __future__ import annotations

from typing import Protocol
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.personnel.infrastructure.orm_mapping import employee_table

_DISMISSED = "dismissed"


class ListUnitEmployeeIds(Protocol):
    async def __call__(self, *, unit_id: UUID) -> list[UUID]: ...


async def list_employee_ids_of_unit(session: AsyncSession, *, unit_id: UUID) -> list[UUID]:
    """Идентификаторы действующих сотрудников подразделения."""
    rows = await session.execute(
        select(employee_table.c.id)
        .where(
            employee_table.c.current_unit_id == unit_id,
            employee_table.c.employment_status != _DISMISSED,
        )
        .order_by(employee_table.c.id)
    )
    return [row.id for row in rows]
