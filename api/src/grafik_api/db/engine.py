"""Движок и фабрика сессий.

Движок создаётся один на процесс — в жизненном цикле приложения
(`main.py`), а не на уровне модуля: модульный объект пришлось бы создавать
при импорте, то есть и в тестах, и в командах, которым база не нужна.
Соединение он при создании не открывает, первое открывается по надобности.

Сессия — на запрос, через зависимость (`api/deps.py`, шаг 6).
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as _create_async_engine

from grafik_api.core.config import Settings


def create_engine(settings: Settings) -> AsyncEngine:
    """Асинхронный движок по настройкам.

    `pool_pre_ping` — проверка соединения перед выдачей из пула. Стоит один
    лишний `SELECT 1`, зато переживает разрыв связи с базой (перезапуск
    PostgreSQL, обрыв у провайдера) без пачки ошибок на первых запросах.

    `echo` не включаем даже при разработке: на этом уровне SQLAlchemy
    печатает запросы вместе с параметрами, а в параметрах наши блобы и
    хэши (раздел 9 контракта).
    """
    return _create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        echo=False,
    )


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Фабрика сессий.

    `expire_on_commit=False` — обязательно для асинхронного кода: иначе
    после `commit()` любое обращение к полю объекта лезет в базу, и это
    происходит там, где `await` уже не поставить.

    `autoflush=False` — чтобы запрос на чтение не сбрасывал в базу
    недоделанные изменения: сброс должен быть там, где его написали.
    """
    return async_sessionmaker(
        engine,
        expire_on_commit=False,
        autoflush=False,
    )
