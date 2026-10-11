"""Точка сборки приложения.

Здесь — только сборка: настройки, жизненный цикл, подключение роутеров.
Бизнес-логики в этом файле нет и быть не должно, иначе через полгода он
станет тем самым файлом, который правят все и боятся все.

Приложение создаётся фабрикой `create_app()`, а не объявляется модульной
переменной: тестам нужно по приложению на набор настроек, а модульный объект
создаётся один раз на процесс и тянет за собой настройки из окружения,
которые в тесте уже не подменить. Переменная `app` ниже — для uvicorn и
gunicorn, которым нужен импортируемый объект.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from grafik_api import __version__
from grafik_api.api.v1 import router as v1_router
from grafik_api.core.config import Settings, get_settings

# Полное имя логгера, а не __name__: иерархия `grafik.*` настраивается
# целиком на шаге 4, и имена не должны зависеть от того, как модуль
# импортировали.
logger = logging.getLogger("grafik.api.main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Запуск и остановка.

    Пока здесь только две записи в журнал. Сюда же придут пул соединений с
    базой (шаг 5) и слушатель очереди логов (шаг 4) — всё, что надо открыть
    один раз на процесс и закрыть при остановке, чтобы не держать соединения
    после `docker stop`.

    Этих двух записей в выводе `uvicorn` пока не видно, и это не поломка:
    uvicorn настраивает только свои логгеры, а у `grafik.*` обработчиков
    ещё нет — они появятся на шаге 4 вместе с `core/logging.py`. Тест
    читает записи напрямую, через `caplog`, поэтому проверка работает уже
    сейчас.
    """
    logger.info("приложение запускается, версия %s", __version__)
    yield
    logger.info("приложение остановлено")


def create_app(settings: Settings | None = None) -> FastAPI:
    """Собрать приложение.

    `settings` передаётся тестом, который хочет другое окружение; в боевом
    запуске настройки читаются из переменных окружения один раз.
    """
    settings = settings or get_settings()

    app = FastAPI(
        title="График 1 3 — сервер синхронизации",
        version=__version__,
        lifespan=lifespan,
        # Документация и схема — только при разработке. В бою это лишняя
        # поверхность: описание всех ручек и схем отдаётся без аутентификации.
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
    )

    # Префикс версии живёт здесь, а не в роутерах: так при появлении v2
    # меняется одна строка, а не каждый модуль ручек.
    app.include_router(v1_router, prefix="/api/v1")

    return app


app = create_app()
