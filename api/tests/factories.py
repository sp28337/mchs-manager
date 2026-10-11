"""Фабрики данных: короткий способ получить правдоподобную строку.

Правило одно: фабрика заполняет **только обязательное** и даёт изменить
любое поле. Тест, которому важен подтверждённый адрес, пишет это явно —
остальные не должны угадывать, что фабрика проставила за них.
"""

from __future__ import annotations

from datetime import UTC, datetime
from itertools import count

from sqlalchemy.ext.asyncio import AsyncSession

from grafik_api.models import Credential, User

_счётчик = count(1)


def адрес() -> str:
    """Уникальный адрес почты: `человек-1@example.test`.

    `example.test` — зарезервированный домен (RFC 2606): письмо по такому
    адресу не уйдёт живому человеку, даже если тест однажды научится
    отправлять письма.
    """
    return f"человек-{next(_счётчик)}@example.test"


async def создать_аккаунт(
    session: AsyncSession,
    *,
    email: str | None = None,
    verified: bool = False,
) -> User:
    """Аккаунт в базе."""
    user = User(
        email=email if email is not None else адрес(),
        email_verified_at=datetime.now(UTC) if verified else None,
    )
    session.add(user)
    await session.flush()
    return user


async def создать_доступ(
    session: AsyncSession,
    user: User,
    *,
    verifier_hash: str = "$argon2id$v=19$m=65536,t=3,p=1$проверочное$значение",
    kdf_version: str = "kdf_v1",
) -> Credential:
    """Проверочное значение пароля для аккаунта."""
    credential = Credential(
        user_id=user.id, verifier_hash=verifier_hash, kdf_version=kdf_version
    )
    session.add(credential)
    await session.flush()
    return credential
