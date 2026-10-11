"""Точка сборки приложения.

Здесь — только сборка: настройки, журналирование, жизненный цикл,
прослойки, подключение роутеров. Бизнес-логики в этом файле нет и быть не
должно, иначе через полгода он станет тем самым файлом, который правят все и
боятся все.

Приложение создаётся фабрикой `create_app()`, а не объявляется модульной
переменной: тестам нужно по приложению на набор настроек, а модульный объект
создаётся один раз на процесс и тянет за собой настройки из окружения,
которые в тесте уже не подменить. Переменная `app` ниже — для uvicorn и
gunicorn, которым нужен импортируемый объект.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from grafik_api import __version__
from grafik_api.api.problems import install_problem_handlers
from grafik_api.api.v1 import router as v1_router
from grafik_api.core.config import Settings, get_settings
from grafik_api.core.limits import RateLimiter
from grafik_api.core.logging import configure_logging, get_logger
from grafik_api.db import create_engine, create_sessionmaker
from grafik_api.middleware.request_context import RequestContextMiddleware

logger = get_logger("api.main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Запуск и остановка.

    Движок создаётся здесь, а не при импорте: соединений он при создании не
    открывает, но закрыть его на остановке обязательно — иначе после
    `docker stop` соединения висят на стороне базы до таймаута.

    Движок и фабрика сессий живут в `app.state`, а не модульными
    переменными: так в одном процессе могут существовать два приложения с
    разными настройками (ровно это делают тесты), и зависимость получает их
    из запроса, а не из глобального состояния.
    """
    engine = create_engine(app.state.settings)
    app.state.engine = engine
    app.state.sessionmaker = create_sessionmaker(engine)

    logger.info("приложение запускается", extra={"event": "app.start"})
    try:
        yield
    finally:
        await engine.dispose()
        logger.info("приложение остановлено", extra={"event": "app.stop"})


def create_app(settings: Settings | None = None) -> FastAPI:
    """Собрать приложение.

    `settings` передаётся тестом, который хочет другое окружение; в боевом
    запуске настройки читаются из переменных окружения один раз.

    Журналирование здесь намеренно не настраивается: `dictConfig` меняет
    состояние всего процесса, и тест, создающий приложение, сносил бы
    перехват записей у себя и у соседей. Настройка — ниже, на уровне модуля.
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

    # Настройки нужны жизненному циклу и зависимостям, а до них доходит
    # только приложение — значит, им и хранить.
    app.state.settings = settings

    # Счётчик обращений — в памяти процесса, поэтому создаётся вместе с
    # приложением, а не в жизненном цикле: закрывать его не нужно.
    app.state.limiter = RateLimiter()

    # Все ошибки — одним форматом (problem+json), включая те, что поднимает
    # сам веб-сервер.
    install_problem_handlers(app)

    # Прослойка снаружи всего прикладного: идентификатор запроса нужен уже
    # первой записи журнала, а длительность — считая разбор запроса.
    app.add_middleware(RequestContextMiddleware)

    # Префикс версии живёт здесь, а не в роутерах: так при появлении v2
    # меняется одна строка, а не каждый модуль ручек.
    app.include_router(v1_router, prefix="/api/v1")

    return app


# Настройка журналирования на уровне модуля — то есть позже, чем своя
# настройка uvicorn (он конфигурирует логирование до импорта приложения), и
# потому поверх неё. Так весь вывод — и наш, и серверный — идёт одним
# форматом в stdout.
_settings = get_settings()
configure_logging(_settings.env, _settings.log_level)

app = create_app(_settings)
