"""Общая настройка интеграционных тестов.

Здесь живёт одна вещь: аккуратный пропуск всего пакета, когда БД не
поднята.

--- Что было сломано ---------------------------------------------------

Каждый интеграционный модуль объявлял свой `_db_reachable()` вида

    try:
        async with engine.connect(): ...
    except OperationalError:          # <- ловил не тот тип
        return False

и обещал в docstring «skips when Postgres is unreachable — start it with
`make up` first». Обещание не выполнялось: при закрытом порте asyncpg
поднимает `ConnectionRefusedError` (это `OSError`), а SQLAlchemy ошибки
уровня ОС в `OperationalError` не заворачивает. Поэтому `except`
не срабатывал, падала сама фикстура, и разработчик без поднятого
docker-compose получал 48 ошибок с трейсбеками asyncio вместо одной
понятной строки «БД не запущена».

В CI это не проявлялось никогда — там БД поднята всегда, — так что баг
жил ровно в том сценарии, ради которого проверку и писали.

--- Как чинится --------------------------------------------------------

Проверка порта TCP один раз за сессию, до всякого драйвера: без event
loop, без asyncpg, без шанса поймать не тот тип исключения. Локальные
`_db_reachable()` в модулях тоже исправлены (`OSError` добавлен в
`except`), так что каждый файл корректен и сам по себе — эта фикстура
лишь делает сообщение единым и быстрым.

Проверка именно TCP, а не полноценного подключения: цель — отличить
«БД не запущена» от «БД запущена, но что-то не так». Второе должно
падать с настоящей ошибкой, а не прятаться за skip.
"""

from __future__ import annotations

import socket

import pytest
from sqlalchemy.engine import make_url

from src.composition.settings import get_settings


def _port_open(host: str, port: int, *, timeout: float = 1.0) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            return sock.connect_ex((host, port)) == 0
    except OSError:
        return False


@pytest.fixture(scope="session", autouse=True)
def _require_infrastructure() -> None:
    """Пропускает весь пакет интеграционных тестов, если не поднята
    инфраструктура из `docker-compose.yml`.

    Проверяются ОБА порта, Postgres и Redis. Redis добавлен не для
    симметрии: `test_api_router` поднимает целиком FastAPI-приложение и
    дёргает `GET .../effective-version`, который ходит в
    `RuleVersionCache`. При выключенном Redis этот тест падал
    `ConnectionRefusedError`, хотя проверял только доступность БД —
    ровно та же полу-проверка, из-за которой раньше не работал пропуск
    по Postgres.

    Скипать всё, а не только Redis-зависимые тесты, — сознательно:
    контракт этого пакета «прогон против настоящего стека», а стек
    определён docker-compose как Postgres + Redis. Частичный прогон даёт
    ложную уверенность.
    """
    url = make_url(get_settings().database_dsn)
    checks = {
        "PostgreSQL": (url.host or "localhost", url.port or 5432),
        "Redis": _redis_host_port(),
    }

    down = [f"{name} ({host}:{port})" for name, (host, port) in checks.items()
            if not _port_open(host, port)]
    if down:
        pytest.skip(
            f"Недоступно: {', '.join(down)} — запустите `make up` (см. docker-compose.yml)",
            allow_module_level=True,
        )


def _redis_host_port() -> tuple[str, int]:
    """`redis://host:port/db` -> (host, port). `make_url` работает и с
    Redis-URL: это тот же RFC 3986, а не что-то специфичное для SQLAlchemy."""
    url = make_url(get_settings().redis_url.replace("redis://", "redis+driver://", 1))
    return url.host or "localhost", url.port or 6379
