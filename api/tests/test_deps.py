"""Сессия на запрос: либо запрос меняет базу целиком, либо не меняет вовсе.

Это не проверка SQLAlchemy, а проверка решения: фиксация стоит на границе
запроса, а не в ручках. Если её оттуда уберут, оба теста упадут.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any, cast

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from grafik_api.api.deps import SessionDep, SettingsDep, get_session
from grafik_api.core.errors import EmailTakenError
from grafik_api.repositories import UserRepository

АДРЕС = "единица-работы@example.com"


async def test_успешный_запрос_фиксирует_запись(
    приложение: FastAPI, клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    @приложение.post("/api/v1/проба-записи")
    async def проба(session: SessionDep) -> dict[str, str]:
        await UserRepository(session).create(АДРЕС)
        return {"status": "ok"}

    ответ = await клиент.post("/api/v1/проба-записи")

    assert ответ.status_code == 200
    assert await UserRepository(сессия).by_email(АДРЕС) is not None


async def test_ошибка_откатывает_всё_сделанное(
    приложение: FastAPI, клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    """Запись до ошибки не должна остаться — иначе получится полуправка."""

    @приложение.post("/api/v1/проба-отката")
    async def проба(session: SessionDep) -> None:
        await UserRepository(session).create(АДРЕС)
        raise EmailTakenError("передумали на полпути")

    ответ = await клиент.post("/api/v1/проба-отката")

    assert ответ.status_code == 409
    assert await UserRepository(сессия).by_email(АДРЕС) is None


async def test_исключение_доходит_до_сессии_и_та_откатывается(
    фабрика_сессий: async_sessionmaker[AsyncSession], сессия: AsyncSession
) -> None:
    """Прямая проверка зависимости: откат вызывается, а не «так вышло».

    Через HTTP это не отличить — без фиксации записи не остаётся и так.
    Поэтому зависимость раскручивается руками: сначала запись, потом
    исключение внутрь генератора.
    """
    запрос = _заглушка_запроса(фабрика_сессий)
    # Объявленный тип зависимости — итератор; руками нужен именно
    # генератор, которому можно бросить исключение внутрь.
    поток = cast(AsyncGenerator[AsyncSession], get_session(запрос))
    рабочая = await anext(поток)

    await UserRepository(рабочая).create("откат-напрямую@example.com")

    with pytest.raises(RuntimeError):
        await поток.athrow(RuntimeError("сбой после записи"))

    assert await UserRepository(сессия).by_email("откат-напрямую@example.com") is None


async def test_настройки_доступны_ручке(
    приложение: FastAPI, клиент: httpx.AsyncClient
) -> None:
    """Зависимость отдаёт настройки того приложения, что обрабатывает запрос."""

    @приложение.get("/api/v1/проба-настроек")
    async def проба(settings: SettingsDep) -> dict[str, str]:
        return {"env": settings.env}

    ответ = await клиент.get("/api/v1/проба-настроек")

    assert ответ.json() == {"env": "test"}


def _заглушка_запроса(фабрика: async_sessionmaker[AsyncSession]) -> Any:
    """Минимум, который читает `get_session`: фабрика в состоянии приложения."""

    class Состояние:
        sessionmaker = фабрика

    class Приложение:
        state = Состояние()

    class Запрос:
        app = Приложение()

    return Запрос()
