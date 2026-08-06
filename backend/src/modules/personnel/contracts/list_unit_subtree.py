"""Публичный контракт `personnel`: положение подразделения в иерархии.

Отвечает на вопрос «кому это подразделение подчинено», и нужен он
региональному прогнозу затрат (CO015): затраты пожарной части входят в
затраты гарнизона, гарнизона — в затраты регионального центра, и так до
корня. Чтобы сложить их, `compensation` должен знать цепочку
подчинения — факт, принадлежащий `personnel`.

Отдаются идентификаторы, а не подразделения целиком: потребителю нужно
сложить суммы по ключу, и ни название части, ни её код для этого не
требуются (Architecture разд. 4.2 п. 3).

Иерархия читается из материализованного пути (`ltree`), а не рекурсивным
запросом: путь для того и хранится (PostgreSQL_Logical_Model разд. 2.2), и
предки в нём уже перечислены — их не нужно искать, достаточно разобрать
строку.
"""

from __future__ import annotations

from typing import Protocol
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.personnel.infrastructure.orm_mapping import unit_table


class ListAncestorUnitIds(Protocol):
    async def __call__(self, *, unit_id: UUID) -> list[UUID]: ...


async def list_unit_and_ancestor_ids(session: AsyncSession, *, unit_id: UUID) -> list[UUID]:
    """Подразделение и все его предки, от самого себя к корню.

    Само подразделение включено: затраты части входят в затраты части.
    Пустой список означает, что подразделения нет, — а не что у него нет
    предков (у корневого их нет, но сам он в ответе есть).
    """
    path = await session.scalar(
        select(unit_table.c.hierarchy_path).where(unit_table.c.id == unit_id)
    )
    if path is None:
        return []

    # `as_ltree()`, а НЕ `str(path)`: колонка отдаёт доменный VO
    # `HierarchyPath` (его `_HierarchyPathType` восстанавливает при
    # чтении), и `str()` от него даёт представление dataclass'а, а не
    # путь. Разбор такого текста молча возвращал бы пустой список — то
    # есть подразделение без предков, и затраты части не попадали бы в
    # прогноз гарнизона, ничем себя не выдав.
    #
    # Сам VO наружу не отдаётся — только идентификаторы: метки суть
    # `u<hex>` (`HierarchyPath.label_for`), и разбор тривиален.
    labels = path.as_ltree().split(".")
    return [UUID(label[1:]) for label in reversed(labels) if label.startswith("u")]
