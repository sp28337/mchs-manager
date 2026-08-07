"""Composition/di.py — the "единственное место, компилирующее зависимость
от ВСЕХ модулей сразу" (Architecture разд. 8).

What it does: start each module's ORM mapping, and hand the validated
`Settings` to the shared infrastructure primitives in `building_blocks`.
That is all. It grows one module at a time and never invents infra a
module doesn't need yet.

What it deliberately does NOT do any more: provide `get_session` /
`get_rule_version_cache` to routers. Those moved to
`building_blocks/infrastructure/{db,redis_client}.py` and to each module's
own `api/dependencies.py`, because a module importing this file
transitively imports every other module — `.importlinter`'s
`independence-of-modules` contract failed on exactly that path as soon as
a second module existed. See `building_blocks/infrastructure/db.py` for
the full account.

The dependency now runs one way only: Composition -> modules -> building_blocks.
"""

from __future__ import annotations

from src.building_blocks.infrastructure.db import dispose_engine, init_engine
from src.building_blocks.infrastructure.redis_client import dispose_redis, init_redis
from src.composition.settings import get_settings
from src.modules.service_calendar.infrastructure.orm_mapping import (
    start_mappers as start_service_calendar_mappers,
)


def init_infrastructure() -> None:
    """Вызывается один раз при старте процесса из `api_app.lifespan` — и,
    на практике, ещё по разу на каждый `TestClient` в тестовой сессии.

    Каждый вызов ниже идемпотентен, что и делает это повторение
    безобидным: `start_mappers()` помнит, было ли уже отображение
    (SQLAlchemy падает на повторном отображении того же класса), а
    `init_engine`/`init_redis` ничего не делают при повторе.
    """
    start_service_calendar_mappers()

    # `shift_accounting` в отображении не нуждается: у него плоские
    # core-таблицы без агрегатов, и Data Mapper поверх трёх таблиц был бы
    # слоем, которому нечего скрывать.

    settings = get_settings()
    init_engine(dsn=settings.database_dsn, pool_size=settings.database_pool_size)
    init_redis(url=settings.redis_url)


async def dispose_infrastructure() -> None:
    """Вызывается при остановке. Отображения процессные и намеренно НЕ
    сбрасываются: снять и заново наложить отображение на те же классы
    SQLAlchemy отказывается, тогда как движок и Redis переподключаются
    чисто."""
    await dispose_engine()
    await dispose_redis()
