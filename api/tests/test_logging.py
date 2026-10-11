"""Проверки журналирования.

Главное, что здесь проверяется, — не формат ради формата, а два обещания:

* у всех записей одного запроса общий `request_id`, иначе разбирать
  происшествие в асинхронном приложении нечем;
* в журнал не попадают персональные данные и секреты (раздел 9 контракта и
  `docs/legal/data-map.md`).
"""

from __future__ import annotations

import io
import json
import logging
from collections.abc import Iterator
from typing import Any, cast

import httpx
import pytest
from starlette.types import Message, Receive, Scope, Send

from grafik_api.core.config import Settings
from grafik_api.core.context import get_user_id, request_id_var, user_id_var
from grafik_api.core.logging import (
    JsonFormatter,
    RequestContextFilter,
    SensitiveDataFormatter,
    configure_logging,
    get_logger,
    logging_config,
)
from grafik_api.main import create_app
from grafik_api.middleware.request_context import RequestContextMiddleware

# Логгеры, состояние которых правит наша настройка: их надо вернуть на
# место, иначе тест переделает журналирование соседям по прогону.
ЗАТРАГИВАЕМЫЕ = ("uvicorn", "uvicorn.access", "sqlalchemy.engine")


@pytest.fixture
def журнал() -> Iterator[io.StringIO]:
    """Настоящий конвейер журналирования, но вывод — в память.

    Настройка `dictConfig` меняет состояние всего процесса, поэтому до и
    после теста состояние снимается и возвращается: иначе соседний тест
    остался бы без перехвата записей.
    """
    root = logging.getLogger()
    было_handlers = root.handlers[:]
    было_level = root.level
    было_имена = {
        имя: (
            logging.getLogger(имя).level,
            logging.getLogger(имя).handlers[:],
            logging.getLogger(имя).propagate,
        )
        for имя in ЗАТРАГИВАЕМЫЕ
    }

    configure_logging(environment="test", level="DEBUG")

    stream = io.StringIO()
    наш = next(
        handler
        for handler in root.handlers
        if isinstance(handler.formatter, SensitiveDataFormatter)
    )
    cast(logging.StreamHandler[Any], наш).setStream(stream)

    yield stream

    root.handlers[:] = было_handlers
    root.level = было_level
    for имя, (level, handlers, propagate) in было_имена.items():
        logger = logging.getLogger(имя)
        logger.level = level
        logger.handlers[:] = handlers
        logger.propagate = propagate


def записи(stream: io.StringIO) -> list[dict[str, Any]]:
    """Разобрать вывод: одна строка — одна запись."""
    return [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]


def запись(stream: io.StringIO, event: str) -> dict[str, Any]:
    """Первая запись с таким событием."""
    подходящие = [item for item in записи(stream) if item.get("event") == event]
    assert подходящие, f"записи с event={event} нет: {stream.getvalue()}"
    return подходящие[0]


def создать_запись(**kwargs: Any) -> logging.LogRecord:
    """Запись журнала без логгера — чтобы проверять форматтер в одиночку."""
    поля: dict[str, Any] = {
        "name": "grafik.test",
        "level": logging.INFO,
        "pathname": __file__,
        "lineno": 1,
        "msg": "сообщение",
        "args": (),
        "exc_info": None,
    }
    поля.update(kwargs)
    return logging.LogRecord(**поля)


# --- Формат ----------------------------------------------------------------


def test_одна_запись_это_одна_строка_json() -> None:
    """Многострочный JSON ломает любой сборщик журналов."""
    строка = JsonFormatter(environment="test").format(
        создать_запись(msg="заказ %s создан", args=("12",))
    )

    assert "\n" not in строка

    данные = json.loads(строка)
    assert данные["message"] == "заказ 12 создан"
    assert данные["level"] == "INFO"
    assert данные["logger"] == "grafik.test"
    assert данные["service"] == "grafik-api"
    assert данные["environment"] == "test"
    assert данные["request_id"] == "-"
    assert данные["user_id"] == "-"
    assert данные["timestamp"].endswith("+00:00")


def test_русский_текст_не_экранируется() -> None:
    """`ensure_ascii=False`: иначе журнал читается только через декодер."""
    строка = JsonFormatter().format(создать_запись(msg="смена сдана"))

    assert "смена сдана" in строка


def test_поля_из_extra_попадают_в_запись() -> None:
    """Конкретика передаётся через `extra`, а не вклеивается в текст."""
    запись_ = создать_запись(msg="запрос обработан")
    запись_.event = "http.access"
    запись_.status = 200
    запись_.duration_ms = 3.5

    данные = json.loads(JsonFormatter().format(запись_))

    assert данные["event"] == "http.access"
    assert данные["status"] == 200
    assert данные["duration_ms"] == 3.5


def test_раскраска_uvicorn_в_запись_не_попадает() -> None:
    """uvicorn кладёт в `extra` ту же строку с ANSI-кодами — в JSON ей нечего делать."""
    запись_ = создать_запись(msg="Started server process [1]")
    запись_.color_message = "Started server process [\u001b[36m%d\u001b[0m]"

    данные = json.loads(JsonFormatter().format(запись_))

    assert "color_message" not in данные
    assert данные["message"] == "Started server process [1]"


