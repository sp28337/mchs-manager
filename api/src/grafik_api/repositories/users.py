"""Аккаунты: поиск по адресу и создание.

Нормализацией адреса репозиторий не занимается — это правило, а не доступ
к данным, и живёт оно в сервисе (шаг 7). Здесь адрес уже приведён к
единому виду, и уникальность в базе означает то, что от неё ждут.
"""

from __future__ import annotations

from sqlalchemy import select

from grafik_api.models import User
from grafik_api.repositories.base import Repository


class UserRepository(Repository[User]):
    """Строки таблицы `users`."""

    model = User

    async def by_email(self, email: str) -> User | None:
        """Аккаунт по нормализованному адресу почты."""
        return await self.session.scalar(select(User).where(User.email == email))

    async def create(self, email: str) -> User:
        """Добавить аккаунт.

        `flush` здесь обязателен: ограничение уникальности срабатывает в
        базе, и без него конфликт адресов вылез бы в конце запроса — там,
        где его уже не превратить в понятный ответ.
        """
        user = self.add(User(email=email))
        await self.flush()
        return user
