"""Тестовый контур: база, транзакции, приложение, клиент.

--- Как это устроено -------------------------------------------------------

Схема создаётся **миграциями**, а не `create_all`: тест должен работать на
той же схеме, что и бой, иначе забытая миграция обнаружится на выкладке.
Прогоняются они один раз на весь прогон.

Каждый тест живёт в **своей транзакции, которая всегда откатывается**.
Приёмы два, и оба нужны:

* соединение открывается на тест, и на нём открывается транзакция; в конце
  — безусловный откат, поэтому база после теста та же, что до него;
* сессии (и тестовая, и та, что получит ручка) привязаны к этому
  соединению в режиме `create_savepoint`. Поэтому `commit()` внутри
  приложения — настоящая фиксация с точки зрения кода, но для внешней
  транзакции это лишь снятие точки сохранения, и откат всё равно
  сработает.

Без второго приёма пришлось бы либо запрещать приложению фиксировать
транзакцию (тогда не проверяется то, что оно делает в бою), либо чистить
таблицы после каждого теста (медленно и вечно забывается новая таблица).

Жизненный цикл приложения в тестах **не запускается**: он создал бы свой
движок и перезаписал бы фабрику сессий, привязанную к нашему соединению.
Всё, что ему положено делать, проверяется отдельно.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from sqlalchemy import NullPool, create_engine, text
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from grafik_api.api.deps import get_mailer
from grafik_api.core.config import Settings, get_settings
from grafik_api.db import Base
from grafik_api.main import create_app
from tests.factories import Почта

КОРЕНЬ = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def адрес_базы() -> str:
    """Адрес тестовой базы или пропуск теста.

    Пропуск, а не падение: без базы остаётся ещё полсотни тестов, которые
    ей не нужны, и гонять их должно быть можно одной командой.
    """
    адрес = os.getenv("GRAFIK_TEST_DATABASE_URL")

    if not адрес:
        pytest.skip("нужна тестовая база: GRAFIK_TEST_DATABASE_URL")

    return адрес


@pytest.fixture(scope="session")
def схема(адрес_базы: str) -> str:
    """Поднять схему миграциями — один раз на прогон.

    Переменная окружения ставится до вызова: `migrations/env.py` берёт
    адрес из настроек, а они кэшируются, поэтому кэш сбрасывается.
    """
    os.environ["GRAFIK_DATABASE_URL"] = адрес_базы
    get_settings.cache_clear()

    command.upgrade(Config(toml_file=str(КОРЕНЬ / "pyproject.toml")), "head")

    # И сразу очистить. Транзакция теста откатывается, но базу могли
    # засеять снаружи — например, ручной пробой через curl, — и тест,
    # который смотрит «единственную строку в таблице», сломался бы из-за
    # чужого мусора. Один `TRUNCATE` на прогон дешевле такой загадки.
    движок = create_engine(адрес_базы)
    таблицы = ", ".join(таблица.name for таблица in Base.metadata.sorted_tables)
    with движок.begin() as соединение:
        соединение.execute(text(f"TRUNCATE {таблицы} CASCADE"))
    движок.dispose()

    return адрес_базы


@pytest.fixture
async def соединение(схема: str) -> AsyncIterator[AsyncConnection]:
    """Соединение с открытой транзакцией, которая будет откачена."""
    # NullPool: соединение нужно одно и на один тест, пул только мешал бы
    # закрыться вместе с движком.
    движок = create_async_engine(схема, poolclass=NullPool)

    async with движок.connect() as соединение:
        транзакция = await соединение.begin()
        try:
            yield соединение
        finally:
            await транзакция.rollback()

    await движок.dispose()


@pytest.fixture
def фабрика_сессий(
    соединение: AsyncConnection,
) -> async_sessionmaker[AsyncSession]:
    """Фабрика сессий на том же соединении, что и транзакция теста."""
    return async_sessionmaker(
        bind=соединение,
        expire_on_commit=False,
        autoflush=False,
        # Вот это и позволяет приложению честно вызывать `commit()`.
        join_transaction_mode="create_savepoint",
    )


@pytest.fixture
async def сессия(
    фабрика_сессий: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    """Сессия для самого теста: ею готовят данные и проверяют результат."""
    async with фабрика_сессий() as сессия:
        yield сессия


@pytest.fixture
def почта() -> Почта:
    """Почтовый ящик вместо SMTP: письма складываются в список."""
    return Почта()


@pytest.fixture
def приложение(
    схема: str,
    фабрика_сессий: async_sessionmaker[AsyncSession],
    почта: Почта,
) -> FastAPI:
    """Настоящее приложение, но с базой внутри транзакции теста.

    Отправщик писем подменяется всегда, а не только там, где письма
    проверяют: регистрация отправляет письмо, и без подмены любой тест,
    создающий аккаунт, полез бы в сеть за несуществующим `mailpit`.
    """
    app = create_app(Settings(env="test", database_url=схема))
    app.state.sessionmaker = фабрика_сессий
    app.dependency_overrides[get_mailer] = lambda: почта
    return app


@pytest.fixture
async def клиент(приложение: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    """Клиент к приложению без сокета и без свободного порта.

    Адрес с `https`, хотя сокета нет вовсе: cookie с `Secure` по открытому
    каналу не отправляется, и проверки обновления токена на `http` молча
    ломались бы — не потому, что код плохой, а потому что клиент ведёт
    себя правильно.
    """
    transport = httpx.ASGITransport(app=приложение)

    async with httpx.AsyncClient(transport=transport, base_url="https://api") as клиент:
        yield клиент
