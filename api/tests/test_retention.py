"""Сроки хранения: обещанное в политике должно исполняться кодом.

Эти проверки появились вместе с внутренними документами (шаг 14): перечень
сроков из раздела 8 контракта пришлось сверять со кодом строка за строкой, и
четыре строки оказались обещаны, а не сделаны. Тесты здесь затем, чтобы они
не вернулись в это состояние молча.

Каждая проверка устроена одинаково: кладём строку с датой «давно» и строку
«недавно», прогоняем службу, смотрим, что убрана ровно первая. Проверять
только удаление недостаточно: срок, удаляющий лишнее, хуже срока, не
удаляющего ничего.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from grafik_api.core.config import Settings
from grafik_api.core.security import token_digest
from grafik_api.models import AuditEntry, Blob, OneTimeToken, RefreshToken, User
from grafik_api.services.retention import AUDIT_DAYS, DRAFT_DAYS, RetentionService
from tests.factories import создать_аккаунт, создать_доступ

НАСТРОЙКИ = Settings(env="test")
СЕЙЧАС = datetime(2026, 10, 12, 12, 0, tzinfo=UTC)


def служба(сессия: AsyncSession) -> RetentionService:
    return RetentionService(сессия, НАСТРОЙКИ)


async def сколько(сессия: AsyncSession, модель: type[object]) -> int:
    строк = await сессия.scalar(select(func.count()).select_from(модель))
    return int(строк or 0)


# --- Журнал событий безопасности -------------------------------------------


async def test_журнал_живёт_180_дней(сессия: AsyncSession) -> None:
    user = await создать_аккаунт(сессия)

    сессия.add_all(
        [
            AuditEntry(
                at=СЕЙЧАС - timedelta(days=AUDIT_DAYS + 1),
                user_id=user.id,
                event="auth.login.ok",
            ),
            AuditEntry(
                at=СЕЙЧАС - timedelta(days=AUDIT_DAYS - 1),
                user_id=user.id,
                event="auth.login.ok",
            ),
        ]
    )
    await сессия.flush()

    отчёт = await служба(сессия).collect(now=СЕЙЧАС)

    assert отчёт.audit == 1
    assert await сколько(сессия, AuditEntry) == 1


async def test_обезличенная_запись_об_удалении_тоже_имеет_срок(
    сессия: AsyncSession,
) -> None:
    """Она остаётся после удаления аккаунта, но не навсегда.

    По ней подтверждается уничтожение (приказ Роскомнадзора № 179), и
    живёт она общим сроком журнала — 180 дней.
    """
    сессия.add(
        AuditEntry(
            at=СЕЙЧАС - timedelta(days=AUDIT_DAYS + 5),
            user_id=None,
            event="account.deleted",
            details={"items": 3, "bytes": 4096},
        )
    )
    await сессия.flush()

    отчёт = await служба(сессия).collect(now=СЕЙЧАС)

    assert отчёт.audit == 1
    assert await сколько(сессия, AuditEntry) == 0


# --- Сессии -----------------------------------------------------------------


async def test_протухшие_refresh_токены_убираются(сессия: AsyncSession) -> None:
    user = await создать_аккаунт(сессия)
    семья = user.id

    сессия.add_all(
        [
            RefreshToken(
                user_id=user.id,
                family_id=семья,
                token_hash=token_digest("protuhshiy"),
                issued_at=СЕЙЧАС - timedelta(days=31),
                expires_at=СЕЙЧАС - timedelta(minutes=1),
            ),
            RefreshToken(
                user_id=user.id,
                family_id=семья,
                token_hash=token_digest("zhivoy"),
                issued_at=СЕЙЧАС,
                expires_at=СЕЙЧАС + timedelta(days=30),
            ),
        ]
    )
    await сессия.flush()

    отчёт = await служба(сессия).collect(now=СЕЙЧАС)

    assert отчёт.sessions == 1
    остался = await сессия.scalar(select(RefreshToken.token_hash))
    assert остался == token_digest("zhivoy")


async def test_погашенный_но_не_протухший_токен_остаётся(
    сессия: AsyncSession,
) -> None:
    """По нему обнаруживается кража: предъявили то, что уже погашено.

    Удалить его раньше срока — значит ослепить защиту ровно там, где она
    нужна.
    """
    user = await создать_аккаунт(сессия)

    сессия.add(
        RefreshToken(
            user_id=user.id,
            family_id=user.id,
            token_hash=token_digest("pogashennyy"),
            issued_at=СЕЙЧАС - timedelta(days=1),
            expires_at=СЕЙЧАС + timedelta(days=29),
            used_at=СЕЙЧАС - timedelta(hours=1),
            revoked_at=СЕЙЧАС - timedelta(hours=1),
        )
    )
    await сессия.flush()

    отчёт = await служба(сессия).collect(now=СЕЙЧАС)

    assert отчёт.sessions == 0
    assert await сколько(сессия, RefreshToken) == 1


# --- Одноразовые ссылки -----------------------------------------------------


async def test_протухшие_ссылки_убираются(сессия: AsyncSession) -> None:
    user = await создать_аккаунт(сессия)

    сессия.add_all(
        [
            OneTimeToken(
                user_id=user.id,
                purpose="verify_email",
                token_hash=token_digest("vchera"),
                created_at=СЕЙЧАС - timedelta(days=2),
                expires_at=СЕЙЧАС - timedelta(days=1),
            ),
            OneTimeToken(
                user_id=user.id,
                purpose="recover",
                token_hash=token_digest("segodnya"),
                created_at=СЕЙЧАС,
                expires_at=СЕЙЧАС + timedelta(hours=24),
            ),
        ]
    )
    await сессия.flush()

    отчёт = await служба(сессия).collect(now=СЕЙЧАС)

    assert отчёт.links == 1
    assert await сколько(сессия, OneTimeToken) == 1


# --- Брошенные регистрации --------------------------------------------------


async def test_брошенная_регистрация_убирается_через_30_дней(
    сессия: AsyncSession,
) -> None:
    брошенный = await создать_аккаунт(сессия)
    брошенный.created_at = СЕЙЧАС - timedelta(days=DRAFT_DAYS + 1)
    await создать_доступ(сессия, брошенный)
    await сессия.flush()

    отчёт = await служба(сессия).collect(now=СЕЙЧАС)

    assert отчёт.drafts == 1
    assert await сколько(сессия, User) == 0


async def test_подтверждённый_аккаунт_не_трогаем(сессия: AsyncSession) -> None:
    user = await создать_аккаунт(сессия, verified=True)
    user.created_at = СЕЙЧАС - timedelta(days=DRAFT_DAYS + 100)
    await сессия.flush()

    отчёт = await служба(сессия).collect(now=СЕЙЧАС)

    assert отчёт.drafts == 0
    assert await сколько(сессия, User) == 1


async def test_неподтверждённый_но_с_данными_не_трогаем(
    сессия: AsyncSession,
) -> None:
    """Подтверждение адреса для работы не обязательно.

    Человек, который не нажал ссылку в письме, но уже ведёт график,
    аккаунт не бросил: удалить его — стереть данные по формальному
    признаку. Поэтому условие двойное, и вот эта проверка стоит именно за
    второй его половиной.
    """
    user = await создать_аккаунт(сессия)
    user.created_at = СЕЙЧАС - timedelta(days=DRAFT_DAYS + 10)
    сессия.add(
        Blob(
            user_id=user.id,
            kind="profile",
            item_id="odin",
            rev=1,
            blob=b"\x01" * 32,
            size=32,
        )
    )
    await сессия.flush()

    отчёт = await служба(сессия).collect(now=СЕЙЧАС)

    assert отчёт.drafts == 0
    assert await сколько(сессия, User) == 1


async def test_надгробие_тоже_считается_данными(сессия: AsyncSession) -> None:
    """У кого есть надгробие — у того есть история, а не брошенная анкета."""
    user = await создать_аккаунт(сессия)
    user.created_at = СЕЙЧАС - timedelta(days=DRAFT_DAYS + 10)
    сессия.add(
        Blob(
            user_id=user.id,
            kind="profile",
            item_id="udalyonnyy",
            rev=2,
            blob=None,
            size=0,
            deleted_at=СЕЙЧАС - timedelta(days=1),
        )
    )
    await сессия.flush()

    отчёт = await служба(сессия).collect(now=СЕЙЧАС)

    assert отчёт.drafts == 0


# --- Всё вместе -------------------------------------------------------------


async def test_на_пустой_базе_ничего_не_убирает(сессия: AsyncSession) -> None:
    отчёт = await служба(сессия).collect(now=СЕЙЧАС)

    assert отчёт.total == 0


async def test_отчёт_суммирует_всё_убранное(сессия: AsyncSession) -> None:
    user = await создать_аккаунт(сессия)
    брошенный = await создать_аккаунт(сессия)
    брошенный.created_at = СЕЙЧАС - timedelta(days=DRAFT_DAYS + 1)

    сессия.add_all(
        [
            AuditEntry(
                at=СЕЙЧАС - timedelta(days=AUDIT_DAYS + 1),
                user_id=user.id,
                event="auth.login.ok",
            ),
            RefreshToken(
                user_id=user.id,
                family_id=user.id,
                token_hash=token_digest("staryy"),
                issued_at=СЕЙЧАС - timedelta(days=40),
                expires_at=СЕЙЧАС - timedelta(days=10),
            ),
            OneTimeToken(
                user_id=user.id,
                purpose="recover",
                token_hash=token_digest("staraya-ssylka"),
                created_at=СЕЙЧАС - timedelta(days=3),
                expires_at=СЕЙЧАС - timedelta(days=2),
            ),
        ]
    )
    await сессия.flush()

    отчёт = await служба(сессия).collect(now=СЕЙЧАС)

    assert (отчёт.audit, отчёт.sessions, отчёт.links, отчёт.drafts) == (1, 1, 1, 1)
    assert отчёт.total == 4
