"""Проверка живости — сквозным запросом, а не вызовом функции.

Клиент ходит через `ASGITransport`: это настоящее приложение со всей
обработкой запроса, но без сокета и без свободного порта. Жизненный цикл
(`lifespan`) здесь не запускается — для /healthz он не нужен, а полноценный
клиент с жизненным циклом и подменной базой появится в `conftest.py` на
шаге 6.
"""

from __future__ import annotations

import logging
import tomllib
from pathlib import Path

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from grafik_api import __version__
from grafik_api.core.config import Settings
from grafik_api.main import create_app


async def test_healthz_отвечает_версией() -> None:
    app = create_app(Settings(env="test"))

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        response = await client.get("/api/v1/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}


async def test_в_бою_описание_api_закрыто() -> None:
    """В прод-окружении /docs и /openapi.json не отдаются.

    Проверяется поведением, а не значением настройки: смысл в том, что
    ручки нет, а не в том, что флаг выключен.
    """
    # Боевые настройки требуют своих секретов — иначе приложение не
    # поднимается вовсе (это проверяется в test_security.py).
    app = create_app(Settings(env="prod", pepper="x" * 40, jwt_secret="y" * 40))

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        assert (await client.get("/docs")).status_code == 404
        assert (await client.get("/openapi.json")).status_code == 404


def test_версия_пакета_совпадает_с_pyproject() -> None:
    """Версия объявлена в двух местах, и они обязаны совпадать.

    Расхождение тихое и неприятное: /healthz показывает одно, а выпущен
    другой — и разбор происшествия начинается с неверного предположения.
    """
    pyproject = Path(__file__).resolve().parents[1] / "pyproject.toml"
    with pyproject.open("rb") as file:
        declared = tomllib.load(file)["project"]["version"]

    assert declared == __version__


async def test_жизненный_цикл_пишет_в_журнал(caplog: pytest.LogCaptureFixture) -> None:
    """Запуск и остановка должны быть видны в журнале.

    Без этих двух записей невозможно отличить «приложение не поднялось» от
    «поднялось и сразу упало»: первое видно по отсутствию записи о запуске,
    второе — по наличию обеих.

    Жизненный цикл запускается здесь напрямую: `ASGITransport` его не
    трогает, а клиент с полным циклом и подменной базой появится в
    `conftest.py` на шаге 6.
    """
    app = create_app(Settings(env="test"))

    with caplog.at_level(logging.INFO, logger="grafik.api.main"):
        async with app.router.lifespan_context(app):
            pass

    messages = [record.getMessage() for record in caplog.records]
    assert any("запускается" in message for message in messages)
    assert any("остановлено" in message for message in messages)


async def test_cors_только_при_разработке(
    фабрика_сессий: async_sessionmaker[AsyncSession], схема: str
) -> None:
    """В бою межсайтовых запросов нет: сайт и API на одном домене.

    Включённый в бою CORS — приглашение чужой странице ходить к нашему API
    с cookie человека, поэтому заголовка там быть не должно вовсе.
    """
    for env, ожидается in (("dev", True), ("test", False), ("prod", False)):
        настройки = Settings(
            env=env,
            database_url=схема,
            pepper=SecretStr("перец-для-проверки-окружения-в-бою-32"),
            jwt_secret=SecretStr("подпись-для-проверки-окружения-в-бою-32"),
        )
        app = create_app(настройки)
        app.state.sessionmaker = фабрика_сессий

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="https://api"
        ) as клиент:
            ответ = await клиент.get(
                "/api/v1/healthz", headers={"Origin": "http://localhost:3000"}
            )

        assert ответ.status_code == 200
        есть = "access-control-allow-origin" in ответ.headers
        assert есть is ожидается, env
