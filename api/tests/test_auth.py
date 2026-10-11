"""Регистрация, вход, обновление, выход — сквозь HTTP и на живой базе.

Проверяются не только удачные пути. Самое важное здесь — ветки, в которых
легко наделать дыр: повторная регистрация, неверное значение, незнакомый
адрес (ответ обязан совпадать с неверным значением), протухший и повторно
предъявленный refresh-токен.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from grafik_api.api.deps import CurrentUserDep
from grafik_api.core.legal import CURRENT_VERSIONS
from grafik_api.core.security import encode_wrapped, issue_access_token
from grafik_api.models import (
    AuditEntry,
    Consent,
    Credential,
    DataKey,
    RefreshToken,
    User,
)

АДРЕС = "петров@example.com"
ЗНАЧЕНИЕ = encode_wrapped(b"\x01" * 32)
ДРУГОЕ_ЗНАЧЕНИЕ = encode_wrapped(b"\x02" * 32)
ОБЁРТКА_ПАРОЛЕМ = encode_wrapped(b"\x10" * 60)
ОБЁРТКА_КЛЮЧОМ = encode_wrapped(b"\x20" * 60)


def тело_регистрации(**правки: Any) -> dict[str, Any]:
    """Исправное тело регистрации — с возможностью испортить одно поле."""
    тело: dict[str, Any] = {
        "email": АДРЕС,
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
    return await клиент.post("/api/v1/auth/register", json=тело_регистрации(**правки))


def с_cookie(токен: str) -> dict[str, str]:
    """Явный заголовок с refresh-токеном.

    Не через хранилище cookie клиента: `http.cookiejar` сопоставляет
    домены по своим правилам (имя без точки превращается в `api.local`), и
    поставленная руками cookie просто не отправляется. А выразить надо
    именно «кто-то предъявил вот этот токен».
    """
    return {"Cookie": f"grafik_refresh={токен}"}


async def устройство(сессия: AsyncSession, user_id: str) -> str | None:
    """Идентификатор устройства у токена этого аккаунта."""
    return await сессия.scalar(
        select(RefreshToken.device_id).where(RefreshToken.user_id == UUID(user_id))
    )


async def событий(сессия: AsyncSession, event: str) -> int:
    return (
        await сессия.scalar(
            select(func.count())
            .select_from(AuditEntry)
            .where(AuditEntry.event == event)
        )
    ) or 0


# --- Регистрация -----------------------------------------------------------


async def test_регистрация_открывает_сессию(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    ответ = await зарегистрировать(клиент)

    assert ответ.status_code == 201

    тело = ответ.json()
    assert тело["access_token"]
    assert тело["expires_in"] == 15 * 60
    # Обёртка возвращается сразу: браузеру ею открывать ключ данных.
    assert тело["wrapped_dek_pwd"] == ОБЁРТКА_ПАРОЛЕМ
    assert тело["kdf"]["kdf_version"] == "kdf_v1"
    assert тело["kdf"]["memory_kib"] == 65536
    assert тело["account"]["email"] == АДРЕС
    assert тело["account"]["email_verified"] is False
    assert тело["account"]["rev"] == 0
    assert len(тело["account"]["consents"]) == 3

    # В базе появилось всё, что нужно аккаунту, и ничего лишнего.
    assert await сессия.scalar(select(func.count()).select_from(User)) == 1
    assert await сессия.scalar(select(func.count()).select_from(Credential)) == 1
    assert await сессия.scalar(select(func.count()).select_from(DataKey)) == 2
    assert await сессия.scalar(select(func.count()).select_from(Consent)) == 1
    assert await событий(сессия, "auth.register") == 1


async def test_refresh_токен_только_в_cookie(клиент: httpx.AsyncClient) -> None:
    """В теле его быть не должно: тело читает скрипт."""
    ответ = await зарегистрировать(клиент)

    печенье = ответ.headers["set-cookie"]
    assert "grafik_refresh=" in печенье
    assert "HttpOnly" in печенье
    assert "Secure" in печенье
    assert "samesite=strict" in печенье.lower()
    assert "Path=/api/v1/auth" in печенье

    значение = клиент.cookies["grafik_refresh"]
    assert значение
    assert значение not in ответ.text


async def test_адрес_нормализуется_при_регистрации(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    """Иначе один человек заведёт два аккаунта разным регистром."""
    ответ = await зарегистрировать(клиент, email="  ПеТров@Example.COM  ")

    assert ответ.status_code == 201
    assert ответ.json()["account"]["email"] == АДРЕС
    assert await сессия.scalar(select(User.email)) == АДРЕС


async def test_повторная_регистрация_отвергается(клиент: httpx.AsyncClient) -> None:
    await зарегистрировать(клиент)

    ответ = await зарегистрировать(клиент)

    assert ответ.status_code == 409
    assert ответ.json()["code"] == "email_taken"


async def test_повторная_регистрация_в_другом_регистре(
    клиент: httpx.AsyncClient,
) -> None:
    await зарегистрировать(клиент)

    ответ = await зарегистрировать(клиент, email="ПЕТРОВ@EXAMPLE.COM")

    assert ответ.status_code == 409


async def test_неизвестная_версия_параметров(клиент: httpx.AsyncClient) -> None:
    ответ = await зарегистрировать(клиент, kdf_version="kdf_v99")

    assert ответ.status_code == 422
    assert ответ.json()["code"] == "validation_failed"


async def test_устаревшее_согласие_не_принимается(клиент: httpx.AsyncClient) -> None:
    """Старую редакцию принимать нельзя: доказывать придётся именно её."""
    ответ = await зарегистрировать(
        клиент,
        consent={
            "policy_version": "2020-01-01",
            "consent_version": CURRENT_VERSIONS["consent"],
            "terms_version": CURRENT_VERSIONS["terms"],
        },
    )

    assert ответ.status_code == 403
    assert ответ.json()["code"] == "consent_required"
    # В ответе — действующие версии, чтобы приложение показало их человеку.
    assert ответ.json()["current"]["policy"] == CURRENT_VERSIONS["policy"]


async def test_согласие_записано_с_версиями_и_временем(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    await зарегистрировать(клиент)

    запись = await сессия.scalar(select(Consent))

    assert запись is not None
    assert запись.policy_version == CURRENT_VERSIONS["policy"]
    assert запись.consent_version == CURRENT_VERSIONS["consent"]
    assert запись.terms_version == CURRENT_VERSIONS["terms"]
    assert запись.accepted_at is not None


async def test_мусор_вместо_обёртки(клиент: httpx.AsyncClient) -> None:
    """Схема отсекает до сервиса — и не показывает присланное."""
    ответ = await зарегистрировать(клиент, wrapped_dek_pwd="это+не/base64url")

    assert ответ.status_code == 422
    assert "это+не/base64url" not in ответ.text


# --- Вход ------------------------------------------------------------------


async def test_вход_возвращает_обёртку(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    await зарегистрировать(клиент)

    ответ = await клиент.post(
        "/api/v1/auth/login", json={"email": АДРЕС, "verifier": ЗНАЧЕНИЕ}
    )

    assert ответ.status_code == 200
    assert ответ.json()["wrapped_dek_pwd"] == ОБЁРТКА_ПАРОЛЕМ
    assert ответ.json()["account"]["email"] == АДРЕС
    assert await событий(сессия, "auth.login.ok") == 1


async def test_вход_в_другом_регистре(клиент: httpx.AsyncClient) -> None:
    await зарегистрировать(клиент)

    ответ = await клиент.post(
        "/api/v1/auth/login",
        json={"email": "  ПЕТРОВ@example.COM ", "verifier": ЗНАЧЕНИЕ},
    )

    assert ответ.status_code == 200


async def test_неверное_значение_и_незнакомый_адрес_отвечают_одинаково(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    """Главное правило: ответ не раскрывает существование аккаунта."""
    await зарегистрировать(клиент)

    чужое = await клиент.post(
        "/api/v1/auth/login", json={"email": АДРЕС, "verifier": ДРУГОЕ_ЗНАЧЕНИЕ}
    )
    незнакомый = await клиент.post(
        "/api/v1/auth/login",
        json={"email": "нет-такого@example.com", "verifier": ЗНАЧЕНИЕ},
    )

    assert чужое.status_code == незнакомый.status_code == 401

    без_запроса = {
        ключ: значение
        for ключ, значение in чужое.json().items()
        if ключ != "request_id"
    }
    assert без_запроса == {
        ключ: значение
        for ключ, значение in незнакомый.json().items()
        if ключ != "request_id"
    }
    assert без_запроса["code"] == "bad_credentials"

    # Неудачные попытки попадают в журнал событий — обе.
    assert await событий(сессия, "auth.login.failed") == 2


async def test_в_журнале_событий_нет_адреса(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    """Журнал не должен превращаться в перечень адресов, по которым стучались."""
    await клиент.post(
        "/api/v1/auth/login",
        json={"email": "чужой@example.com", "verifier": ЗНАЧЕНИЕ},
    )

    записи = (await сессия.scalars(select(AuditEntry))).all()

    assert записи
    for запись in записи:
        assert "example.com" not in str(запись.details)
        assert запись.request_id


async def test_предел_попыток_входа(клиент: httpx.AsyncClient) -> None:
    """Десять попыток за четверть часа — потом отказ с подсказкой."""
    await зарегистрировать(клиент)

    коды = []
    for _ in range(11):
        ответ = await клиент.post(
            "/api/v1/auth/login", json={"email": АДРЕС, "verifier": ДРУГОЕ_ЗНАЧЕНИЕ}
        )
        коды.append(ответ.status_code)

    assert коды[:10] == [401] * 10
    assert коды[10] == 429
    assert int(ответ.headers["retry-after"]) > 0


# --- Параметры до входа ----------------------------------------------------


async def test_параметры_для_незнакомого_адреса(клиент: httpx.AsyncClient) -> None:
    ответ = await клиент.post(
        "/api/v1/auth/params", json={"email": "никого@example.com"}
    )

    assert ответ.status_code == 200
    assert ответ.json()["kdf_version"] == "kdf_v1"


async def test_параметры_для_известного_адреса_такие_же(
    клиент: httpx.AsyncClient,
) -> None:
    """Разная форма ответа была бы оракулом существования аккаунта."""
    await зарегистрировать(клиент)

    известный = await клиент.post("/api/v1/auth/params", json={"email": АДРЕС})
    незнакомый = await клиент.post(
        "/api/v1/auth/params", json={"email": "никого@example.com"}
    )

    assert известный.json() == незнакомый.json()


# --- Обновление и выход ----------------------------------------------------


async def test_обновление_выдаёт_новые_токены(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    первый = await зарегистрировать(клиент)
    прежний = клиент.cookies["grafik_refresh"]

    ответ = await клиент.post("/api/v1/auth/refresh")

    assert ответ.status_code == 200
    assert ответ.json()["access_token"] != первый.json()["access_token"]
    # Обёртку при обновлении не присылают: ключ уже в памяти вкладки.
    assert ответ.json()["wrapped_dek_pwd"] is None
    assert клиент.cookies["grafik_refresh"] != прежний

    # Прежний токен помечен использованным, новый — в той же семье.
    токены = (await сессия.scalars(select(RefreshToken))).all()
    assert len(токены) == 2
    assert len({токен.family_id for токен in токены}) == 1
    assert sum(1 for токен in токены if токен.used_at is not None) == 1


async def test_повторное_использование_гасит_семью(
    приложение: FastAPI, клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    """Токен, предъявленный дважды, — признак кражи."""
    await зарегистрировать(клиент)
    украденный = клиент.cookies["grafik_refresh"]

    # Хозяин обновился: токен стал использованным, выдан новый.
    await клиент.post("/api/v1/auth/refresh")
    свежий = клиент.cookies["grafik_refresh"]

    # Вор предъявляет украденную копию.
    клиент.cookies.clear()
    кража = await клиент.post("/api/v1/auth/refresh", headers=с_cookie(украденный))

    assert кража.status_code == 401
    assert кража.json()["code"] == "token_revoked"
    assert await событий(сессия, "auth.refresh.reuse") == 1

    # И хозяину теперь тоже придётся войти заново: погашена вся семья.
    хозяин = await клиент.post("/api/v1/auth/refresh", headers=с_cookie(свежий))

    assert хозяин.status_code == 401
    assert хозяин.json()["code"] == "token_revoked"


async def test_протухший_refresh(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    await зарегистрировать(клиент)

    токен = await сессия.scalar(select(RefreshToken))
    assert токен is not None
    токен.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await сессия.flush()

    ответ = await клиент.post("/api/v1/auth/refresh")

    assert ответ.status_code == 401
    assert ответ.json()["code"] == "token_expired"


async def test_обновление_без_cookie(клиент: httpx.AsyncClient) -> None:
    ответ = await клиент.post("/api/v1/auth/refresh")

    assert ответ.status_code == 401
    assert ответ.json()["code"] == "bad_credentials"


async def test_неизвестный_refresh(клиент: httpx.AsyncClient) -> None:
    ответ = await клиент.post(
        "/api/v1/auth/refresh", headers=с_cookie("vzyatyj-s-potolka")
    )

    assert ответ.status_code == 401
    assert ответ.json()["code"] == "bad_credentials"


async def test_выход_гасит_семью(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    await зарегистрировать(клиент)

    выход = await клиент.post("/api/v1/auth/logout")

    assert выход.status_code == 204
    assert await событий(сессия, "auth.logout") == 1

    # Cookie забыта браузером, а токен погашен в базе — даже если копия
    # у кого-то осталась.
    assert "grafik_refresh" not in клиент.cookies
    токен = await сессия.scalar(select(RefreshToken))
    assert токен is not None
    assert токен.revoked_at is not None


async def test_выход_без_cookie_ничего_не_ломает(клиент: httpx.AsyncClient) -> None:
    ответ = await клиент.post("/api/v1/auth/logout")

    assert ответ.status_code == 204


async def test_отозванный_refresh_не_проходит(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    await зарегистрировать(клиент)
    токен = клиент.cookies["grafik_refresh"]
    await клиент.post("/api/v1/auth/logout")

    ответ = await клиент.post("/api/v1/auth/refresh", headers=с_cookie(токен))

    assert ответ.status_code == 401
    assert ответ.json()["code"] == "token_revoked"


# --- Опознание по access-токену -------------------------------------------


@pytest.fixture
def приложение_с_закрытой_ручкой(приложение: FastAPI) -> FastAPI:
    @приложение.get("/api/v1/кто-я")
    async def кто_я(user_id: CurrentUserDep) -> dict[str, str]:
        return {"user_id": str(user_id)}

    return приложение


async def test_токен_опознаёт_владельца(
    приложение_с_закрытой_ручкой: FastAPI, клиент: httpx.AsyncClient
) -> None:
    ответ = await зарегистрировать(клиент)
    токен = ответ.json()["access_token"]
    кто = ответ.json()["account"]["id"]

    закрытая = await клиент.get(
        "/api/v1/кто-я", headers={"Authorization": f"Bearer {токен}"}
    )

    assert закрытая.status_code == 200
    assert закрытая.json() == {"user_id": кто}


@pytest.mark.parametrize(
    "заголовок",
    [None, "", "Bearer", "Bearer   ", "Basic something", "prosto-token"],
)
async def test_без_внятного_токена_не_пускают(
    приложение_с_закрытой_ручкой: FastAPI,
    клиент: httpx.AsyncClient,
    заголовок: str | None,
) -> None:
    заголовки = {} if заголовок is None else {"Authorization": заголовок}

    ответ = await клиент.get("/api/v1/кто-я", headers=заголовки)

    assert ответ.status_code == 401
    assert ответ.json()["code"] == "bad_credentials"


async def test_протухший_access_токен(
    приложение_с_закрытой_ручкой: FastAPI, клиент: httpx.AsyncClient
) -> None:
    """Протухший и подделка — разные ошибки: по первой токен обновляют."""
    from uuid import uuid4

    from grafik_api.core.config import Settings

    настройки = Settings(env="test", access_ttl=-1)
    токен, _ = issue_access_token(uuid4(), настройки)

    ответ = await клиент.get(
        "/api/v1/кто-я", headers={"Authorization": f"Bearer {токен}"}
    )

    assert ответ.status_code == 401
    assert ответ.json()["code"] == "token_expired"


# --- Углы, в которые легко не заглянуть -----------------------------------


async def test_гонка_двух_регистраций(
    клиент: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Проверка «а нет ли уже такого» не спасает от одновременных запросов.

    Две регистрации на один адрес могут прийти разом, и обе пройдут
    проверку. Ловит это ограничение уникальности в базе, и ответ должен
    остаться тем же — «адрес занят», а не пятисотка. Гонка здесь
    изображена подменой: проверка всегда говорит «свободно».
    """
    from grafik_api.repositories.users import UserRepository

    await зарегистрировать(клиент)

    async def свободно(self: UserRepository, email: str) -> None:
        return None

    monkeypatch.setattr(UserRepository, "by_email", свободно)

    ответ = await зарегистрировать(клиент)

    assert ответ.status_code == 409
    assert ответ.json()["code"] == "email_taken"


