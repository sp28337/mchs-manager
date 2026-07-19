"""Alembic async env — pattern verified against Context7 (/websites/alembic_sqlalchemy,
cookbook: 'Update env.py for Async Migrations') and cross-checked against the
literal output of `alembic init -t async`.

DSN is read from `composition.settings.Settings.database_dsn` — the single
place DSN is configured (Backend_Architecture_FastAPI_Stack_FPS.md, разд. 6.3),
never duplicated into alembic.ini.

`target_metadata` is deliberately `None` for now: no module has an
Infrastructure/Write layer yet (DB phase in the backlog ships hand-written
DDL migrations first — see PostgreSQL_Logical_Model_FPS.md, "Без ORM" —
ORM Data-Mapper tables are attached to `target_metadata` starting with
LR004, once `legal_rules`'s imperative mapping exists). Autogenerate is not
usable yet and is not required for the DB-phase migrations, which are
hand-written per Backend_Architecture разд. 5 anyway (EXCLUDE constraints,
extensions, partial unique indexes are always manual).
"""

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from src.composition.settings import get_settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Overrides the blank `sqlalchemy.url` in alembic.ini with the validated
# Settings DSN. asyncpg DSN is used as-is: async_engine_from_config builds
# an AsyncEngine directly from it.
config.set_main_option("sqlalchemy.url", get_settings().database_dsn)

target_metadata = None  # see module docstring


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
