"""Фабрики данных: короткий способ получить правдоподобную строку.

Правило одно: фабрика заполняет **только обязательное** и даёт изменить
любое поле. Тест, которому важен подтверждённый адрес, пишет это явно —
остальные не должны угадывать, что фабрика проставила за них.
"""

from __future__ import annotations

from datetime import UTC, datetime
from itertools import count
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from grafik_api.core.legal import CURRENT_VERSIONS
from grafik_api.core.security import encode_wrapped
from grafik_api.models import Credential, User

#: Проверочное значение пароля и обёртки ключа — любые правдоподобные
#: байты: сервер в них не заглядывает.
ЗНАЧЕНИЕ = encode_wrapped(b"\x01" * 32)
ОБЁРТКА_ПАРОЛЕМ = encode_wrapped(b"\x10" * 60)
ОБЁРТКА_КЛЮЧОМ = encode_wrapped(b"\x20" * 60)

_счётчик = count(1)


def адрес() -> str:
    """Уникальный адрес почты: `человек-1@example.com`.

    `example.com` зарезервирован под примеры (RFC 2606): письмо по такому
    адресу не уйдёт живому человеку, даже если тест однажды научится
    отправлять письма. Домен `.test` подошёл бы не хуже, но проверка
    адресов отвергает его как служебный, а схема у нас настоящая.

    Кириллица в адресе намеренно: такие адреса существуют, проверка их
    принимает, и нормализация обязана с ними работать.
    """
    return f"человек-{next(_счётчик)}@example.com"


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


def тело_регистрации(**правки: Any) -> dict[str, Any]:
    """Исправное тело регистрации — с возможностью испортить одно поле."""
    тело: dict[str, Any] = {
        "email": адрес(),
        "verifier": ЗНАЧЕНИЕ,
        "wrapped_dek_pwd": ОБЁРТКА_ПАРОЛЕМ,
        "wrapped_dek_rec": ОБЁРТКА_КЛЮЧОМ,
        "kdf_version": "kdf_v1",
        "consent": {
            "policy_version": CURRENT_VERSIONS["policy"],
            "consent_version": CURRENT_VERSIONS["consent"],
            "terms_version": CURRENT_VERSIONS["terms"],
        },
    }
    тело.update(правки)
    return тело


async def зарегистрировать(клиент: httpx.AsyncClient, **правки: Any) -> httpx.Response:
    """Создать аккаунт через HTTP — так, как это делает браузер."""
    return await клиент.post("/api/v1/auth/register", json=тело_регистрации(**правки))


async def войти(клиент: httpx.AsyncClient, **правки: Any) -> dict[str, str]:
    """Создать аккаунт и вернуть заголовок с access-токеном.

    Нужно всему, что требует опознания: закрытые ручки иначе отвечают 401,
    и каждый тест начинался бы с четырёх строк одного и того же.
    """
    ответ = await зарегистрировать(клиент, **правки)
    assert ответ.status_code == 201, ответ.text

    return {"Authorization": f"Bearer {ответ.json()['access_token']}"}
