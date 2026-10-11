"""Права субъекта и смена пароля — сквозь HTTP и на живой базе.

Главный тест здесь — `test_после_удаления_остаётся_одна_обезличенная_запись`.
Он проверяет не код, а обещание из политики и из текста согласия:
«уничтожается всё». Если когда-нибудь появится таблица, которую удаление
не трогает, этот тест упадёт — для того он и написан построчно, по всем
таблицам схемы, а не по списку, который легко забыть пополнить.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from grafik_api.core.security import encode_wrapped
from grafik_api.models import (
    AuditEntry,
    Blob,
    BlobRevision,
    Consent,
    Credential,
    DataKey,
    OneTimeToken,
    RefreshToken,
    User,
)
from tests import factories

ЗНАЧЕНИЕ = factories.ЗНАЧЕНИЕ
ОБЁРТКА_ПАРОЛЕМ = factories.ОБЁРТКА_ПАРОЛЕМ
ОБЁРТКА_КЛЮЧОМ = factories.ОБЁРТКА_КЛЮЧОМ

НОВОЕ_ЗНАЧЕНИЕ = encode_wrapped(b"\x33" * 32)
НОВАЯ_ОБЁРТКА = encode_wrapped(b"\x44" * 60)
ДРУГАЯ_ОБЁРТКА_КЛЮЧОМ = encode_wrapped(b"\x55" * 60)

СОДЕРЖИМОЕ = b"\x99" * 128
ПРОФИЛЬ = "6f1e0000-0000-0000-0000-0000000000a1"


async def завести(
    клиент: httpx.AsyncClient, **правки: Any
) -> tuple[dict[str, str], dict[str, Any]]:
    """Аккаунт через HTTP: заголовок с access-токеном и тело ответа.

    `factories.войти` отдаёт только заголовок, а здесь почти всегда нужен
    и адрес почты — им потом входят заново, чтобы проверить смену пароля.
    """
    ответ = await factories.зарегистрировать(клиент, **правки)
    assert ответ.status_code == 201, ответ.text

    тело = ответ.json()
    return {"Authorization": f"Bearer {тело['access_token']}"}, тело


async def положить(
    клиент: httpx.AsyncClient, заголовки: dict[str, str], содержимое: bytes = СОДЕРЖИМОЕ
) -> httpx.Response:
    """Один элемент в аккаунте — чтобы выгрузке было что выгружать."""
    ответ = await клиент.post(
        "/api/v1/sync",
        json={
            "items": [
                {
                    "id": ПРОФИЛЬ,
                    "kind": "profile",
                    "base_rev": 0,
                    "mutation_id": "7d000000-0000-0000-0000-00000000000a",
                    "deleted": False,
                    "blob": encode_wrapped(содержимое),
                }
            ]
        },
        headers=заголовки,
    )
    assert ответ.status_code == 200, ответ.text
    return ответ


def тело_пароля(**правки: Any) -> dict[str, Any]:
    """Исправная смена пароля — с возможностью испортить одно поле."""
    тело: dict[str, Any] = {
        "current_verifier": ЗНАЧЕНИЕ,
        "verifier": НОВОЕ_ЗНАЧЕНИЕ,
        "wrapped_dek_pwd": НОВАЯ_ОБЁРТКА,
        "kdf_version": "kdf_v1",
    }
    тело.update(правки)
    return тело


async def сколько(сессия: AsyncSession, запрос: Select[Any]) -> int:
    """Сколько строк вернул бы запрос."""
    счёт = await сессия.scalar(select(func.count()).select_from(запрос.subquery()))
    return счёт or 0


async def событий(сессия: AsyncSession, event: str) -> int:
    return (
        await сессия.scalar(
            select(func.count())
            .select_from(AuditEntry)
            .where(AuditEntry.event == event)
        )
    ) or 0


# --- Сведения об аккаунте (ст. 14 152-ФЗ) ----------------------------------


async def test_сведения_об_аккаунте(клиент: httpx.AsyncClient) -> None:
    заголовки, тело_регистрации = await завести(клиент)
    await положить(клиент, заголовки)

    ответ = await клиент.get("/api/v1/account", headers=заголовки)

    assert ответ.status_code == 200

    тело = ответ.json()
    assert тело["id"] == тело_регистрации["account"]["id"]
    assert тело["email"] == тело_регистрации["account"]["email"]
    assert тело["email_verified"] is False
    assert тело["rev"] == 1
    assert тело["usage"] == {"items": 1, "bytes": len(СОДЕРЖИМОЕ)}
    # Три документа, под каждым — своя версия и одно время принятия.
    assert {запись["kind"] for запись in тело["consents"]} == {
        "policy",
        "consent",
        "terms",
    }


async def test_сведения_без_токена_не_отдаются(клиент: httpx.AsyncClient) -> None:
    ответ = await клиент.get("/api/v1/account")

    assert ответ.status_code == 401
    assert ответ.json()["code"] == "bad_credentials"


# --- Выгрузка --------------------------------------------------------------


async def test_выгрузка_отдаёт_всё_и_блоб_как_есть(клиент: httpx.AsyncClient) -> None:
    """Выгрузка — право на копию, а не отчёт о её существовании."""
    заголовки, _ = await завести(клиент)
    await положить(клиент, заголовки)

    ответ = await клиент.get("/api/v1/account/export", headers=заголовки)

    assert ответ.status_code == 200

    тело = ответ.json()
    assert тело["account"]["usage"]["items"] == 1
    assert тело["exported_at"]

    [элемент] = тело["items"]
    assert элемент["id"] == ПРОФИЛЬ
    assert элемент["kind"] == "profile"
    assert элемент["rev"] == 1
    # Как есть: ровно те байты, что прислал браузер. Расшифровать их
    # может только владелец — в этом и смысл.
    assert элемент["blob"] == encode_wrapped(СОДЕРЖИМОЕ)

    assert len(тело["consents"]) == 3
    # Журнал входов и действий: регистрация в нём уже есть.
    assert [вход["event"] for вход in тело["sign_ins"]] == ["auth.register"]


async def test_предел_выгрузок(клиент: httpx.AsyncClient) -> None:
    """Выгрузка тяжёлая: это все блобы аккаунта в одном ответе."""
    заголовки, _ = await завести(клиент)

    for _ in range(10):
        assert (
            await клиент.get("/api/v1/account/export", headers=заголовки)
        ).status_code == 200

    ответ = await клиент.get("/api/v1/account/export", headers=заголовки)

    assert ответ.status_code == 429
    assert ответ.json()["code"] == "rate_limited"
    assert ответ.headers["retry-after"]


# --- Смена пароля ----------------------------------------------------------


async def test_смена_пароля_меняет_значение_и_обёртку(
    клиент: httpx.AsyncClient,
) -> None:
    заголовки, тело = await завести(клиент)
    адрес = тело["account"]["email"]

    ответ = await клиент.post(
        "/api/v1/account/password", json=тело_пароля(), headers=заголовки
    )

    assert ответ.status_code == 204

    # Старое значение больше не подходит.
    отказ = await клиент.post(
        "/api/v1/auth/login", json={"email": адрес, "verifier": ЗНАЧЕНИЕ}
    )
    assert отказ.status_code == 401
    assert отказ.json()["code"] == "bad_credentials"

    # Новое — подходит, и обёртка приходит новая.
    вход = await клиент.post(
        "/api/v1/auth/login", json={"email": адрес, "verifier": НОВОЕ_ЗНАЧЕНИЕ}
    )
    assert вход.status_code == 200
    assert вход.json()["wrapped_dek_pwd"] == НОВАЯ_ОБЁРТКА


async def test_смена_пароля_перевыпускает_ключ_восстановления(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    """Человек заодно сменил ключ восстановления — обе обёртки новые."""
    заголовки, тело = await завести(клиент)

    ответ = await клиент.post(
        "/api/v1/account/password",
        json=тело_пароля(wrapped_dek_rec=ДРУГАЯ_ОБЁРТКА_КЛЮЧОМ),
        headers=заголовки,
    )

    assert ответ.status_code == 204

    обёртки = dict(
        (
            await сессия.execute(
                select(DataKey.kind, DataKey.wrapped).where(
                    DataKey.user_id == UUID(тело["account"]["id"])
                )
            )
        ).all()
    )
    assert encode_wrapped(обёртки["password"]) == НОВАЯ_ОБЁРТКА
    assert encode_wrapped(обёртки["recovery"]) == ДРУГАЯ_ОБЁРТКА_КЛЮЧОМ


async def test_смена_пароля_гасит_прочие_сессии(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    """Пароль меняют и потому, что его узнали: чужая сессия не переживёт."""
    заголовки, тело = await завести(клиент)
    адрес = тело["account"]["email"]

    # Второе устройство того же человека.
    второе = await клиент.post(
        "/api/v1/auth/login",
        json={"email": адрес, "verifier": ЗНАЧЕНИЕ},
        headers={"X-Device-Id": "planshet"},
    )
    assert второе.status_code == 200

    ответ = await клиент.post(
        "/api/v1/account/password",
        json=тело_пароля(),
        headers={**заголовки, "X-Device-Id": "telefon"},
    )

    assert ответ.status_code == 204

    живых = await сессия.scalar(
        select(func.count())
        .select_from(RefreshToken)
        .where(
            RefreshToken.user_id == UUID(тело["account"]["id"]),
            RefreshToken.revoked_at.is_(None),
        )
    )
    # Ни одной: устройства `telefon` среди них не было — регистрация
    # шла без заголовка, и это честнее, чем подыгрывать самим себе.
    assert живых == 0
    assert await событий(сессия, "account.password.changed") == 1


async def test_смена_пароля_сохраняет_текущее_устройство(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    """То устройство, на котором меняли, остаётся в деле."""
    заголовки, тело = await завести(клиент)
    адрес = тело["account"]["email"]

    for имя in ("telefon", "planshet"):
        ответ = await клиент.post(
            "/api/v1/auth/login",
            json={"email": адрес, "verifier": ЗНАЧЕНИЕ},
            headers={"X-Device-Id": имя},
        )
        assert ответ.status_code == 200

    ответ = await клиент.post(
        "/api/v1/account/password",
        json=тело_пароля(),
        headers={**заголовки, "X-Device-Id": "telefon"},
    )

    assert ответ.status_code == 204

    живые = (
        await сессия.scalars(
            select(RefreshToken.device_id).where(
                RefreshToken.user_id == UUID(тело["account"]["id"]),
                RefreshToken.revoked_at.is_(None),
            )
        )
    ).all()
    assert list(живые) == ["telefon"]


async def test_смена_пароля_с_неверным_текущим_значением(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    """Украденного access-токена не хватает, чтобы сменить пароль."""
    заголовки, _ = await завести(клиент)

    ответ = await клиент.post(
        "/api/v1/account/password",
        json=тело_пароля(current_verifier=НОВОЕ_ЗНАЧЕНИЕ),
        headers=заголовки,
    )

    assert ответ.status_code == 401
    assert ответ.json()["code"] == "bad_credentials"
    # Запись об отказе обязана пережить сам отказ (ч. 1 ст. 19 152-ФЗ).
    assert await событий(сессия, "account.password.failed") == 1


async def test_смена_пароля_с_неизвестной_версией_параметров(
    клиент: httpx.AsyncClient,
) -> None:
    заголовки, _ = await завести(клиент)

    ответ = await клиент.post(
        "/api/v1/account/password",
        json=тело_пароля(kdf_version="kdf_v9"),
        headers=заголовки,
    )

    assert ответ.status_code == 422
    assert ответ.json()["code"] == "validation_failed"


# --- Удаление --------------------------------------------------------------


async def test_после_удаления_остаётся_одна_обезличенная_запись(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    """Готовность шага 9: в базе не остаётся ничего, кроме записи аудита."""
    заголовки, тело = await завести(клиент)
    user_id = UUID(тело["account"]["id"])
    адрес = тело["account"]["email"]
    await положить(клиент, заголовки)
    await клиент.get("/api/v1/account/export", headers=заголовки)

    # История ревизий связана не с аккаунтом, а с блобом, поэтому её
    # строки запоминаются заранее: после удаления искать их будет не по
    # чему, а осиротевшая ревизия — это и есть неудалённые данные.
    блобы = set(
        (await сессия.scalars(select(Blob.id).where(Blob.user_id == user_id))).all()
    )
    assert блобы

    ответ = await клиент.request(
        "DELETE",
        "/api/v1/account",
        json={"verifier": ЗНАЧЕНИЕ},
        headers=заголовки,
    )

    assert ответ.status_code == 204

    # Построчно по всем таблицам, кроме журнала: появится новая — и этот
    # тест придётся дополнить, что и требуется.
    assert await сколько(сессия, select(User).where(User.id == user_id)) == 0

    for таблица in (
        Credential,
        DataKey,
        Consent,
        Blob,
        RefreshToken,
        OneTimeToken,
    ):
        осталось = await сколько(
            сессия, select(таблица).where(таблица.user_id == user_id)
        )
        assert осталось == 0, таблица.__name__

    осталось = await сколько(
        сессия, select(BlobRevision).where(BlobRevision.blob_id.in_(блобы))
    )
    assert осталось == 0

    записи = (
        await сессия.scalars(select(AuditEntry).where(AuditEntry.user_id == user_id))
    ).all()
    [запись] = записи
    assert запись.event == "account.deleted"
    # Подробности — обезличенные счётчики: по ним видно, что удалять было
    # что, но человека по ним не определить.
    assert запись.details == {
        "items": 1,
        "bytes": len(СОДЕРЖИМОЕ),
        "log_rows": 2,
    }

    # Адреса в базе нет нигде — ни в журнале, ни в подробностях.
    assert адрес not in str(запись.details)


async def test_после_удаления_адрес_снова_свободен(
    клиент: httpx.AsyncClient,
) -> None:
    """Удаление — настоящее: тем же адресом можно завести аккаунт заново."""
    заголовки, тело = await завести(клиент)
    адрес = тело["account"]["email"]

    ответ = await клиент.request(
        "DELETE",
        "/api/v1/account",
        json={"verifier": ЗНАЧЕНИЕ},
        headers=заголовки,
    )
    assert ответ.status_code == 204

    снова = await factories.зарегистрировать(клиент, email=адрес)
    assert снова.status_code == 201


async def test_удаление_убирает_cookie(клиент: httpx.AsyncClient) -> None:
    """Браузеру незачем держать cookie от аккаунта, которого нет."""
    заголовки, _ = await завести(клиент)

    ответ = await клиент.request(
        "DELETE",
        "/api/v1/account",
        json={"verifier": ЗНАЧЕНИЕ},
        headers=заголовки,
    )

    печенье = ответ.headers["set-cookie"]
    assert "grafik_refresh=" in печенье
    assert "Path=/api/v1/auth" in печенье
    # Срок в прошлом или нулевой возраст — браузер выбросит её сразу.
    assert "expires=Thu, 01 Jan 1970" in печенье.lower() or "Max-Age=0" in печенье


async def test_удаление_с_неверным_значением(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    """Иначе украденный access-токен стирал бы человеку год работы."""
    заголовки, тело = await завести(клиент)

    ответ = await клиент.request(
        "DELETE",
        "/api/v1/account",
        json={"verifier": НОВОЕ_ЗНАЧЕНИЕ},
        headers=заголовки,
    )

    assert ответ.status_code == 401
    assert ответ.json()["code"] == "bad_credentials"
    # Аккаунт жив.
    assert (
        await сессия.scalar(
            select(func.count())
            .select_from(User)
            .where(User.id == UUID(тело["account"]["id"]))
        )
    ) == 1
    assert await событий(сессия, "account.delete.failed") == 1


async def test_предел_опасных_действий(клиент: httpx.AsyncClient) -> None:
    """Обе опасные ручки проверяют значение — значит годятся для перебора."""
    заголовки, _ = await завести(клиент)

    for _ in range(10):
        ответ = await клиент.post(
            "/api/v1/account/password",
            json=тело_пароля(current_verifier=НОВОЕ_ЗНАЧЕНИЕ),
            headers=заголовки,
        )
        assert ответ.status_code == 401

    ответ = await клиент.post(
        "/api/v1/account/password",
        json=тело_пароля(current_verifier=НОВОЕ_ЗНАЧЕНИЕ),
        headers=заголовки,
    )

    assert ответ.status_code == 429
    assert ответ.json()["code"] == "rate_limited"
