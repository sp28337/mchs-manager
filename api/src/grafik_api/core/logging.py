"""Журналирование: одна строка — один JSON, и никаких персональных данных.

Устроено по книге «Логирующий Python»: настройка декларативная
(`dictConfig`), контекст запроса подмешивается фильтром, формат — JSON,
вывод — только в stdout.

--- Почему именно так ------------------------------------------------------

**JSON.** Журнал читают не глазами, а инструментами: «покажи всё по этому
запросу», «покажи ошибки за час». Разбирать для этого строки форматом
`%(asctime)s %(message)s` — лишняя работа и источник ошибок. Одна запись —
одна строка: многострочный JSON ломает любой сборщик.

**Фильтр, а не аргумент.** Идентификатор запроса не передаётся в каждый
вызов `logger.info(...)` — его подмешивает `RequestContextFilter`, читая
контекстную переменную. Фильтр возвращает **копию** записи (это умеет
Python 3.12+): если править пришедший объект, правка станет видна другим
обработчикам, которых мы не знаем.

**Только stdout.** Приложение живёт в контейнере и в нескольких процессах.
Писать из кода в файл — значит получить гонку за файл между процессами;
собирает журналы драйвер логов Docker, дальше (по главе книги) VictoriaLogs.
Очередь (`QueueHandler`) не нужна: она нужна, когда обработчик ходит в сеть
или на диск, а запись в stdout не блокирует.

**Маскирование — последняя линия.** Правило первично: чувствительное в
журнал просто не передаётся. `SensitiveDataFormatter` стоит на случай
чужой библиотеки и собственной невнимательности и надёжной защитой не
является: формат секрета заранее неизвестен.
"""

from __future__ import annotations

import copy
import json
import logging
import logging.config
import re
from datetime import UTC, datetime
from typing import Any, Final

from grafik_api.core.context import NO_VALUE, get_request_id, get_user_id

# Имя службы в каждой записи: когда журналы нескольких приложений лежат в
# одном хранилище, без него непонятно, чей это INFO.
SERVICE: Final = "grafik-api"

# Корень нашей иерархии логгеров. Не совпадает с именем пакета (`grafik_api`)
# намеренно: в журнале нужен устойчивый адрес вида `grafik.api.sync`, который
# не поедет от переименования модуля.
ROOT_LOGGER: Final = "grafik"

# Поля, которые `logging` ставит сам. Всё, чего здесь нет, пришло из
# `extra=...` и попадает в JSON как есть — так в записи оказываются
# `event`, `status`, `duration_ms` и прочая конкретика.
_OWN_ATTRS: Final[frozenset[str]] = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "module",
        "msecs",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "taskName",
        "thread",
        "threadName",
        # Не наше и не нужное: uvicorn передаёт в `extra` ту же строку с
        # управляющими последовательностями ANSI для раскраски в консоли.
        # В JSON это мусор, который ещё и экранируется.
        "color_message",
    }
)

_MASK: Final = "***"

# Порядок правил важен: адрес почты ловится раньше, чем «длинная строка»,
# иначе от него останется неразличимое `***@***`.
_SENSITIVE: Final[tuple[tuple[re.Pattern[str], str], ...]] = (
    # Адрес почты — единственное, чем мы опознаём человека, и в журнале его
    # быть не должно вообще.
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]{2,}"), _MASK),
    # Заголовок авторизации целиком: и схема, и значение.
    (re.compile(r"\b(Bearer|Basic)\s+[\w.\-+/=]+", re.IGNORECASE), r"\1 " + _MASK),
    # `token=...`, `password: ...` и прочие пары «имя секрета — значение».
    (
        re.compile(
            r"\b(pass(?:word)?|pwd|token|verifier|secret|pepper|cookie|"
            r"authorization|dek|kek|wrapped\w*|blob|recovery\w*|salt|nonce)\b"
            r"(\s*[=:]\s*)\S+",
            re.IGNORECASE,
        ),
        r"\1\2" + _MASK,
    ),
    # JWT: три части через точку, первая почти всегда начинается на `eyJ`.
    (
        re.compile(r"\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]+"),
        _MASK,
    ),
    # Длинная строка без разделителей: блоб, обёртка ключа, проверочное
    # значение, хэш. Порог в 40 знаков выбран так, чтобы не задеть uuid без
    # дефисов (32) — им обозначаются запросы и аккаунты, и их видеть надо.
    (re.compile(r"\b[\w-]{40,}={0,2}"), _MASK),
)


