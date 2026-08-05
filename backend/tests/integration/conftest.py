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
def _require_database() -> None:
    """Пропускает весь пакет интеграционных тестов, если Postgres не
    слушает порт из `FPS_DATABASE_DSN`."""
    url = make_url(get_settings().database_dsn)
    host, port = url.host or "localhost", url.port or 5432

    if not _port_open(host, port):
        pytest.skip(
            f"PostgreSQL недоступен на {host}:{port} — запустите `make up` "
            f"(см. docker-compose.yml)",
            allow_module_level=True,
        )
