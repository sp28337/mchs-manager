"""Готовность: ручка `/readyz` обязана зависеть от базы.

Отказ проверяется без базы — именно в этом и смысл: приложение, которое не
может достать соединение, должно говорить «не готово», а не делать вид, что
всё хорошо. Успех проверяется только там, где база есть: локально и в CI
адрес приходит в `GRAFIK_TEST_DATABASE_URL`.
"""

from __future__ import annotations

import os

import httpx
import pytest

from grafik_api.core.config import Settings
from grafik_api.main import create_app

ТЕСТОВАЯ_БАЗА = os.getenv("GRAFIK_TEST_DATABASE_URL")


async def test_без_соединения_не_готово() -> None:
    """Жизненный цикл не запускался — фабрики сессий нет."""
    app = create_app(Settings(env="test"))

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        ответ = await client.get("/api/v1/readyz")

    assert ответ.status_code == 503
    # Живость при этом не страдает: процесс-то жив.
    assert (await _живость(app)) == 200


async def test_база_недоступна_не_готово() -> None:
    """Адрес есть, базы по нему нет — тоже «не готово», а не 500."""
    app = create_app(
        Settings(
            env="test",
            database_url="postgresql+psycopg://grafik@127.0.0.1:1/грядка",
        )
    )

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://api"
        ) as client:
            ответ = await client.get("/api/v1/readyz")

    assert ответ.status_code == 503


@pytest.mark.skipif(
    not ТЕСТОВАЯ_БАЗА, reason="нужен GRAFIK_TEST_DATABASE_URL с живой базой"
)
async def test_с_живой_базой_готово() -> None:
    app = create_app(Settings(env="test", database_url=ТЕСТОВАЯ_БАЗА or ""))

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://api"
        ) as client:
            ответ = await client.get("/api/v1/readyz")

    assert ответ.status_code == 200
    assert ответ.json()["status"] == "ready"


async def _живость(app: object) -> int:
    transport = httpx.ASGITransport(app=app)  # type: ignore[arg-type]
    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        return (await client.get("/api/v1/healthz")).status_code
