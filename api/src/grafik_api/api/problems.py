"""Ответы об ошибках: один формат на все случаи.

Клиенту приходится разбирать ошибки от трёх разных источников: наши
доменные, проверку схемы pydantic и то, что возвращает сам веб-сервер на
незнакомый путь. Если форматы различаются, фронт пишет три разбора вместо
одного — поэтому здесь всё сводится к `application/problem+json`.

--- Что сюда намеренно не попадает ----------------------------------------

**Значения полей, не прошедших проверку.** FastAPI по умолчанию возвращает
их в теле ответа (`input`), а там может оказаться адрес почты или блоб. В
ответе остаются только путь к полю, сообщение и тип ошибки.

**Текст необработанного исключения.** Наружу уходит `internal_error` и
идентификатор запроса, подробности — в журнал. Сообщение об ошибке базы,
показанное человеку, — это бесплатная карта внутренностей для того, кто
будет ломать.
"""

from __future__ import annotations

from typing import Any, cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from grafik_api.core.context import NO_VALUE
from grafik_api.core.errors import (
    DomainError,
    ProblemCode,
    RateLimitedError,
    problem_type,
)
from grafik_api.core.logging import get_logger
from grafik_api.middleware.request_context import HEADER
from grafik_api.schemas.problem import Problem

logger = get_logger("api.problems")

# Что умеет вернуть сам веб-сервер, минуя наш код.
_BY_STATUS: dict[int, ProblemCode] = {
    404: "not_found",
    405: "method_not_allowed",
}

MEDIA_TYPE = "application/problem+json"


def install_problem_handlers(app: FastAPI) -> None:
    """Повесить обработчики на приложение.

    Порядок не важен: Starlette выбирает обработчик по типу исключения, а
    `Exception` отдаёт самому внешнему слою — туда, где ответ уже никто не
    перехватит.
    """
    app.add_exception_handler(DomainError, _domain)
    app.add_exception_handler(RequestValidationError, _validation)
    app.add_exception_handler(StarletteHTTPException, _http)
    app.add_exception_handler(Exception, _unhandled)


def _request_id(request: Request) -> str:
    """Идентификатор запроса из области видимости запроса.

    Берётся из `scope`, а не из контекстной переменной: обработчик
    необработанных исключений срабатывает уже снаружи нашей прослойки,
    когда контекст возвращён в исходное состояние.
    """
    state: dict[str, Any] = request.scope.get("state") or {}
    value = state.get("request_id")
    return value if isinstance(value, str) else NO_VALUE


def _response(
    request: Request,
    *,
    code: ProblemCode,
    status: int,
    title: str,
    detail: str | None = None,
    extra: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    request_id = _request_id(request)
    problem = Problem(
        type=problem_type(code),
        title=title,
        status=status,
        code=code,
        detail=detail,
        request_id=request_id,
        **(extra or {}),
    )

    # Заголовок с идентификатором запроса обычно ставит прослойка, но
    # ответ об необработанной ошибке уходит мимо неё — поэтому он
    # ставится и здесь. Прослойка в таких случаях свой заголовок заменяет,
    # а не дописывает: иначе клиент получил бы «значение, значение».
    return JSONResponse(
        content=problem.model_dump(exclude_none=True),
        status_code=status,
        media_type=MEDIA_TYPE,
        headers={**(headers or {}), HEADER: request_id},
    )


async def _domain(request: Request, exc: Exception) -> JSONResponse:
    """Ошибка, про которую приложение знает, что она значит."""
    error = cast(DomainError, exc)

    headers = {}
    if isinstance(error, RateLimitedError):
        # Без `Retry-After` клиент либо сдаётся, либо долбит дальше.
        headers["Retry-After"] = str(error.retry_after)

    return _response(
        request,
        code=error.code,
        status=error.status,
        title=error.title,
        detail=error.detail,
        extra=error.extra,
        headers=headers,
    )


async def _validation(request: Request, exc: Exception) -> JSONResponse:
    """Тело не прошло схему."""
    error = cast(RequestValidationError, exc)

    # Только адрес поля, сообщение и тип. Ни `input`, ни `ctx`: в них
    # лежит то, что человек прислал.
    errors = [
        {
            "loc": ".".join(str(part) for part in item["loc"]),
            "msg": item["msg"],
            "type": item["type"],
        }
        for item in error.errors()
    ]

    return _response(
        request,
        code="validation_failed",
        status=422,
        title="Тело запроса не прошло проверку",
        extra={"errors": errors},
    )


async def _http(request: Request, exc: Exception) -> JSONResponse:
    """То, что поднимает сам Starlette: незнакомый путь или метод.

    Свой код такими исключениями не бросается — у него есть доменные. Если
    сюда прилетело что-то со статусом не из таблицы, это стоит увидеть в
    журнале: значит, где-то в коде остался `HTTPException`.
    """
    error = cast(StarletteHTTPException, exc)

    code = _BY_STATUS.get(error.status_code)
    if code is None:
        logger.warning(
            "ответ HTTPException без доменного кода",
            extra={"event": "http.unmapped", "status": error.status_code},
        )
        code = "internal_error"

    return _response(
        request,
        code=code,
        status=error.status_code,
        title=str(error.detail) if error.detail else "Ошибка запроса",
        headers=dict(error.headers or {}),
    )


async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
    """Всё остальное.

    В журнал эту ошибку уже записала прослойка — вместе с путём, методом и
    длительностью, которых здесь нет. Второй раз писать незачем: один сбой
    должен давать одну запись.
    """
    return _response(
        request,
        code="internal_error",
        status=500,
        title="Внутренняя ошибка",
        detail="Подробности в журнале по идентификатору запроса.",
    )
