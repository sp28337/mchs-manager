"""Зависимости: всё, что ручка получает, а не создаёт.

Живут они в одном месте намеренно. Зависимость, собранная прямо в ручке, —
это и дублирование, и невозможность подменить её в тесте: FastAPI
подменяет по объекту функции, а не по месту вызова.

Что здесь есть:

* сессия базы на запрос — с фиксацией в конце и откатом при ошибке;
* настройки приложения;
* адрес клиента (с оглядкой на nginx) и идентификатор устройства;
* ограничитель частоты обращений;
* текущий пользователь — по access-токену;
* сервисы входа, синхронизации и прав субъекта — на сессии запроса;
* отправщик писем.
"""

from __future__ import annotations

import ipaddress
from collections.abc import AsyncIterator, Callable, Coroutine
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from grafik_api.core.config import Settings
from grafik_api.core.context import user_id_var
from grafik_api.core.errors import BadCredentialsError, RateLimitedError
from grafik_api.core.limits import Limit
from grafik_api.core.mail import Mailer, create_mailer
from grafik_api.core.security import read_access_token
from grafik_api.services.account import AccountService
from grafik_api.services.auth import AuthService
from grafik_api.services.sync import SyncService


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

    Прямой адрес (`request.client`) за прокси — это сам прокси, поэтому
    настоящий берётся из `X-Forwarded-For`. Но берётся **только если
    обратился доверенный сосед**: иначе любой, кто дотянулся до нас
    напрямую, подставил бы в журнал и в счётчик попыток чужой адрес.

    Доверенные — петля (её не подделать снаружи) и то, что перечислено в
    `GRAFIK_TRUSTED_PROXIES`. Второе нужно в бою: nginx стоит на хозяине
    машины, а приложение в контейнере, и его обращения приходят не с
    `127.0.0.1`, а со шлюза docker-сети. Без этой настройки в журнал
    попал бы адрес шлюза — один и тот же для всех, то есть защита от
    перебора считала бы попытки всего мира в одну кучу.

    Из списка берётся правый элемент: nginx дописывает к заголовку того,
    кого увидел сам, — то есть последним стоит настоящий клиент.
    """
    peer = request.client.host if request.client else None

    if peer is None or not _доверенный(peer, get_settings_of(request)):
        return peer

    forwarded = request.headers.get("x-forwarded-for")
    if not forwarded:
        return peer

    candidate = forwarded.split(",")[-1].strip()
    return candidate if _is_address(candidate) else peer


ClientIpDep = Annotated[str | None, Depends(get_client_ip)]


def get_device_id(request: Request) -> str | None:
    """Идентификатор устройства из заголовка `X-Device-Id`.

    Заводит его браузер, персональных данных в нём нет. Принимается
    только похожее на идентификатор: иначе в журнал входов попадёт
    строка на десять килобайт.
    """
    значение = request.headers.get("x-device-id", "").strip()

    if not значение or len(значение) > 64:
        return None

    return значение if set(значение) <= _БЕЗОПАСНЫЕ else None


DeviceIdDep = Annotated[str | None, Depends(get_device_id)]


def check_rate(request: Request, key: str, limit: Limit) -> None:
    """Отметить обращение и отказать, если их стало слишком много.

    Прямой вызов нужен там, где ключ зависит от тела запроса: предел
    входа контракт считает на пару (аккаунт, адрес), а адрес приходит в
    теле — зависимость его ещё не видит.
    """
    retry_after = request.app.state.limiter.hit(key, limit)

    if retry_after is not None:
        raise RateLimitedError(retry_after)


def rate_limit(name: str, limit: Limit) -> Callable[..., Coroutine[Any, Any, None]]:
    """Зависимость, которая считает обращения и отказывает при переборе.

    Ключ — имя ручки и адрес клиента: предел у входа свой, у регистрации
    свой, и мешать их нельзя.
    """

    async def dependency(request: Request) -> None:
        check_rate(request, f"{name}:{get_client_ip(request) or 'неизвестно'}", limit)

    return dependency


async def get_current_user_id(request: Request, settings: SettingsDep) -> UUID:
    """Опознать владельца запроса по access-токену.

    Токен ждём в заголовке `Authorization: Bearer …` и только там: в
    cookie он был бы доступен подделке запросов между сайтами, а в строке
    запроса — попал бы в журналы.

    Здесь же идентификатор уходит в контекст журналирования: дальше все
    записи этого запроса несут `user_id`, и не нужно передавать его
    каждому вызову.
    """
    заголовок = request.headers.get("authorization", "")
    схема, _, значение = заголовок.partition(" ")

    if схема.lower() != "bearer" or not значение.strip():
        raise BadCredentialsError("нужен access-токен")

    user_id = read_access_token(значение.strip(), settings)

    # Сбрасывать не нужно: каждый запрос обрабатывается своей задачей, а
    # контекст у задачи свой.
    user_id_var.set(str(user_id))

    return user_id


CurrentUserDep = Annotated[UUID, Depends(get_current_user_id)]


def get_mailer(settings: SettingsDep) -> Mailer:
    """Отправщик писем по настройкам.

    Отдельной зависимостью, а не внутри сервиса: тест подменяет её и
    читает письма, не поднимая почтовый сервер.
    """
    return create_mailer(settings)


MailerDep = Annotated[Mailer, Depends(get_mailer)]


def get_auth_service(
    session: SessionDep, settings: SettingsDep, mailer: MailerDep
) -> AuthService:
    """Сервис входа на сессии этого запроса."""
    return AuthService(session, settings, mailer)


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]


def get_sync_service(session: SessionDep, settings: SettingsDep) -> SyncService:
    """Сервис синхронизации на сессии этого запроса."""
    return SyncService(session, settings)


SyncServiceDep = Annotated[SyncService, Depends(get_sync_service)]


def get_account_service(session: SessionDep, settings: SettingsDep) -> AccountService:
    """Сервис прав субъекта на сессии этого запроса."""
    return AccountService(session, settings)


AccountServiceDep = Annotated[AccountService, Depends(get_account_service)]


#: Что годится в идентификатор, пришедший от клиента.
_БЕЗОПАСНЫЕ = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")


def _доверенный(host: str, settings: Settings) -> bool:
    """Можно ли верить заголовкам от этого соседа."""
    try:
        адрес = ipaddress.ip_address(host)
    except ValueError:
        # Не адрес вовсе — например, unix-сокет. Доверять нечему.
        return False

    if адрес.is_loopback:
        return True

    return any(адрес in сеть for сеть in settings.trusted_networks)


def _is_address(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True