def test_исключение_попадает_в_запись() -> None:
    try:
        raise ValueError("так нельзя")
    except ValueError:
        import sys

        запись_ = создать_запись(level=logging.ERROR, exc_info=sys.exc_info())

    данные = json.loads(JsonFormatter().format(запись_))

    assert "ValueError: так нельзя" in данные["exception"]
    assert "\n" not in JsonFormatter().format(запись_)


# --- Контекст --------------------------------------------------------------


def test_фильтр_не_правит_исходную_запись() -> None:
    """Фильтр отдаёт копию: иначе правка утечёт в другие обработчики."""
    исходная = создать_запись()

    получилось = RequestContextFilter().filter(исходная)

    assert получилось is not исходная
    assert not hasattr(исходная, "request_id")
    assert получилось.request_id == "-"  # type: ignore[attr-defined]


def test_фильтр_подставляет_идентификаторы() -> None:
    token_r = request_id_var.set("abc123")
    token_u = user_id_var.set("00000000-0000-0000-0000-000000000001")
    assert get_user_id() == "00000000-0000-0000-0000-000000000001"
    try:
        получилось = RequestContextFilter().filter(создать_запись())
    finally:
        request_id_var.reset(token_r)
        user_id_var.reset(token_u)

    данные = json.loads(JsonFormatter().format(получилось))
    assert данные["request_id"] == "abc123"
    assert данные["user_id"] == "00000000-0000-0000-0000-000000000001"


# --- Маскирование ----------------------------------------------------------


@pytest.mark.parametrize(
    ("текст", "чего_быть_не_должно"),
    [
        ("вошёл ivan.petrov@example.com", "ivan.petrov@example.com"),
        ("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.подпись", "eyJ"),
        ("token=s3cret-value", "s3cret-value"),
        ("password: очень-секретно", "очень-секретно"),
        ("verifier=" + "A" * 43, "A" * 43),
        ("блоб: " + "x" * 64, "x" * 64),
    ],
)
def test_секреты_замазываются(текст: str, чего_быть_не_должно: str) -> None:
    """Последняя линия обороны — но она должна работать."""
    строка = SensitiveDataFormatter().format(создать_запись(msg=текст))

    assert чего_быть_не_должно not in строка
    assert "***" in строка


def test_идентификаторы_не_замазываются() -> None:
    """uuid без дефисов — 32 знака, и его видеть надо."""
    идентификатор = "7b02f6b428284986b33c2a43d37c33db"

    строка = SensitiveDataFormatter().format(
        создать_запись(msg=f"запрос {идентификатор} обработан")
    )

    assert идентификатор in строка


# --- Настройка -------------------------------------------------------------


def test_настройка_пишет_только_в_stdout() -> None:
    """Из кода не пишем ни в файл, ни в сеть — только в stdout.

    Проверяется словарь настройки, а не состояние процесса: так видно
    намерение, и тест ничего не ломает соседям.
    """
    config = logging_config(environment="prod", level="INFO")

    assert list(config["handlers"]) == ["stdout"]
    assert config["handlers"]["stdout"]["stream"] == "ext://sys.stdout"
    assert config["root"] == {"level": "INFO", "handlers": ["stdout"]}
    assert config["disable_existing_loggers"] is False


def test_настройка_ставит_наш_обработчик(журнал: io.StringIO) -> None:
    """Обработчик на месте, с нашим форматтером и нашим фильтром.

    Обработчиков у корня больше одного: pytest добавляет свои, чтобы
    перехватывать записи. Поэтому ищем свой, а не считаем все.
    """
    наши = [
        handler
        for handler in logging.getLogger().handlers
        if isinstance(handler.formatter, SensitiveDataFormatter)
    ]

    assert len(наши) == 1
    assert isinstance(наши[0].filters[0], RequestContextFilter)


def test_логи_uvicorn_уходят_в_наш_обработчик(журнал: io.StringIO) -> None:
    """У uvicorn свой формат; забираем его записи себе."""
    assert logging.getLogger("uvicorn").handlers == []
    assert logging.getLogger("uvicorn").propagate is True
    # Журнал доступа пишем сами — у uvicorn он без идентификатора запроса.
    assert logging.getLogger("uvicorn.access").level == logging.WARNING
    # В параметрах запросов SQLAlchemy наши блобы и хэши.
    assert logging.getLogger("sqlalchemy.engine").level == logging.WARNING

    logging.getLogger("uvicorn.error").info("Application startup complete.")

    assert записи(журнал)[-1]["logger"] == "uvicorn.error"


def test_чужие_логгеры_не_выключаются(журнал: io.StringIO) -> None:
    """`disable_existing_loggers: false` — половина полезного из библиотек."""
    assert logging.getLogger("какая_то_библиотека").disabled is False


# --- Сквозь HTTP -----------------------------------------------------------


