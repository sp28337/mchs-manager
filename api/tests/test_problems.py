"""Ошибки: один формат, ни одной утечки.

Базы этим тестам не нужно. Проверяется форма ответа и то, чего в нём быть
не должно: присланных значений и текста исключения.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from fastapi import Depends, FastAPI
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from grafik_api.api.deps import get_client_ip
from grafik_api.core.config import Settings
from grafik_api.core.errors import (
    RateLimitedError,
    RevConflictError,
    ValidationFailedError,
)
from grafik_api.main import create_app


class Тело(BaseModel):
    """Схема, на которой проверяется отказ."""

    ревизия: int


@pytest.fixture
def приложение_с_пробами() -> FastAPI:
    app = create_app(Settings(env="test"))

    @app.post("/api/v1/доменная")
    async def доменная() -> None:
        raise ValidationFailedError("так нельзя")

    @app.post("/api/v1/конфликт")
    async def конфликт() -> None:
        raise RevConflictError("ревизия устарела", item={"id": "index", "rev": 7})

    @app.post("/api/v1/часто")
    async def часто() -> None:
        raise RateLimitedError(retry_after=42)

    @app.post("/api/v1/схема")
    async def схема(тело: Тело) -> dict[str, int]:
        return {"ревизия": тело.ревизия}

    @app.get("/api/v1/чайник")
    async def чайник() -> None:
        # Свой код так не делает — у него доменные ошибки. Но если кто-то
        # однажды сделает, ответ должен остаться в одном формате.
        raise StarletteHTTPException(status_code=418, detail="я чайник")

    @app.post("/api/v1/необработанная")
    async def необработанная() -> None:
        raise RuntimeError("пароль=пустьнеутечёт")

    return app


def клиент_для(приложение: FastAPI, *, ловить: bool = True) -> httpx.AsyncClient:
    """Клиент к приложению.

    `ловить=False` — чтобы необработанное исключение дошло до обработчика и
    вернулось ответом, а не всплыло в тест: внешний слой Starlette поднимает
    его заново уже после отправки ответа.
    """
    transport = httpx.ASGITransport(app=приложение, raise_app_exceptions=ловить)
    return httpx.AsyncClient(transport=transport, base_url="http://api")


async def test_доменная_ошибка_это_problem_json(приложение_с_пробами: FastAPI) -> None:
    async with клиент_для(приложение_с_пробами) as client:
        ответ = await client.post("/api/v1/доменная")

    assert ответ.status_code == 422
    assert ответ.headers["content-type"].startswith("application/problem+json")

    тело: dict[str, Any] = ответ.json()
    assert тело["code"] == "validation_failed"
    assert тело["status"] == 422
    assert тело["type"] == "https://grafik13.ru/problems/validation-failed"
    assert тело["detail"] == "так нельзя"
    assert тело["title"]

    # Идентификатор запроса и в теле, и в заголовке: по нему человек
    # присылает жалобу, а мы находим журнал.
    assert тело["request_id"] == ответ.headers["x-request-id"]


async def test_дополнительные_поля_доезжают(приложение_с_пробами: FastAPI) -> None:
    """RFC 9457 разрешает свои члены — конфликт ревизий ими и пользуется."""
    async with клиент_для(приложение_с_пробами) as client:
        ответ = await client.post("/api/v1/конфликт")

    assert ответ.status_code == 409
    assert ответ.json()["item"] == {"id": "index", "rev": 7}


async def test_предел_частоты_подсказывает_когда_повторить(
    приложение_с_пробами: FastAPI,
) -> None:
    async with клиент_для(приложение_с_пробами) as client:
        ответ = await client.post("/api/v1/часто")

    assert ответ.status_code == 429
    assert ответ.headers["retry-after"] == "42"
    assert ответ.json()["retry_after"] == 42


async def test_отказ_схемы_не_показывает_присланное(
    приложение_с_пробами: FastAPI,
) -> None:
    """Иначе в ответе (и в чужих журналах) оказывается то, что прислали."""
    секрет = "петров@example.com"

    async with клиент_для(приложение_с_пробами) as client:
        ответ = await client.post("/api/v1/схема", json={"ревизия": секрет})

    assert ответ.status_code == 422
    assert ответ.json()["code"] == "validation_failed"
    assert секрет not in ответ.text

    ошибки = ответ.json()["errors"]
    assert ошибки[0]["loc"] == "body.ревизия"
    assert ошибки[0]["msg"]
    assert ошибки[0]["type"]


async def test_незнакомый_путь_и_метод(приложение_с_пробами: FastAPI) -> None:
    async with клиент_для(приложение_с_пробами) as client:
        нет_пути = await client.get("/api/v1/нет-такого")
        нет_метода = await client.get("/api/v1/доменная")

    assert нет_пути.status_code == 404
    assert нет_пути.json()["code"] == "not_found"
    assert нет_пути.headers["content-type"].startswith("application/problem+json")

    assert нет_метода.status_code == 405
    assert нет_метода.json()["code"] == "method_not_allowed"


async def test_необработанная_ошибка_не_рассказывает_подробностей(
    приложение_с_пробами: FastAPI,
) -> None:
    async with клиент_для(приложение_с_пробами, ловить=False) as client:
        ответ = await client.post("/api/v1/необработанная")

    assert ответ.status_code == 500

    тело = ответ.json()
    assert тело["code"] == "internal_error"
    # Идентификатор запроса есть даже здесь — хотя этот ответ уходит мимо
    # нашей прослойки.
    assert тело["request_id"] == ответ.headers["x-request-id"]
    assert тело["request_id"] != "-"

    # Ни текста исключения, ни следа стека.
    assert "пустьнеутечёт" not in ответ.text
    assert "RuntimeError" not in ответ.text
    assert "Traceback" not in ответ.text


async def test_неготовность_тоже_problem_json() -> None:
    """`/readyz` без базы отвечает в том же формате, что и всё остальное."""
    app = create_app(Settings(env="test"))

    async with клиент_для(app) as client:
        ответ = await client.get("/api/v1/readyz")

    assert ответ.status_code == 503
    assert ответ.json()["code"] == "service_unavailable"
    assert ответ.headers["content-type"].startswith("application/problem+json")


async def test_http_ошибка_без_доменного_кода(приложение_с_пробами: FastAPI) -> None:
    """Статус сохраняется, код — общий, и в журнале остаётся след."""
    async with клиент_для(приложение_с_пробами) as client:
        ответ = await client.get("/api/v1/чайник")

    assert ответ.status_code == 418
    assert ответ.json()["code"] == "internal_error"
    assert ответ.json()["title"] == "я чайник"


async def test_адрес_клиента_не_адрес() -> None:
    """Собеседник без внятного адреса (например, через unix-сокет)."""
    app = create_app(Settings(env="test"))

    @app.get("/api/v1/кто-там")
    async def кто_там(адрес: str | None = Depends(get_client_ip)) -> dict[str, Any]:
        return {"ip": адрес}

    transport = httpx.ASGITransport(app=app, client=("не-адрес", 0))
    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        ответ = await client.get(
            "/api/v1/кто-там", headers={"X-Forwarded-For": "203.0.113.9"}
        )

    # Доверять заголовку нельзя: собеседник не опознан как свой прокси.
    assert ответ.json()["ip"] == "не-адрес"
