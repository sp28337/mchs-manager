"""Предел частоты обращений.

Единица измерения здесь — решение, а не реализация: столько-то попыток за
столько-то секунд, дальше отказ с подсказкой, когда повторить. Время
подменяется, чтобы не ждать четверть часа вживую.
"""

from __future__ import annotations

import logging

import httpx
import pytest
from fastapi import Depends, FastAPI

from grafik_api.core.config import Settings
from grafik_api.core.limits import Limit, RateLimiter
from grafik_api.main import create_app


class Часы:
    """Подменные часы: монотонные, но послушные."""

    def __init__(self) -> None:
        self.сейчас = 1_000.0

    def __call__(self) -> float:
        return self.сейчас

    def вперёд(self, секунд: float) -> None:
        self.сейчас += секунд


ТРИ_В_МИНУТУ = Limit(requests=3, seconds=60)


def test_в_пределах_разрешено() -> None:
    часы = Часы()
    счётчик = RateLimiter(clock=часы)

    assert [счётчик.hit("ключ", ТРИ_В_МИНУТУ) for _ in range(3)] == [None] * 3


def test_превышение_говорит_когда_повторить() -> None:
    часы = Часы()
    счётчик = RateLimiter(clock=часы)
    for _ in range(3):
        счётчик.hit("ключ", ТРИ_В_МИНУТУ)

    ждать = счётчик.hit("ключ", ТРИ_В_МИНУТУ)

    assert ждать == 60

    часы.вперёд(30)
    assert счётчик.hit("ключ", ТРИ_В_МИНУТУ) == 30


def test_окно_скользит() -> None:
    часы = Часы()
    счётчик = RateLimiter(clock=часы)
    for _ in range(3):
        счётчик.hit("ключ", ТРИ_В_МИНУТУ)

    часы.вперёд(61)

    assert счётчик.hit("ключ", ТРИ_В_МИНУТУ) is None


def test_отказ_не_продлевает_запрет() -> None:
    """Иначе тот, кто долбит в закрытую дверь, запирает её себе навсегда."""
    часы = Часы()
    счётчик = RateLimiter(clock=часы)
    for _ in range(3):
        счётчик.hit("ключ", ТРИ_В_МИНУТУ)

    # Двадцать попыток в упор.
    for _ in range(20):
        часы.вперёд(1)
        assert счётчик.hit("ключ", ТРИ_В_МИНУТУ) is not None

    # Ровно через минуту после первой разрешённой попытки — снова можно.
    часы.вперёд(61 - 20)
    assert счётчик.hit("ключ", ТРИ_В_МИНУТУ) is None


def test_ключи_независимы() -> None:
    счётчик = RateLimiter(clock=Часы())
    for _ in range(3):
        счётчик.hit("вход:1.2.3.4", ТРИ_В_МИНУТУ)

    assert счётчик.hit("вход:5.6.7.8", ТРИ_В_МИНУТУ) is None


def test_память_не_растёт_бесконечно(monkeypatch: pytest.MonkeyPatch) -> None:
    """Просроченные ключи выкидываются, иначе счётчик съест память."""
    часы = Часы()
    счётчик = RateLimiter(clock=часы)
    monkeypatch.setattr(RateLimiter, "SWEEP_AT", 3)

    for номер in range(4):
        счётчик.hit(f"ключ-{номер}", ТРИ_В_МИНУТУ)

    часы.вперёд(61)
    счётчик.hit("свежий", ТРИ_В_МИНУТУ)

    assert list(счётчик._hits) == ["свежий"]


def test_сброс_забывает_всё() -> None:
    счётчик = RateLimiter(clock=Часы())
    счётчик.hit("ключ", ТРИ_В_МИНУТУ)

    счётчик.reset()

    assert счётчик._hits == {}


# --- Через HTTP ------------------------------------------------------------


def собрать(**настройки: object) -> FastAPI:
    """Приложение с двумя пробными ручками: предел и собственный адрес.

    Функцией, а не только фикстурой: часть проверок смотрит на поведение
    при ДРУГИХ настройках (доверенные прокси), и двум таким проверкам
    нужна не одна готовая сборка, а возможность собрать свою.
    """
    from grafik_api.api.deps import get_client_ip, rate_limit

    app = create_app(Settings(env="test", **настройки))  # type: ignore[arg-type]

    @app.post(
        "/api/v1/вход-проба", dependencies=[Depends(rate_limit("вход", ТРИ_В_МИНУТУ))]
    )
    async def вход() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/v1/мой-адрес")
    async def мой_адрес(
        адрес: str | None = Depends(get_client_ip),
    ) -> dict[str, str | None]:
        return {"ip": адрес}

    return app


@pytest.fixture
def приложение_с_пределом() -> FastAPI:
    return собрать()


async def test_четвёртая_попытка_отвергается(приложение_с_пределом: FastAPI) -> None:
    transport = httpx.ASGITransport(app=приложение_с_пределом)

    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        ответы = [await client.post("/api/v1/вход-проба") for _ in range(4)]

    assert [ответ.status_code for ответ in ответы] == [200, 200, 200, 429]
    assert ответы[-1].json()["code"] == "rate_limited"
    assert int(ответы[-1].headers["retry-after"]) > 0


