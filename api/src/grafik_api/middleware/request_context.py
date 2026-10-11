"""Прослойка: идентификатор запроса и строка журнала доступа.

Делает три вещи: заводит идентификатор запроса (или принимает чужой),
отдаёт его в заголовке ответа и пишет одну строку о каждом обработанном
запросе — с кодом ответа и длительностью.

--- Почему чистая ASGI-прослойка, а не `@app.middleware("http")` ----------

Декоратор FastAPI — это `BaseHTTPMiddleware` от Starlette, и у него есть
цена: каждый запрос оборачивается в отдельную задачу с очередью, из-за чего
ломаются потоковые ответы, фоновые задачи отрабатывают в чужом контексте, а
исключения всплывают не там, где их ждут. Нам от прослойки нужны три
значения из `scope` и один заголовок в ответе — для этого хватает трёх
строк на чистом ASGI, без лишней задачи на запрос.

--- Чего здесь нет --------------------------------------------------------

Строки запроса (`?...`) в журнале нет намеренно: в ссылках подтверждения
адреса и восстановления доступа едут одноразовые токены, и писать их в
журнал нельзя. Тела запроса и ответа — тем более: там блобы и обёртки
ключей (раздел 9 контракта).
"""

from __future__ import annotations

from collections.abc import Iterable
from time import perf_counter
from uuid import uuid4

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from grafik_api.core.context import request_id_var
from grafik_api.core.logging import get_logger

logger = get_logger("api.access")

HEADER = "x-request-id"

# Чужой идентификатор принимаем, только если он похож на идентификатор:
# длина ограничена, символы безопасные. Иначе клиент одной строкой на
# десять килобайт раздувает каждую запись журнала, а заодно тащит в него
# что угодно.
_MAX_LENGTH = 64
_ALLOWED = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")


class RequestContextMiddleware:
    """Ставит идентификатор запроса на время обработки и пишет доступ."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _incoming_id(scope) or uuid4().hex
        token = request_id_var.set(request_id)
        started_at = perf_counter()
        status = 0

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                # Заголовки правим списком, а не помощником Starlette: это
                # обычный ASGI-кадр, и лишняя зависимость тут не нужна.
                message["headers"] = [
                    *message.get("headers", []),
                    (HEADER.encode("ascii"), request_id.encode("ascii")),
                ]
            await send(message)

        details = {
            "event": "http.request",
            "method": scope["method"],
            "path": scope["path"],
        }
        logger.debug("запрос начат", extra=details)

        try:
            await self.app(scope, receive, send_with_id)
        except Exception:
            # Запись об исключении обязана уйти в журнал здесь: выше нас
            # только обработчик, который превратит это в 500 и потеряет
            # и длительность, и путь.
            logger.exception(
                "запрос завершён необработанным исключением",
                extra=details | {"event": "http.error", "duration_ms": _ms(started_at)},
            )
            raise
        else:
            logger.info(
                "запрос обработан",
                extra=details
                | {
                    "event": "http.access",
                    "status": status,
                    "duration_ms": _ms(started_at),
                },
            )
        finally:
            request_id_var.reset(token)


def _incoming_id(scope: Scope) -> str | None:
    """Идентификатор из заголовка запроса, если он годный.

    Годный чужой идентификатор принимаем, чтобы запрос можно было проследить
    от браузера через nginx до нас одной строкой поиска.
    """
    wanted = HEADER.encode("ascii")
    # Явный тип: в `Scope` значения объявлены как `Any`, и без этого
    # mypy справедливо ругается на всё, что мы из них достаём.
    headers: Iterable[tuple[bytes, bytes]] = scope.get("headers", ())
    for name, value in headers:
        if name.lower() != wanted:
            continue
        candidate = value.decode("latin-1").strip()
        if candidate and len(candidate) <= _MAX_LENGTH and set(candidate) <= _ALLOWED:
            return candidate
        return None
    return None


def _ms(started_at: float) -> float:
    """Длительность в миллисекундах, округлённая до десятых."""
    return round((perf_counter() - started_at) * 1000, 1)
