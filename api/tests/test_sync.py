"""Синхронизация: ревизии, конфликты, надгробия, лимиты, сборка мусора.

Главный тест здесь — «два устройства правили офлайн». Он проверяет не код,
а обещание из контракта: молча не теряется ничего и никогда.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from grafik_api.core.config import Settings
from grafik_api.core.limits import Limit
from grafik_api.core.security import decode_wrapped, encode_wrapped
from grafik_api.models import Blob, BlobRevision, User
from grafik_api.services.sync import SyncService
from tests import factories

ПРОФИЛЬ = "6f1e0000-0000-0000-0000-000000000001"


def элемент(
    *,
    kind: str = "profile",
    item_id: str = ПРОФИЛЬ,
    base_rev: int = 0,
    содержимое: bytes | None = b"\x11" * 64,
    deleted: bool = False,
    mutation_id: str | None = None,
) -> dict[str, Any]:
    """Один элемент для отправки."""
    тело: dict[str, Any] = {
        "id": item_id,
        "kind": kind,
        "base_rev": base_rev,
        "mutation_id": mutation_id or str(uuid4()),
        "deleted": deleted,
    }
    if содержимое is not None:
        тело["blob"] = encode_wrapped(содержимое)
    return тело


async def отправить(
    клиент: httpx.AsyncClient, заголовки: dict[str, str], *элементы: dict[str, Any]
) -> httpx.Response:
    return await клиент.post(
        "/api/v1/sync", json={"items": list(элементы)}, headers=заголовки
    )


async def выбрать(
    клиент: httpx.AsyncClient,
    заголовки: dict[str, str],
    *,
    since: int = 0,
    limit: int | None = None,
) -> httpx.Response:
    параметры: dict[str, Any] = {"since": since}
    if limit is not None:
        параметры["limit"] = limit

    return await клиент.get("/api/v1/sync", params=параметры, headers=заголовки)


# --- Основной обмен --------------------------------------------------------


async def test_отправка_и_выборка(клиент: httpx.AsyncClient) -> None:
    заголовки = await factories.войти(клиент)

    отправка = await отправить(
        клиент,
        заголовки,
        элемент(kind="index", item_id="index", содержимое=b"\x01" * 32),
        элемент(содержимое=b"\x02" * 64),
    )

    assert отправка.status_code == 200
    тело = отправка.json()
    # Ревизия аккаунта — одна последовательность: 1 и 2, а не 1 и 1.
    assert [принят["rev"] for принят in тело["applied"]] == [1, 2]
    assert тело["rev"] == 2
    assert тело["conflicts"] == []

    выборка = await выбрать(клиент, заголовки)

    assert выборка.status_code == 200
    ответ = выборка.json()
    assert ответ["rev"] == 2
    assert ответ["min_rev_available"] == 0
    assert ответ["has_more"] is False

    по_виду = {item["kind"]: item for item in ответ["items"]}
    assert по_виду["index"]["id"] == "index"
    # Блоб вернулся байт в байт — сервер в него не заглядывал.
    assert decode_blob(по_виду["profile"]["blob"]) == b"\x02" * 64
    assert по_виду["profile"]["size"] == 64
    assert по_виду["profile"]["deleted"] is False


def decode_blob(значение: str) -> bytes:
    return decode_wrapped(значение)


async def test_оформление_ходит_как_обычный_элемент(
    клиент: httpx.AsyncClient,
) -> None:
    """Цвета лампы и событий — третий вид элемента, единственный на аккаунт."""
    заголовки = await factories.войти(клиент)

    первая = await отправить(
        клиент,
        заголовки,
        элемент(kind="appearance", item_id="appearance", содержимое=b"\x07" * 48),
    )
    assert первая.status_code == 200
    assert первая.json()["applied"] == [
        {"id": "appearance", "kind": "appearance", "rev": 1}
    ]

    # Правка с базовой ревизией — вторая ревизия того же элемента, а не второй
    # элемент: оформление у аккаунта одно.
    вторая = await отправить(
        клиент,
        заголовки,
        элемент(
            kind="appearance",
            item_id="appearance",
            base_rev=1,
            содержимое=b"\x08" * 48,
        ),
    )
    assert вторая.json()["applied"][0]["rev"] == 2

    выборка = (await выбрать(клиент, заголовки)).json()
    assert [(item["kind"], item["id"]) for item in выборка["items"]] == [
        ("appearance", "appearance")
    ]
    # Содержимое — байт в байт: сервер оформление не читает, как и остальное.
    assert decode_blob(выборка["items"][0]["blob"]) == b"\x08" * 48


async def test_оформление_расходится_как_остальное(
    клиент: httpx.AsyncClient,
) -> None:
    """Два устройства правили оформление: сервер сообщает, а не сливает."""
    заголовки = await factories.войти(клиент)
    await отправить(клиент, заголовки, элемент(kind="appearance", item_id="appearance"))

    # Второе устройство ещё не знает о ревизии 1 и пишет «с нуля».
    ответ = await отправить(
        клиент,
        заголовки,
        элемент(
            kind="appearance",
            item_id="appearance",
            base_rev=0,
            содержимое=b"\x09" * 40,
        ),
    )

    тело = ответ.json()
    assert ответ.status_code == 200
    assert тело["applied"] == []
    assert [(item["kind"], item["rev"]) for item in тело["conflicts"]] == [
        ("appearance", 1)
    ]


async def test_оформление_удаляется_надгробием(клиент: httpx.AsyncClient) -> None:
    заголовки = await factories.войти(клиент)
    await отправить(клиент, заголовки, элемент(kind="appearance", item_id="appearance"))

    ответ = await отправить(
        клиент,
        заголовки,
        элемент(
            kind="appearance",
            item_id="appearance",
            base_rev=1,
            содержимое=None,
            deleted=True,
        ),
    )

    assert ответ.status_code == 200
    item = (await выбрать(клиент, заголовки)).json()["items"][0]
    assert item["deleted"] is True
    assert item["blob"] is None


async def test_выбирается_только_изменившееся(клиент: httpx.AsyncClient) -> None:
    заголовки = await factories.войти(клиент)
    await отправить(клиент, заголовки, элемент(kind="index", item_id="index"))
    await отправить(клиент, заголовки, элемент())

    ответ = await выбрать(клиент, заголовки, since=1)

    assert [item["kind"] for item in ответ.json()["items"]] == ["profile"]


async def test_постранично(клиент: httpx.AsyncClient) -> None:
    """Страница на один элемент: курсор должен продолжать с того же места."""
    заголовки = await factories.войти(клиент)
    await отправить(
        клиент,
        заголовки,
        элемент(kind="index", item_id="index"),
        элемент(item_id=ПРОФИЛЬ),
        элемент(item_id="6f1e0000-0000-0000-0000-000000000002"),
    )

    первая = (await выбрать(клиент, заголовки, limit=2)).json()

    assert len(первая["items"]) == 2
    assert первая["has_more"] is True

    вторая = (
        await выбрать(клиент, заголовки, since=первая["items"][-1]["rev"], limit=2)
    ).json()

    assert len(вторая["items"]) == 1
    assert вторая["has_more"] is False


# --- Конфликты -------------------------------------------------------------


async def test_два_устройства_правили_офлайн(клиент: httpx.AsyncClient) -> None:
    """Обещание из раздела 5 контракта: молча не теряется ничего.

    Телефон и компьютер правили один профиль без сети. Телефон поймал сеть
    первым. Компьютер получает не отказ, а нынешнее состояние — сливает у
    себя и отправляет снова. Телефон при следующей выборке видит слитое.
    """
    заголовки = await factories.войти(клиент)

    # Телефон успел первым.
    телефон = await отправить(клиент, заголовки, элемент(содержимое=b"\xaa" * 64))
    assert телефон.json()["applied"][0]["rev"] == 1

    # Компьютер правил ту же запись на ревизии 0 — и узнаёт об этом.
    компьютер = await отправить(клиент, заголовки, элемент(содержимое=b"\xbb" * 64))

    assert компьютер.status_code == 200
    assert компьютер.json()["applied"] == []

    расхождение = компьютер.json()["conflicts"][0]
    assert расхождение["rev"] == 1
    # Вместе с расхождением пришло то, с чем нужно слиться.
    assert decode_blob(расхождение["blob"]) == b"\xaa" * 64

    # Компьютер слил и отправил на ревизии, которую ему сообщили.
    слитое = await отправить(
        клиент, заголовки, элемент(base_rev=1, содержимое=b"\xcc" * 64)
    )

    assert слитое.json()["applied"][0]["rev"] == 2
    assert слитое.json()["conflicts"] == []

    # Телефон подтянет слитое следующей выборкой.
    у_телефона = (await выбрать(клиент, заголовки, since=1)).json()
    assert decode_blob(у_телефона["items"][0]["blob"]) == b"\xcc" * 64


async def test_расхождение_одного_не_мешает_остальным(
    клиент: httpx.AsyncClient,
) -> None:
    """Иначе человек с одним разошедшимся профилем не отправит и остальные."""
    заголовки = await factories.войти(клиент)
    await отправить(клиент, заголовки, элемент())

    ответ = await отправить(
        клиент,
        заголовки,
        элемент(base_rev=0),  # разошёлся
        элемент(kind="index", item_id="index", base_rev=0),  # а этот новый
    )

    тело = ответ.json()
    assert [принят["kind"] for принят in тело["applied"]] == ["index"]
    assert [расход["kind"] for расход in тело["conflicts"]] == ["profile"]


async def test_правка_элемента_которого_нет(клиент: httpx.AsyncClient) -> None:
    """Клиент правил то, чего на сервере уже нет: отвечаем «его нет»."""
    заголовки = await factories.войти(клиент)

    ответ = await отправить(клиент, заголовки, элемент(base_rev=7))

    расхождение = ответ.json()["conflicts"][0]
    assert расхождение["rev"] == 0
    assert расхождение["deleted"] is True
    assert расхождение["blob"] is None


# --- Идемпотентность -------------------------------------------------------


async def test_повтор_той_же_правки_не_создаёт_ревизии(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    """Сеть рвётся, клиент повторяет — и это не должно выглядеть конфликтом."""
    заголовки = await factories.войти(клиент)
    попытка = str(uuid4())

    первый = await отправить(
        клиент, заголовки, элемент(mutation_id=попытка, содержимое=b"\x33" * 64)
    )
    второй = await отправить(
        клиент, заголовки, элемент(mutation_id=попытка, содержимое=b"\x33" * 64)
    )

    assert первый.json()["applied"] == второй.json()["applied"]
    assert второй.json()["rev"] == 1
    assert второй.json()["conflicts"] == []
    # Новой версии в истории не появилось.
    assert await сессия.scalar(select(func.count()).select_from(BlobRevision)) == 0


# --- Удаление --------------------------------------------------------------


async def test_удаление_оставляет_надгробие(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    заголовки = await factories.войти(клиент)
    await отправить(клиент, заголовки, элемент(содержимое=b"\x44" * 64))

    удаление = await отправить(
        клиент, заголовки, элемент(base_rev=1, содержимое=None, deleted=True)
    )

    assert удаление.json()["applied"][0]["rev"] == 2

    надгробие = (await выбрать(клиент, заголовки, since=1)).json()["items"][0]
    assert надгробие["deleted"] is True
    assert надгробие["blob"] is None
    assert надгробие["size"] == 0

    # Содержимое стёрто и из истории: иначе «удалил» значило бы «не видно».
    assert await сессия.scalar(select(func.count()).select_from(BlobRevision)) == 0
    assert await сессия.scalar(select(Blob.blob)) is None


async def test_правка_после_удаления_воскрешает(клиент: httpx.AsyncClient) -> None:
    """Удалить человек всегда успеет, а воскресить стёртое — нет."""
    заголовки = await factories.войти(клиент)
    await отправить(клиент, заголовки, элемент(содержимое=b"\x55" * 64))
    await отправить(
        клиент, заголовки, элемент(base_rev=1, содержимое=None, deleted=True)
    )

    ответ = await отправить(
        клиент, заголовки, элемент(base_rev=2, содержимое=b"\x66" * 64)
    )

    assert ответ.json()["applied"][0]["rev"] == 3

    элементы = (await выбрать(клиент, заголовки, since=2)).json()["items"]
    assert элементы[0]["deleted"] is False
    assert decode_blob(элементы[0]["blob"]) == b"\x66" * 64


async def test_удаление_того_чего_не_было(клиент: httpx.AsyncClient) -> None:
    """Надгробие всё равно нужно: другое устройство могло не знать."""
    заголовки = await factories.войти(клиент)

    ответ = await отправить(клиент, заголовки, элемент(содержимое=None, deleted=True))

    assert ответ.json()["applied"][0]["rev"] == 1
    assert (await выбрать(клиент, заголовки)).json()["items"][0]["deleted"] is True


# --- История ---------------------------------------------------------------


async def test_прежние_версии_уходят_в_историю(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    """Страховка от «стёр год одним нажатием»."""
    заголовки = await factories.войти(клиент)
    await отправить(клиент, заголовки, элемент(содержимое=b"\x01" * 64))
    await отправить(клиент, заголовки, элемент(base_rev=1, содержимое=b"\x02" * 64))
    await отправить(клиент, заголовки, элемент(base_rev=2, содержимое=b"\x03" * 64))

    версии = (
        await сессия.scalars(select(BlobRevision).order_by(BlobRevision.rev))
    ).all()

    assert [версия.rev for версия in версии] == [1, 2]
    assert версии[0].blob == b"\x01" * 64


async def test_история_обрезается(
    клиент: httpx.AsyncClient, сессия: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Десять версий — страховка, сто — архив, которого никто не просил."""
    monkeypatch.setattr("grafik_api.services.sync.HISTORY_KEEP", 2)

    заголовки = await factories.войти(клиент)
    await отправить(клиент, заголовки, элемент(содержимое=bytes([0]) * 64))
    for ревизия in range(1, 5):
        await отправить(
            клиент,
            заголовки,
            элемент(base_rev=ревизия, содержимое=bytes([ревизия]) * 64),
        )

    версии = (await сессия.scalars(select(BlobRevision.rev))).all()

    assert sorted(версии) == [3, 4]


