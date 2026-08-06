"""Celery-задача релея outbox — F013.

Одна задача на все модули: обходит их таблицы `outbox_message` по
очереди. Раздельные задачи на модуль дали бы независимое расписание
каждому, но и независимые отказы: упавший релей одного модуля молча
задержал бы всю цепочку `TimeAccounting → Compensation → RestBalance`,
не показав этого ни в одном месте.

Список таблиц собирается здесь и только здесь — это единственное место в
`building_blocks`, которому пришлось бы знать модули поимённо, и потому
он вынесен в отдельную функцию, вызываемую из Composition Root
(контракт `.importlinter` №3: `building_blocks` не зависит ни от одного
модуля).
"""

from __future__ import annotations

import logging

from redis.asyncio import Redis
from sqlalchemy import Table
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.building_blocks.infrastructure.outbox_relay import relay_once

logger = logging.getLogger(__name__)

_registered_tables: list[Table] = []


def register_outbox_table(table: Table) -> None:
    """Регистрирует таблицу модуля в релее.

    Инверсия, ради которой всё и затевалось: модуль (точнее, Composition
    Root от его имени) сам сообщает о себе, а `building_blocks` не
    перечисляет модули.
    """
    if table not in _registered_tables:
        _registered_tables.append(table)


def registered_tables() -> list[Table]:
    return list(_registered_tables)


async def relay_all_once(
    session_factory: async_sessionmaker[AsyncSession],
    redis: Redis,
    *,
    batch_size: int = 100,
) -> int:
    """Один проход по всем зарегистрированным таблицам.

    Фабрика сессий и Redis приходят аргументами, а не берутся из глобалей.
    Это не только тестируемость: пулы соединений привязаны к event loop, а
    воркер Celery создаёт свой loop на каждую задачу (см. докстринг
    `celery_app`). Функция, читающая глобаль, молча пользовалась бы пулом
    чужого — уже закрытого — цикла, и это тот класс ошибок, который
    проявляется только под нагрузкой.
    """
    factory = session_factory
    total = 0
    for table in _registered_tables:
        async with factory() as session:
            published = await relay_once(session, redis, table, batch_size=batch_size)
        if published:
            logger.info(
                "outbox relay: опубликовано %s событий из %s", published, table.fullname
            )
        total += published
    return total