async def test_идентификатор_запроса_один_на_все_записи(журнал: io.StringIO) -> None:
    app = create_app(Settings(env="test"))

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        ответ = await client.get("/api/v1/healthz")

    из_заголовка = ответ.headers["x-request-id"]
    assert из_заголовка

    доступ = запись(журнал, "http.access")
    начало = запись(журнал, "http.request")
    assert доступ["request_id"] == из_заголовка
    assert начало["request_id"] == из_заголовка
    assert доступ["status"] == 200
    assert доступ["method"] == "GET"
    assert доступ["path"] == "/api/v1/healthz"
    assert доступ["duration_ms"] >= 0


async def test_у_разных_запросов_разные_идентификаторы(журнал: io.StringIO) -> None:
    app = create_app(Settings(env="test"))

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        первый = await client.get("/api/v1/healthz")
        второй = await client.get("/api/v1/healthz")

    assert первый.headers["x-request-id"] != второй.headers["x-request-id"]


async def test_годный_чужой_идентификатор_принимается(журнал: io.StringIO) -> None:
    """Запрос должен прослеживаться от браузера через nginx до нас."""
    app = create_app(Settings(env="test"))

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        ответ = await client.get(
            "/api/v1/healthz", headers={"X-Request-Id": "from-nginx-1"}
        )

    assert ответ.headers["x-request-id"] == "from-nginx-1"
    assert запись(журнал, "http.access")["request_id"] == "from-nginx-1"


@pytest.mark.parametrize(
    "негодный", ["x" * 65, "id with spaces", "id;with;semicolons", ""]
)
async def test_негодный_идентификатор_заменяется(
    журнал: io.StringIO, негодный: str
) -> None:
    """Иначе клиент пишет в наш журнал что угодно и какой угодно длины."""
    app = create_app(Settings(env="test"))

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        ответ = await client.get("/api/v1/healthz", headers={"X-Request-Id": негодный})

    получился = ответ.headers["x-request-id"]
    assert получился != негодный
    assert len(получился) == 32


async def test_необработанное_исключение_попадает_в_журнал(журнал: io.StringIO) -> None:
    app = create_app(Settings(env="test"))

    @app.get("/api/v1/сломайся")
    async def сломайся() -> None:
        raise RuntimeError("гайка открутилась")

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        ответ = await client.get("/api/v1/сломайся")

    assert ответ.status_code == 500

    ошибка = запись(журнал, "http.error")
    assert "RuntimeError: гайка открутилась" in ошибка["exception"]
    assert ошибка["path"] == "/api/v1/сломайся"
    assert ошибка["duration_ms"] >= 0


async def test_в_журнале_нет_ни_адреса_почты_ни_блоба(журнал: io.StringIO) -> None:
    """Сквозная проверка обещания из контракта."""
    app = create_app(Settings(env="test"))
    logger = get_logger("service.test")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        await client.get("/api/v1/healthz")
        logger.info(
            "регистрация: %s",
            "petrov@example.com",
            extra={"wrapped_dek": "B" * 64},
        )

    вывод = журнал.getvalue()
    assert "petrov@example.com" not in вывод
    assert "B" * 64 not in вывод
    assert "***" in вывод


def test_секреты_замазываются_и_во_вложенных_полях() -> None:
    """`extra` может нести словарь и список — внутрь надо заглядывать."""
    запись_ = создать_запись(msg="разбор запроса")
    запись_.detail = {
        "email": "petrov@example.com",
        "wrapped": ["C" * 48, 7],
    }

    строка = SensitiveDataFormatter().format(запись_)

    assert "petrov@example.com" not in строка
    assert "C" * 48 not in строка
    # Числа не портим: по ним считают.
    assert "7" in строка


def test_стек_попадает_в_запись() -> None:
    """`stack_info=True` просят, когда нужен путь вызова без исключения."""
    запись_ = создать_запись()
    запись_.stack_info = "Stack (most recent call last):\n  строка"

    данные = json.loads(JsonFormatter().format(запись_))

    assert "Stack (most recent call last)" in данные["stack"]


async def test_нehttp_запросы_проходят_мимо(журнал: io.StringIO) -> None:
    """Прослойка трогает только HTTP: у жизненного цикла нет ни пути, ни кода."""
    пройдено: list[str] = []

    async def приложение(scope: Scope, receive: Receive, send: Send) -> None:
        пройдено.append(scope["type"])

    прослойка = RequestContextMiddleware(приложение)
    await прослойка({"type": "lifespan"}, _нет_приёма, _нет_отправки)

    assert пройдено == ["lifespan"]
    # Своих записей прослойка не оставила. Сравнивать со «совсем пусто»
    # нельзя: при уровне DEBUG в журнал пишет и сам asyncio.
    assert [
        item for item in записи(журнал) if item["logger"].startswith("grafik")
    ] == []


async def _нет_приёма() -> Message:  # pragma: no cover - вызываться не должен
    raise AssertionError("приём сообщений здесь не нужен")


async def _нет_отправки(message: Message) -> None:  # pragma: no cover
    raise AssertionError("отправка здесь не нужна")
