"""Репозиторий аккаунтов — на живой базе.

Проверяется ровно то, за что репозиторий отвечает: находит, создаёт и
упирается в ограничение уникальности. Правил («адрес занят — отказать»)
здесь нет: это сервис, шаг 7.
"""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from grafik_api.repositories import UserRepository
from tests import factories


async def test_незнакомого_адреса_нет(сессия: AsyncSession) -> None:
    репозиторий = UserRepository(сессия)

    assert await репозиторий.by_email("нет-такого@example.test") is None


async def test_созданный_аккаунт_находится_по_адресу(сессия: AsyncSession) -> None:
    репозиторий = UserRepository(сессия)

    создан = await репозиторий.create("петров@example.test")
    найден = await репозиторий.by_email("петров@example.test")

    assert найден is not None
    assert найден.id == создан.id
    # Ревизия аккаунта начинается с нуля: ещё ничего не синхронизировано.
    assert найден.rev == 0
    assert найден.email_verified_at is None


async def test_аккаунт_находится_по_ключу(сессия: AsyncSession) -> None:
    аккаунт = await factories.создать_аккаунт(сессия)
    репозиторий = UserRepository(сессия)

    assert (await репозиторий.get(аккаунт.id)) is not None
    assert (await репозиторий.get(аккаунт.id)).id == аккаунт.id  # type: ignore[union-attr]


async def test_повторный_адрес_не_проходит(сессия: AsyncSession) -> None:
    """Уникальность держит база, а не проверка в коде.

    Проверка «а нет ли уже такого» между запросом и вставкой не спасает:
    две регистрации на один адрес могут прийти одновременно. Поэтому
    ограничение в базе, а сервис превращает его в понятный ответ (шаг 7).
    """
    репозиторий = UserRepository(сессия)
    await репозиторий.create("один@example.test")

    try:
        await репозиторий.create("один@example.test")
    except IntegrityError:
        pass
    else:  # pragma: no cover - если дошли сюда, ограничения нет
        raise AssertionError("вторая вставка того же адреса должна падать")

    # Транзакция после этого непригодна — откат делает фикстура.
    await сессия.rollback()


async def test_удаление_аккаунта_уносит_доступ(сессия: AsyncSession) -> None:
    """Каскад не на словах: проверяется на живой базе."""
    аккаунт = await factories.создать_аккаунт(сессия)
    await factories.создать_доступ(сессия, аккаунт)

    репозиторий = UserRepository(сессия)
    await репозиторий.delete(аккаунт)
    await сессия.flush()

    assert await репозиторий.get(аккаунт.id) is None
