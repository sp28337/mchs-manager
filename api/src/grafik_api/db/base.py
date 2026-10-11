"""Базовый класс моделей и соглашение об именах.

--- Зачем соглашение об именах ---------------------------------------------

Если имена ограничений не задать, их придумает PostgreSQL, и у каждой базы
они окажутся свои. Миграция, которая удаляет ограничение по имени, на такой
базе падает, а откат — тем более. Соглашение делает имена предсказуемыми и
одинаковыми везде: в моделях, в миграциях, в боевой базе.

Порядок ключей в соглашении важен: `uq` до `ix`, иначе уникальный индекс
получит имя обычного.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Общий предок всех таблиц.

    `metadata` отсюда забирает Alembic: по нему он сравнивает модели с базой
    и строит миграции.
    """

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class TimestampMixin:
    """Когда строка появилась и когда менялась.

    Время ставит база (`now()`), а не приложение: иначе в журнале окажется
    время того процесса, у которого сбиты часы, и порядок событий поедет.
    Для `updated_at` это делает SQLAlchemy при каждом UPDATE — триггер ради
    этого заводить не стоит, писать в таблицы мимо приложения мы не будем.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
