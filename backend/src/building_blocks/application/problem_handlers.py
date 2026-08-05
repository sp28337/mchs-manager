"""Обработчики исключений, доводящие ответ до RFC 7807 (API_Conventions
разд. 3).

--- Что было сломано ---------------------------------------------------

`problem_exception()` собирал корректный `Problem` и клал его в
`HTTPException(detail=...)`. Дальше срабатывал стандартный обработчик
FastAPI, который заворачивает `detail` ещё раз, и наружу уходило

    Content-Type: application/json
    {"detail": {"type": ..., "title": ..., "status": 409, ...}}

вместо требуемого разд. 3

    Content-Type: application/problem+json
    {"type": ..., "title": ..., "status": 409, ...}

То есть КАЖДЫЙ ответ об ошибке во всех пяти модулях нарушал и
API_Conventions, и собственный `openapi.yaml`, где у каждой операции
описан `content: application/problem+json` со схемой `Problem`. Клиент,
написанный строго по спецификации, не смог бы разобрать ни одну ошибку.

Обнаружилось это только на интеграционном тесте `time_accounting`,
проверившем `Content-Type` явно: все прежние тесты сверяли лишь код
состояния, а он был правильным всегда.

--- Заодно исправлены две смежные вещи ---------------------------------

**`instance`.** Разд. 3 показывает в примере путь запроса, а
`problem_exception()` заполнить его не может — он не видит запроса.
Теперь путь подставляется здесь, если его не задали явно.

**Код ошибки валидации.** FastAPI по умолчанию отвечает `422` на любое
несоответствие схеме, а разд. 3 различает два случая жёстко:

* `400 validation-failed` — «не проходит JSON Schema валидацию
  тела/параметров»;
* `422 domain-invariant-violation` — «синтаксически верный запрос
  нарушает бизнес-инвариант домена».

Различие содержательное, а не косметическое: по нему клиент решает,
исправлять ли запрос (400) или объясняться с пользователем о существе
дела (422). Пока `RequestValidationError` отдавал 422, оба случая
выглядели одинаково, и «привлечение сверх нормы без приказа» было не
отличить от опечатки в имени поля.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.building_blocks.application.problem import ERRORS_BASE, Problem

PROBLEM_MEDIA_TYPE = "application/problem+json"

# Заголовки, которые обязаны дойти до клиента (например, `Retry-After`
# при 429 и `WWW-Authenticate` при 401): собственный обработчик
# подменяет ответ целиком, и без явного переноса они бы потерялись.
_PRESERVED_HEADERS = ("retry-after", "www-authenticate", "allow")


def _is_problem_payload(detail: Any) -> bool:
    return isinstance(detail, dict) and {"type", "title", "status"} <= detail.keys()


def _problem_response(payload: dict[str, Any], *, request: Request, status: int) -> JSONResponse:
    payload.setdefault("instance", request.url.path)
    if payload.get("instance") is None:
        payload["instance"] = request.url.path
    return JSONResponse(content=payload, status_code=status, media_type=PROBLEM_MEDIA_TYPE)


async def _http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict) and _is_problem_payload(detail):
        payload: dict[str, Any] = dict(detail)
    else:
        # Ошибка, поднятая не через `problem_exception` — сам FastAPI
        # (404 несуществующего маршрута, 405) или сторонняя зависимость.
        # Разд. 3 требует единый конверт «для всех модулей», без оговорок
        # про происхождение ошибки, поэтому конверт надевается и здесь.
        payload = Problem(
            type=f"{ERRORS_BASE}/{_type_slug_for(exc.status_code)}",
            title=str(exc.detail) if exc.detail else "Ошибка запроса",
            status=exc.status_code,
            detail=str(exc.detail) if exc.detail else None,
            trace_id=str(uuid4()),
        ).model_dump(mode="json", by_alias=True)

    response = _problem_response(payload, request=request, status=exc.status_code)
    for name in _PRESERVED_HEADERS:
        value = (exc.headers or {}).get(name)
        if value is not None:
            response.headers[name] = value
    return response


async def _validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """`400`, а не `422` — см. докстринг модуля.

    Подробности ошибок Pydantic кладутся в `detail` текстом, а не
    отдельным полем: `Problem` в `openapi.yaml` описан закрытым набором
    полей, и добавлять в него массив ошибок значило бы менять контракт
    ответа ради удобства отладки.
    """
    errors = "; ".join(
        f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
        for error in exc.errors()
    )
    payload = Problem(
        type=f"{ERRORS_BASE}/validation-failed",
        title="Запрос не соответствует схеме",
        status=400,
        detail=errors or "тело или параметры запроса не проходят валидацию",
        # Разд. 3: «каждая ошибка ОБЯЗАНА нести traceId» — без оговорок про
        # то, кем она поднята.
        trace_id=str(uuid4()),
    ).model_dump(mode="json", by_alias=True)
    return _problem_response(payload, request=request, status=400)


def _type_slug_for(status: int) -> str:
    """Каталог разд. 3 — единственный источник соответствия «код → type»."""
    return {
        400: "validation-failed",
        401: "unauthenticated",
        403: "forbidden",
        404: "not-found",
        405: "validation-failed",
        409: "conflict",
        422: "domain-invariant-violation",
        423: "immutable-resource",
        429: "rate-limited",
    }.get(status, "internal")


def install_problem_handlers(app: FastAPI) -> None:
    """Вызывается Composition Root'ом один раз при сборке приложения."""
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, _validation_exception_handler)  # type: ignore[arg-type]
