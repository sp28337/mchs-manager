"""Подключение к базе: движок, фабрика сессий, базовый класс моделей.

Один драйвер и для приложения, и для Alembic — psycopg 3 в асинхронном
режиме (`postgresql+psycopg://`). Две разные строки подключения означали бы
два разных поведения: в миграциях одно, в бою другое.
"""

from grafik_api.db.base import NAMING_CONVENTION, Base, TimestampMixin
from grafik_api.db.engine import create_engine, create_sessionmaker

__all__ = [
    "NAMING_CONVENTION",
    "Base",
    "TimestampMixin",
    "create_engine",
    "create_sessionmaker",
]