async def test_хэш_пересчитывается_при_ужесточении_параметров(
    клиент: httpx.AsyncClient, сессия: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Параметры argon2 со временем ужесточают — старые хэши надо обновлять.

    Делать это можно только во время входа: лишь тогда проверочное
    значение на руках. Подменяется здесь решение «пора», а не сам хэш.
    """
    await зарегистрировать(клиент)
    прежний = await сессия.scalar(select(Credential.verifier_hash))

    monkeypatch.setattr("grafik_api.services.auth.needs_rehash", lambda _: True)

    ответ = await клиент.post(
        "/api/v1/auth/login", json={"email": АДРЕС, "verifier": ЗНАЧЕНИЕ}
    )

    assert ответ.status_code == 200
    сессия.expire_all()
    assert await сессия.scalar(select(Credential.verifier_hash)) != прежний


async def test_выход_по_чужому_токену_молчит(клиент: httpx.AsyncClient) -> None:
    """Выход — не место для рассказа о том, был ли токен настоящим."""
    ответ = await клиент.post(
        "/api/v1/auth/logout", headers=с_cookie("nikogda-ne-vydavalsya")
    )

    assert ответ.status_code == 204


async def test_параметры_для_аккаунта_без_доступа(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    """Аккаунт есть, проверочного значения нет — такого в бою не бывает.

    Бывает в недорегистрированном состоянии и при правке базы руками.
    Ответ должен остаться прежним: параметры по умолчанию, и ни намёка на
    то, что аккаунт существует.
    """
    from tests import factories

    аккаунт = await factories.создать_аккаунт(сессия, email="bez-dostupa@example.com")
    await сессия.flush()

    ответ = await клиент.post("/api/v1/auth/params", json={"email": аккаунт.email})

    assert ответ.status_code == 200
    assert ответ.json()["kdf_version"] == "kdf_v1"


@pytest.mark.parametrize("негодный", ["x" * 65, "ustrojstvo s probelami", ""])
async def test_негодный_идентификатор_устройства_не_пишется(
    клиент: httpx.AsyncClient, сессия: AsyncSession, негодный: str
) -> None:
    """Иначе в журнал входов попадёт строка на десять килобайт."""
    ответ = await клиент.post(
        "/api/v1/auth/register",
        json=тело_регистрации(),
        headers={"X-Device-Id": негодный},
    )

    assert ответ.status_code == 201
    assert await устройство(сессия, ответ.json()["account"]["id"]) is None


async def test_годный_идентификатор_устройства_запоминается(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    ответ = await клиент.post(
        "/api/v1/auth/register",
        json=тело_регистрации(),
        headers={"X-Device-Id": "telefon-1"},
    )

    assert await устройство(сессия, ответ.json()["account"]["id"]) == "telefon-1"
