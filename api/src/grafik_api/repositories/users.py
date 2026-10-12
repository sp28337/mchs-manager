"""Аккаунты: поиск по адресу и создание.

Нормализацией адреса репозиторий не занимается — это правило, а не доступ
к данным, и живёт оно в сервисе (шаг 7). Здесь адрес уже приведён к
единому виду, и уникальность в базе означает то, что от неё ждут.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import delete, exists, select

from grafik_api.models import Blob, User
from grafik_api.repositories.base import Repository


class UserRepository(Repository[User]):
    """Строки таблицы `users`."""

    model = User

    async def by_email(self, email: str) -> User | None:
        """Аккаунт по нормализованному адресу почты."""
        return await self.session.scalar(select(User).where(User.email == email))

    async def lock(self, user_id: uuid.UUID) -> User | None:
        """Взять аккаунт с блокировкой строки.

        Нужно отправке изменений: ревизия аккаунта — одна
        последовательность, и два устройства, отправившие правки разом,
        иначе получили бы один и тот же номер. Блокировка держится до
        конца транзакции запроса, то есть считанные миллисекунды.
        """
        return await self.session.scalar(
            select(User).where(User.id == user_id).with_for_update()
        )

    async def purge_unverified(self, before: datetime) -> int:
        """Убрать брошенные регистрации: адрес не подтверждён и данных нет.

        Контракт и политика обещают «неподтверждённый аккаунт без данных —
        30 дней». Два условия, и второе важнее первого: подтверждение
        адреса для работы не обязательно, и человек, который им не
        воспользовался, но уже ведёт график, аккаунт не бросил. Удалить
        его значило бы стереть ему данные по формальному признаку.

        Поэтому удаляются только те, у кого **нет ни одного элемента** —
        ни живого, ни надгробия. Остальное (обёртки ключа, проверочное
        значение, запись о согласии) уходит каскадом.
        """
        строки = await self.session.scalars(
            delete(User)
            .where(
                User.email_verified_at.is_(None),
                User.created_at < before,
                ~exists().where(Blob.user_id == User.id),
            )
            .returning(User.id)
        )
        return len(строки.all())

    async def create(self, email: str) -> User:
        """Добавить аккаунт.

        `flush` здесь обязателен: ограничение уникальности срабатывает в
        базе, и без него конфликт адресов вылез бы в конце запроса — там,
        где его уже не превратить в понятный ответ.
        """
        user = self.add(User(email=email))
        await self.flush()
        return user