class RequestContextFilter(logging.Filter):
    """Подмешивает в запись идентификаторы запроса и пользователя.

    Возвращает копию записи, а не `True`: так изменение не утекает в другие
    обработчики, которым эта запись тоже достанется (поведение Python 3.12+).
    """

    def filter(self, record: logging.LogRecord) -> logging.LogRecord:
        record = copy.copy(record)
        record.request_id = get_request_id()
        record.user_id = get_user_id()
        return record


class JsonFormatter(logging.Formatter):
    """Превращает запись в одну строку JSON."""

    def __init__(self, environment: str = "dev", service: str = SERVICE) -> None:
        super().__init__()
        self.environment = environment
        self.service = service

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "service": self.service,
            "environment": self.environment,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", NO_VALUE),
            "user_id": getattr(record, "user_id", NO_VALUE),
        }

        for key, value in record.__dict__.items():
            if key not in _OWN_ATTRS and key not in payload:
                payload[key] = value

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack"] = self.formatStack(record.stack_info)

        # `default=str` — чтобы незнакомый объект в `extra` не ронял
        # журналирование: запись о сбое важнее идеальной сериализации.
        return json.dumps(self.scrub(payload), ensure_ascii=False, default=str)

    def scrub(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Точка, в которой наследник прячет чувствительное."""
        return payload


class SensitiveDataFormatter(JsonFormatter):
    """Тот же JSON, но с замазанными секретами.

    Последняя линия обороны, а не защита: формат секрета заранее неизвестен,
    и единственное надёжное правило — не передавать чувствительное в журнал.
    """

    def scrub(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {key: _hide(value) for key, value in payload.items()}


def _hide(value: Any) -> Any:
    """Пройтись правилами по строке, а по вложенным структурам — рекурсивно."""
    if isinstance(value, str):
        for pattern, replacement in _SENSITIVE:
            value = pattern.sub(replacement, value)
        return value
    if isinstance(value, dict):
        return {key: _hide(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_hide(item) for item in value]
    return value


def logging_config(environment: str, level: str) -> dict[str, Any]:
    """Словарь настройки для `dictConfig`.

    Отдельной функцией, а не константой: уровень и окружение приходят из
    настроек, а тесту удобно посмотреть на результат, ничего не настраивая.
    """
    return {
        "version": 1,
        # Чужие логгеры не глушим: половина полезного в журнале приходит из
        # библиотек, и выключать их за то, что они не описаны здесь, незачем.
        "disable_existing_loggers": False,
        "filters": {"context": {"()": RequestContextFilter}},
        "formatters": {
            "json": {"()": SensitiveDataFormatter, "environment": environment},
        },
        "handlers": {
            "stdout": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
                "formatter": "json",
                "filters": ["context"],
            },
        },
        "root": {"level": level, "handlers": ["stdout"]},
        "loggers": {
            # У uvicorn свои обработчики и свой формат; забираем его записи
            # себе, чтобы весь вывод был одним форматом.
            "uvicorn": {"handlers": [], "propagate": True},
            # Журнал доступа уводим на WARNING: строку про каждый запрос мы
            # пишем сами — с идентификатором запроса, кодом и длительностью,
            # которых у uvicorn нет. Две строки об одном и том же в журнале
            # не нужны.
            "uvicorn.access": {"handlers": [], "propagate": True, "level": "WARNING"},
            # SQLAlchemy на INFO печатает каждый запрос с параметрами — а в
            # параметрах наши блобы и хэши. Включать это можно только
            # сознательно и только при разработке.
            "sqlalchemy.engine": {"level": "WARNING", "propagate": True},
        },
    }


def configure_logging(environment: str = "dev", level: str = "INFO") -> None:
    """Настроить журналирование процесса.

    Вызывается один раз при старте — в `main.py` на уровне модуля, то есть
    после того, как uvicorn применил свою настройку, и потому поверх неё.
    """
    logging.config.dictConfig(logging_config(environment, level))


def get_logger(name: str = "") -> logging.Logger:
    """Логгер в нашей иерархии: `get_logger("api.access")` → `grafik.api.access`.

    Имена задаются явно, а не через `__name__`: в журнале нужен устойчивый
    адрес, по которому фильтруют, и он не должен меняться от переноса файла
    между пакетами.
    """
    return logging.getLogger(f"{ROOT_LOGGER}.{name}" if name else ROOT_LOGGER)
