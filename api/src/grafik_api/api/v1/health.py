"""Проверка живости.

Две ручки, и разница между ними не косметическая.

`/healthz` — **живость**: процесс жив и способен обработать запрос. Он
намеренно ничего не проверяет снаружи: ручка живости, падающая из-за
недоступной базы, заставляет оркестратор перезапускать совершенно здоровое
приложение, а база от перезапуска не лечится.

`/readyz` — **готовность**: можно ли направлять сюда запросы. Вот он базу и
проверяет, потому что без неё приложение бесполезно. Разница в том, что
делают по ответу: на `/healthz` — перезапускают, на `/readyz` — убирают из
балансировки и ждут.
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import text

from grafik_api import __version__
from grafik_api.core.errors import ServiceUnavailableError
from grafik_api.core.logging import get_logger

logger = get_logger("api.health")

router = APIRouter(tags=["ops"])


class Health(BaseModel):
    """Ответ о живости."""

    status: str
    version: str


@router.get("/healthz", summary="Живо ли приложение")
async def healthz() -> Health:
    """Вернуть признак живости и версию выпуска.

    Версия здесь не для красоты: по ней видно, какой выпуск отвечает, —
    первое, что нужно знать, когда после выкладки что-то ведёт себя не так.
    """
    return Health(status="ok", version=__version__)


@router.get(
    "/readyz",
    summary="Готово ли принимать запросы",
    responses={503: {"description": "Не готово: база недоступна"}},
)
async def readyz(request: Request) -> Health:
    """Проверить то, без чего приложение бесполезно, — базу.

    Запрос самый дешёвый из возможных: нужно знать, что соединение живо и
    база отвечает, а не нагружать её на каждой проверке.

    Если жизненный цикл не запускался, фабрики сессий в состоянии нет — и
    это тоже «не готово», а не ошибка: именно так выглядит приложение,
    которое ещё не поднялось.
    """
    try:
        async with request.app.state.sessionmaker() as session:
            await session.execute(text("SELECT 1"))
    except Exception as error:
        logger.warning(
            "база недоступна",
            exc_info=True,
            extra={"event": "db.unavailable"},
        )
        # Доменной ошибкой, а не `HTTPException`: ответ тогда уходит в том
        # же формате, что и все остальные (problem+json).
        raise ServiceUnavailableError("база недоступна") from error

    return Health(status="ready", version=__version__)
