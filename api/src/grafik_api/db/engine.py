"""Движок и фабрика сессий.

Движок создаётся один на процесс — в жизненном цикле приложения
(`main.py`), а не на уровне модуля: модульный объект пришлось бы создавать
при импорте, то есть и в тестах, и в командах, которым база не нужна.
Соединение он при создании не открывает, первое открывается по надобности.

Сессия — на запрос, через зависимость (`api/deps.py`, шаг 6).

--- Адрес IP приходит строкой ---------------------------------------------

Здесь же настраивается один адаптер драйвера, и без него врут модели.
psycopg 3 по умолчанию превращает `inet` в объект `ipaddress.IPv4Address`
(это его документированное поведение), а `AuditEntry.ip` объявлен как
`str | None` — проверке типов разойтись негде, она видит только
объявление. Расхождение всплывает там, где значение уходит в ответ:
pydantic отказывается считать `IPv4Address` строкой, и выгрузка журнала
падает уже в бою.

Сетей и масок мы не храним — только адрес обратившегося, и нужен он как
строка. Поэтому `inet` загружается текстом; столбец в базе остаётся
`INET`, то есть проверка значения на входе никуда не делась.
"""

from __future__ import annotations

import psycopg
from psycopg.types.string import TextLoader
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as _create_async_engine

from grafik_api.core.config import Settings

# На уровне модуля и в глобальной карте адаптеров: регистрация должна
# случиться до первого соединения, а соединения открывают все — и
# приложение, и Alembic, и тесты.
psycopg.adapters.register_loader("inet", TextLoader)


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