# --- Лимиты и квоты --------------------------------------------------------


async def test_слишком_большой_элемент(клиент: httpx.AsyncClient) -> None:
    заголовки = await factories.войти(клиент)

    ответ = await отправить(
        клиент, заголовки, элемент(содержимое=b"\x00" * (1024 * 1024 + 1))
    )

    assert ответ.status_code == 413
    assert ответ.json()["code"] == "item_too_large"
    assert ответ.json()["limit"] == 1024 * 1024


async def test_квота_по_числу_элементов(
    клиент: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("grafik_api.services.sync.MAX_ITEMS_PER_ACCOUNT", 1)
    заголовки = await factories.войти(клиент)
    await отправить(клиент, заголовки, элемент())

    ответ = await отправить(
        клиент, заголовки, элемент(item_id="6f1e0000-0000-0000-0000-000000000009")
    )

    assert ответ.status_code == 413
    assert ответ.json()["code"] == "quota_exceeded"


async def test_квота_по_объёму(
    клиент: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("grafik_api.services.sync.MAX_ACCOUNT_BYTES", 100)
    заголовки = await factories.войти(клиент)

    ответ = await отправить(клиент, заголовки, элемент(содержимое=b"\x00" * 128))

    assert ответ.status_code == 413
    assert ответ.json()["code"] == "quota_exceeded"


async def test_удаление_освобождает_объём(
    клиент: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Иначе человек с полной квотой не смог бы ничего удалить."""
    monkeypatch.setattr("grafik_api.services.sync.MAX_ACCOUNT_BYTES", 100)
    заголовки = await factories.войти(клиент)
    await отправить(клиент, заголовки, элемент(содержимое=b"\x00" * 64))

    ответ = await отправить(
        клиент, заголовки, элемент(base_rev=1, содержимое=None, deleted=True)
    )

    assert ответ.status_code == 200


@pytest.mark.parametrize(
    ("правки", "почему"),
    [
        ({"kind": "index", "item_id": "не-index"}, "указатель один на аккаунт"),
        (
            {"kind": "appearance", "item_id": "не-appearance"},
            "оформление одно на аккаунт",
        ),
        (
            {"kind": "appearance", "item_id": ПРОФИЛЬ},
            "оформлением не подменить профиль",
        ),
        ({"содержимое": None}, "элемент без содержимого"),
        ({"deleted": True}, "у удаления не бывает содержимого"),
    ],
)
async def test_несуразные_правки_отвергаются(
    клиент: httpx.AsyncClient, правки: dict[str, Any], почему: str
) -> None:
    заголовки = await factories.войти(клиент)

    ответ = await отправить(клиент, заголовки, элемент(**правки))

    assert ответ.status_code == 422, почему
    assert ответ.json()["code"] == "validation_failed"


async def test_предел_частоты_отправки(
    клиент: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("grafik_api.api.v1.sync.SYNC", Limit(requests=2, seconds=60))
    заголовки = await factories.войти(клиент)

    коды = [
        (await отправить(клиент, заголовки, элемент(base_rev=номер))).status_code
        for номер in range(3)
    ]

    assert коды == [200, 200, 429]


# --- Чужого не видно -------------------------------------------------------


async def test_элементы_соседа_не_видны(клиент: httpx.AsyncClient) -> None:
    """Аккаунт берётся из токена, а не из запроса — попросить чужое нечем."""
    первый = await factories.войти(клиент)
    await отправить(клиент, первый, элемент(содержимое=b"\x77" * 64))

    второй = await factories.войти(клиент)
    await отправить(клиент, второй, элемент(содержимое=b"\x88" * 64))

    у_первого = (await выбрать(клиент, первый)).json()
    у_второго = (await выбрать(клиент, второй)).json()

    assert len(у_первого["items"]) == 1
    assert decode_blob(у_первого["items"][0]["blob"]) == b"\x77" * 64
    assert decode_blob(у_второго["items"][0]["blob"]) == b"\x88" * 64
    # Ревизии у каждого свои и начинаются с единицы.
    assert у_первого["rev"] == у_второго["rev"] == 1


@pytest.mark.parametrize("путь", ["выборка", "отправка"])
async def test_без_токена_не_пускают(клиент: httpx.AsyncClient, путь: str) -> None:
    ответ = (
        await выбрать(клиент, {})
        if путь == "выборка"
        else await отправить(клиент, {}, элемент())
    )

    assert ответ.status_code == 401
    assert ответ.json()["code"] == "bad_credentials"


# --- Полнота истории -------------------------------------------------------


async def test_курсор_старше_истории(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    """Устройство, не включавшееся полгода, не должно пропустить удаления."""
    заголовки = await factories.войти(клиент)
    await отправить(клиент, заголовки, элемент())

    await сессия.execute(update(User).values(min_rev_available=5))
    await сессия.flush()

    ответ = await выбрать(клиент, заголовки, since=1)

    assert ответ.status_code == 409
    assert ответ.json()["code"] == "resync_required"
    assert ответ.json()["min_rev_available"] == 5

    # Выборка с нуля при этом разрешена — с неё и начинают заново.
    assert (await выбрать(клиент, заголовки, since=0)).status_code == 409


# --- Сборка мусора ---------------------------------------------------------


async def test_сборщик_убирает_старые_надгробия(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    заголовки = await factories.войти(клиент)
    await отправить(клиент, заголовки, элемент(содержимое=b"\x99" * 64))
    await отправить(
        клиент, заголовки, элемент(base_rev=1, содержимое=None, deleted=True)
    )

    # Надгробию полгода с лишним.
    await сессия.execute(
        update(Blob).values(deleted_at=datetime.now(UTC) - timedelta(days=200))
    )
    await сессия.flush()

    отчёт = await SyncService(сессия, Settings(env="test")).collect_garbage()

    assert отчёт.tombstones == 1
    assert отчёт.accounts == 1
    assert await сессия.scalar(select(func.count()).select_from(Blob)) == 0
    # И граница полной истории поднялась до ревизии убранного надгробия.
    assert await сессия.scalar(select(User.min_rev_available)) == 2


async def test_сборщик_убирает_старые_версии(
    клиент: httpx.AsyncClient, сессия: AsyncSession
) -> None:
    """Тридцать дней — страховка; дальше это архив, которого не просили."""
    заголовки = await factories.войти(клиент)
    await отправить(клиент, заголовки, элемент(содержимое=b"\x01" * 64))
    await отправить(клиент, заголовки, элемент(base_rev=1, содержимое=b"\x02" * 64))

    await сессия.execute(
        update(BlobRevision).values(written_at=datetime.now(UTC) - timedelta(days=31))
    )
    await сессия.flush()

    отчёт = await SyncService(сессия, Settings(env="test")).collect_garbage()

    assert отчёт.revisions == 1
    assert await сессия.scalar(select(func.count()).select_from(BlobRevision)) == 0


async def test_сборщику_нечего_делать(сессия: AsyncSession) -> None:
    отчёт = await SyncService(сессия, Settings(env="test")).collect_garbage()

    assert (отчёт.tombstones, отчёт.revisions, отчёт.accounts) == (0, 0, 0)


async def test_сервис_проверяет_вид_сам(сессия: AsyncSession) -> None:
    """Схема отсекает неизвестный вид, но сервис не должен на это полагаться.

    Его зовут не только из ручки: из команды по расписанию, из переноса
    данных, из теста. Проверка принадлежит сервису, а схема — лишь первая
    линия.
    """
    from grafik_api.core.errors import ValidationFailedError
    from grafik_api.services.sync import PushCommand

    служба = SyncService(сессия, Settings(env="test"))
    аккаунт = await factories.создать_аккаунт(сессия)

    with pytest.raises(ValidationFailedError):
        await служба.push(
            аккаунт.id,
            [
                PushCommand(
                    kind="невиданный",
                    item_id="x",
                    base_rev=0,
                    mutation_id=uuid4(),
                    deleted=False,
                    blob=b"\x00",
                )
            ],
        )