async def test_адрес_за_прокси_берётся_из_заголовка(
    приложение_с_пределом: FastAPI,
) -> None:
    """nginx дописывает к заголовку того, кого увидел сам, — он правее всех."""
    transport = httpx.ASGITransport(app=приложение_с_пределом, client=("127.0.0.1", 1))

    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        ответ = await client.get(
            "/api/v1/мой-адрес",
            headers={"X-Forwarded-For": "198.51.100.7, 203.0.113.9"},
        )

    assert ответ.json()["ip"] == "203.0.113.9"


async def test_чужому_заголовку_без_прокси_не_верим(
    приложение_с_пределом: FastAPI,
) -> None:
    """Иначе любой, кто дотянулся напрямую, подставит чужой адрес."""
    transport = httpx.ASGITransport(
        app=приложение_с_пределом, client=("203.0.113.200", 1)
    )

    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        ответ = await client.get(
            "/api/v1/мой-адрес", headers={"X-Forwarded-For": "10.0.0.1"}
        )

    assert ответ.json()["ip"] == "203.0.113.200"


async def test_мусор_в_заголовке_игнорируется(приложение_с_пределом: FastAPI) -> None:
    transport = httpx.ASGITransport(app=приложение_с_пределом, client=("127.0.0.1", 1))

    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        ответ = await client.get(
            "/api/v1/мой-адрес", headers={"X-Forwarded-For": "ne-adres"}
        )

    assert ответ.json()["ip"] == "127.0.0.1"


async def test_доверенному_прокси_верим_и_не_с_петли() -> None:
    """В бою nginx приходит со шлюза docker-сети, а не с петли.

    Без этого доверия в журнал и в счётчик попыток попадал бы один и тот
    же адрес шлюза — то есть попытки всего мира считались бы в одну кучу.
    """
    app = собрать(trusted_proxies="172.28.0.0/24")

    transport = httpx.ASGITransport(app=app, client=("172.28.0.1", 1))

    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        ответ = await client.get(
            "/api/v1/мой-адрес", headers={"X-Forwarded-For": "198.51.100.7"}
        )

    assert ответ.json()["ip"] == "198.51.100.7"


async def test_недоверенному_соседу_из_той_же_сети_не_верим() -> None:
    """Доверие адресное: сосед по сети — ещё не прокси."""
    app = собрать(trusted_proxies="172.28.0.1")

    transport = httpx.ASGITransport(app=app, client=("172.28.0.2", 1))

    async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
        ответ = await client.get(
            "/api/v1/мой-адрес", headers={"X-Forwarded-For": "198.51.100.7"}
        )

    assert ответ.json()["ip"] == "172.28.0.2"


# --- Деление предела между процессами --------------------------------------


def test_предел_делится_между_процессами() -> None:
    """Три попытки на три процесса — по одной каждому, а не по три."""
    счётчик = RateLimiter(clock=Часы(), процессов=3)

    assert счётчик.hit("ключ", ТРИ_В_МИНУТУ) is None
    assert счётчик.hit("ключ", ТРИ_В_МИНУТУ) is not None


def test_доля_не_падает_до_нуля() -> None:
    """Предел в ноль обращений — это не «строже», а «ручка закрыта»."""
    счётчик = RateLimiter(clock=Часы(), процессов=10)

    assert счётчик.hit("ключ", Limit(requests=2, seconds=60)) is None
    assert счётчик.hit("ключ", Limit(requests=2, seconds=60)) is not None


def test_один_процесс_ничего_не_делит() -> None:
    счётчик = RateLimiter(clock=Часы(), процессов=1)

    assert [счётчик.hit("ключ", ТРИ_В_МИНУТУ) for _ in range(3)] == [None] * 3


def test_число_процессов_не_меньше_единицы() -> None:
    """Ноль процессов — это опечатка, и делить на неё нельзя."""
    счётчик = RateLimiter(clock=Часы(), процессов=0)

    assert [счётчик.hit("ключ", ТРИ_В_МИНУТУ) for _ in range(3)] == [None] * 3


def test_опечатка_в_доверенных_прокси_падает_при_старте() -> None:
    """Опечатка в адресе шлюза не должна выясняться в бою.

    А выяснилась бы она в самый неподходящий момент: когда в журнале
    понадобился настоящий адрес клиента.
    """
    with pytest.raises(ValueError, match="GRAFIK_TRUSTED_PROXIES"):
        Settings(env="test", trusted_proxies="почти-адрес")


def test_о_делении_предела_сказано_в_журнале(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Иначе «почему-то 429 на третьей попытке» будет загадкой."""
    with caplog.at_level(logging.WARNING, logger="grafik.api.main"):
        create_app(Settings(env="test", workers=2))

    запись = next(
        запись for запись in caplog.records if запись.name == "grafik.api.main"
    )

    assert запись.__dict__["event"] == "app.limits_split"
    assert запись.__dict__["workers"] == 2
