"""Зависимости: всё, что ручка получает, а не создаёт.

Живут они в одном месте намеренно. Зависимость, собранная прямо в ручке, —
это и дублирование, и невозможность подменить её в тесте: FastAPI
подменяет по объекту функции, а не по месту вызова.

Что здесь есть:

* сессия базы на запрос — с фиксацией в конце и откатом при ошибке;
* настройки приложения;
* адрес клиента (с оглядкой на nginx);
* ограничитель частоты обращений.

Чего здесь пока нет: текущего пользователя. Он появится на шаге 7 вместе с
токенами — раньше его неоткуда взять, а заглушка, возвращающая «какого-то»
пользователя, опаснее отсутствующей функции.
"""

from __future__ import annotations

import ipaddress
from collections.abc import AsyncIterator, Callable, Coroutine
from typing import Annotated, Any

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from grafik_api.core.config import Settings
from grafik_api.core.errors import RateLimitedError
from grafik_api.core.limits import Limit


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Сессия на один запрос: единица работы.

    Фиксация — в конце успешного запроса, откат — при любой ошибке. Так
    запрос либо меняет базу целиком, либо не меняет вовсе, и ни одна ручка
    не может забыть `commit()`. Операция из двух шагов при этом остаётся в
    одной транзакции, а не в двух.

    Фабрика берётся из состояния приложения, а не из модуля: в одном
    процессе может быть несколько приложений с разными настройками, и тест
    как раз этим и пользуется.
    """
    sessionmaker = request.app.state.sessionmaker

    async with sessionmaker() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        else:
            await session.commit()


SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_settings_of(request: Request) -> Settings:
    """Настройки приложения, обрабатывающего этот запрос."""
    settings: Settings = request.app.state.settings
    return settings


SettingsDep = Annotated[Settings, Depends(get_settings_of)]


def get_client_ip(request: Request) -> str | None:
    """Адрес клиента — с поправкой на то, что перед нами nginx.

    Прямой адрес (`request.client`) за прокси всегда наш же `127.0.0.1`,
    поэтому настоящий берётся из `X-Forwarded-For`. Но берётся **только
    если обратился сосед по петле**: иначе любой, кто дотянулся до нас
    напрямую, подставил бы в журнал и в счётчик попыток чужой адрес.

    Из списка берётся правый элемент: nginx дописывает к заголовку того,
    кого увидел сам, — то есть последним стоит настоящий клиент.
    """
    peer = request.client.host if request.client else None

    if peer is None or not _is_loopback(peer):
        return peer

    forwarded = request.headers.get("x-forwarded-for")
    if not forwarded:
        return peer

    candidate = forwarded.split(",")[-1].strip()
    return candidate if _is_address(candidate) else peer


ClientIpDep = Annotated[str | None, Depends(get_client_ip)]


def rate_limit(name: str, limit: Limit) -> Callable[..., Coroutine[Any, Any, None]]:
    """Зависимость, которая считает обращения и отказывает при переборе.

    Ключ — имя ручки и адрес клиента: предел у входа свой, у регистрации
    свой, и мешать их нельзя. Там, где контракт считает на аккаунт
    (`/sync`), ключ дополнит опознанный пользователь — шаг 8.
    """

    async def dependency(request: Request) -> None:
        key = f"{name}:{get_client_ip(request) or 'неизвестно'}"
        retry_after = request.app.state.limiter.hit(key, limit)

        if retry_after is not None:
            raise RateLimitedError(retry_after)

    return dependency


def _is_loopback(host: str) -> bool:
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        # Не адрес вовсе — например, unix-сокет. Доверять нечему.
        return False


def _is_address(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True
