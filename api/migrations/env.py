"""Окружение Alembic.

Отличий от шаблона три, и все осознанные.

**Строка подключения — из настроек приложения,** а не из `alembic.ini`.
Самого `alembic.ini` здесь нет: единственное, что в нём оставалось, —
адрес базы и настройка логов, а то и другое у нас уже есть. Два места,
задающих одно и то же, однажды разойдутся, и миграция уедет не в ту базу.
Остальные настройки Alembic лежат в `pyproject.toml`, рядом с остальными.

**Логи — наши.** Шаблон вызывает `fileConfig` и переопределяет
журналирование настройками из ini; вместо этого вызывается
`configure_logging`, и вывод миграций получается тем же JSON, что и у
приложения. В CI это одна и та же лента.

**Модели импортируются целиком.** Alembic сравнивает базу с
`Base.metadata`, а в метаданных оказывается только то, что успели
импортировать: пропущенный импорт означает миграцию, которая молча удаляет
таблицу.
"""

from __future__ import annotations

import asyncio

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from grafik_api import models  # noqa: F401  (нужен ради регистрации таблиц)
from grafik_api.core.config import get_settings
from grafik_api.core.logging import configure_logging
from grafik_api.db import Base

settings = get_settings()
configure_logging(settings.env, settings.log_level)

target_metadata = Base.metadata


def do_run_migrations(connection: Connection) -> None:
    """Применить миграции на уже открытом соединении."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # Без этих двух `alembic check` и автогенерация не замечают смену
        # типа столбца и серверного значения по умолчанию — то есть ровно
        # те правки, которые забывают донести до базы.
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Поднять соединение и отдать его синхронной части Alembic.

    `NullPool`: соединение нужно одно и на один раз, пул здесь только
    мешал бы закрыться.
    """
    engine = create_async_engine(settings.database_url, poolclass=pool.NullPool)

    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await engine.dispose()


def run_migrations_offline() -> None:
    """Напечатать SQL вместо применения.

    Нужно, когда миграции прогоняет не приложение, а человек с доступом к
    базе: `alembic upgrade head --sql` отдаёт готовый сценарий.
    """
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
