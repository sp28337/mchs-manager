"""Личный календарь года: `GET`/`PUT` и его влияние на НОРМУ.

--- Зачем эти тесты вообще ---------------------------------------------

Норма периода считается по числу рабочих дней (ст. 104 ТК РФ), то есть
правка одного дня стоит ровно 8 часов. Это единственное место, где
человек своей рукой меняет число, с которым потом пойдёт к начальнику,
поэтому проверяется не «endpoint отвечает 200», а то, что правка ДОШЛА
ДО РАСЧЁТА и изменила его на предсказуемую величину.

Общий производственный календарь тесты намеренно НЕ трогают: он
опубликован и заморожен триггерами, а проверяется здесь как раз слой
поверх него — личные правки. Поэтому дни берутся из года, которого в
общем календаре нет, и `source` у них `default`. Это же и делает тест
устойчивым: он не зависит от того, засеян ли 2026-й.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import create_async_engine
from starlette.testclient import TestClient

from src.composition.settings import get_settings
from src.modules.service_calendar.infrastructure.orm_mapping import start_mappers

BASE = "/api/v1/shift-accounting"

start_mappers()

# Год без общего календаря: 2085 лежит в разрешённом диапазоне
# `ck_calendar_year_range`, но никакой сид его не заполняет. 1 января
# 2085 — понедельник, что делает арифметику ниже проверяемой вручную.
YEAR = 2085


async def _db_reachable() -> bool:
    try:
        engine = create_async_engine(get_settings().database_dsn)
        async with engine.connect():
            pass
        await engine.dispose()
        return True
    except (OperationalError, OSError):
        return False


@pytest.fixture
async def client():  # type: ignore[misc]
    if not await _db_reachable():
        pytest.skip("PostgreSQL not reachable — start it with `make up` first")

    from src.composition.api_app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def profile(client: TestClient) -> dict:  # type: ignore[type-arg]
    resp = client.post(
        f"{BASE}/profiles",
        json={
            "displayName": "Тест",
            "employmentKind": "attested",
            "gender": "male",
            "workingConditions": "normal",
            "northernLocality": False,
            "disabilityGroupIorII": False,
            "guardNumber": 1,
            "firstShiftDate": f"{YEAR}-01-01",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _norm(client: TestClient, profile_id: str, start: date, end: date) -> Decimal:
    resp = client.get(
        f"{BASE}/profiles/{profile_id}/calculation",
        params={"periodStart": start.isoformat(), "periodEnd": end.isoformat()},
    )
    assert resp.status_code == 200, resp.text
    return Decimal(resp.json()["normHours"])


# --------------------------------------------------------------- GET


def test_calendar_returns_every_day_of_the_accounting_year(
    client: TestClient, profile: dict  # type: ignore[type-arg]
) -> None:
    """Сетка отдаётся целиком: размечать календарь по дырявому списку
    человек не станет, а неразмеченный день молча считается рабочим."""
    resp = client.get(f"{BASE}/profiles/{profile['id']}/calendar")
    assert resp.status_code == 200, resp.text
    days = resp.json()

    assert len(days) == 365, "2085 — не високосный"
    assert days[0]["day"] == f"{YEAR}-01-01"
    assert days[-1]["day"] == f"{YEAR}-12-31"


def test_days_absent_from_the_shared_calendar_fall_back_to_the_weekday(
    client: TestClient, profile: dict  # type: ignore[type-arg]
) -> None:
    """Умолчание обязано быть ЯВНЫМ: без него день выпал бы из счёта
    рабочих, занизив норму, — то есть выдумал бы переработку."""
    days = {item["day"]: item for item in client.get(
        f"{BASE}/profiles/{profile['id']}/calendar"
    ).json()}

    monday = days[f"{YEAR}-01-01"]  # 1 января 2085 — понедельник
    saturday = days[f"{YEAR}-01-06"]

    assert monday["dayType"] == "working"
    assert monday["source"] == "default"
    assert saturday["dayType"] == "weekend"
    assert saturday["source"] == "default"


def test_calendar_of_an_unknown_profile_is_404(client: TestClient) -> None:
    resp = client.get(f"{BASE}/profiles/00000000-0000-0000-0000-000000000000/calendar")
    assert resp.status_code == 404, resp.text


# --------------------------------------------------------------- PUT


def test_saved_edits_come_back_marked_as_the_persons_own(
    client: TestClient, profile: dict  # type: ignore[type-arg]
) -> None:
    """`source` разделяет утверждения человека и данные календаря. При
    разборе с начальником это разные по весу утверждения, и стирать
    между ними границу нельзя."""
    resp = client.put(
        f"{BASE}/profiles/{profile['id']}/calendar",
        json={"days": [{"day": f"{YEAR}-03-09", "dayType": "holiday"}]},
    )
    assert resp.status_code == 200, resp.text

    days = {item["day"]: item for item in resp.json()}
    assert days[f"{YEAR}-03-09"] == {
        "day": f"{YEAR}-03-09",
        "dayType": "holiday",
        "source": "override",
    }
    assert days[f"{YEAR}-03-10"]["source"] == "default"


def test_a_second_put_replaces_the_previous_edits_entirely(
    client: TestClient, profile: dict  # type: ignore[type-arg]
) -> None:
    """Иначе снятая человеком отметка осталась бы в базе, и расчёт
    продолжал бы её учитывать — расхождение между тем, что он видит, и
    тем, по чему считают."""
    client.put(
        f"{BASE}/profiles/{profile['id']}/calendar",
        json={"days": [{"day": f"{YEAR}-03-09", "dayType": "holiday"}]},
    )
    resp = client.put(
        f"{BASE}/profiles/{profile['id']}/calendar",
        json={"days": [{"day": f"{YEAR}-04-01", "dayType": "weekend"}]},
    )
    assert resp.status_code == 200, resp.text

    days = {item["day"]: item for item in resp.json()}
    assert days[f"{YEAR}-04-01"]["source"] == "override"
    assert days[f"{YEAR}-03-09"]["source"] == "default", "прежняя правка обязана исчезнуть"


def test_an_empty_put_clears_every_edit(
    client: TestClient, profile: dict  # type: ignore[type-arg]
) -> None:
    client.put(
        f"{BASE}/profiles/{profile['id']}/calendar",
        json={"days": [{"day": f"{YEAR}-03-09", "dayType": "holiday"}]},
    )
    resp = client.put(f"{BASE}/profiles/{profile['id']}/calendar", json={"days": []})
    assert resp.status_code == 200, resp.text

    assert all(item["source"] != "override" for item in resp.json())


def test_the_same_day_named_twice_is_rejected(
    client: TestClient, profile: dict  # type: ignore[type-arg]
) -> None:
    """Вопрос без ответа: какой из двух типов человек считает верным,
    неизвестно. Молча взять последний значило бы решить за него."""
    resp = client.put(
        f"{BASE}/profiles/{profile['id']}/calendar",
        json={
            "days": [
                {"day": f"{YEAR}-03-09", "dayType": "holiday"},
                {"day": f"{YEAR}-03-09", "dayType": "weekend"},
            ]
        },
    )
    # 400, а не 422: схему запроса приложение проверяет до предметных
    # правил, и таков его общий ответ на несоответствие схеме.
    assert resp.status_code == 400, resp.text
    assert "дважды" in resp.json()["detail"]


def test_a_day_outside_the_accounting_year_is_rejected(
    client: TestClient, profile: dict  # type: ignore[type-arg]
) -> None:
    """`GET` отдаёт один год, поэтому правка соседнего года была бы
    невидимой — и при этом влияла бы на расчёт периода, её захватившего.
    Невидимая правка, меняющая число, — худший вид расхождения."""
    resp = client.put(
        f"{BASE}/profiles/{profile['id']}/calendar",
        json={"days": [{"day": f"{YEAR + 1}-03-09", "dayType": "holiday"}]},
    )
    assert resp.status_code == 422, resp.text
    assert str(YEAR) in resp.json()["detail"]


def test_editing_the_calendar_of_an_unknown_profile_is_404(client: TestClient) -> None:
    resp = client.put(
        f"{BASE}/profiles/00000000-0000-0000-0000-000000000000/calendar",
        json={"days": []},
    )
    assert resp.status_code == 404, resp.text


# ------------------------------------------------- правка меняет НОРМУ


def test_marking_a_working_day_non_working_lowers_the_norm_by_eight_hours(
    client: TestClient, profile: dict  # type: ignore[type-arg]
) -> None:
    """Ради этого всё и сделано.

    Восемь часов — это 40-часовая неделя, делённая на пять рабочих дней
    (ст. 104 ТК РФ). Величина проверяется точно, а не «норма
    уменьшилась»: занижение нормы выдумывает переработку так же охотно,
    как завышение её прячет.
    """
    start, end = date(YEAR, 3, 1), date(YEAR, 4, 1)
    before = _norm(client, profile["id"], start, end)

    # 9 марта 2085 — пятница, по умолчанию рабочий день.
    resp = client.put(
        f"{BASE}/profiles/{profile['id']}/calendar",
        json={"days": [{"day": f"{YEAR}-03-09", "dayType": "holiday"}]},
    )
    assert resp.status_code == 200, resp.text

    assert _norm(client, profile["id"], start, end) == before - Decimal("8")


def test_marking_a_weekend_working_raises_the_norm_by_eight_hours(
    client: TestClient, profile: dict  # type: ignore[type-arg]
) -> None:
    """Перенос выходного работает и в эту сторону: Правительство
    объявляет рабочими и субботы, и приложение обязано это принять."""
    start, end = date(YEAR, 3, 1), date(YEAR, 4, 1)
    before = _norm(client, profile["id"], start, end)

    # 10 марта 2085 — суббота, по умолчанию выходной.
    client.put(
        f"{BASE}/profiles/{profile['id']}/calendar",
        json={"days": [{"day": f"{YEAR}-03-10", "dayType": "working"}]},
    )

    assert _norm(client, profile["id"], start, end) == before + Decimal("8")


def test_a_pre_holiday_shortens_the_norm_by_exactly_one_hour(
    client: TestClient, profile: dict  # type: ignore[type-arg]
) -> None:
    """Ст. 95 ТК РФ: предпраздничный день — рабочий, сокращённый на час.
    Он обязан остаться в счёте рабочих, иначе вычиталось бы 8 часов
    вместо одного."""
    start, end = date(YEAR, 3, 1), date(YEAR, 4, 1)
    before = _norm(client, profile["id"], start, end)

    client.put(
        f"{BASE}/profiles/{profile['id']}/calendar",
        json={"days": [{"day": f"{YEAR}-03-09", "dayType": "pre_holiday"}]},
    )

    assert _norm(client, profile["id"], start, end) == before - Decimal("1")


def test_an_edit_outside_the_period_does_not_move_its_norm(
    client: TestClient, profile: dict  # type: ignore[type-arg]
) -> None:
    """Границы периода полуоткрыты; правка в апреле не имеет права
    сдвинуть март.

    Взят именно РАБОЧИЙ день (2 апреля 2085 — понедельник): выходной
    прошёл бы этот тест и при сломанной границе, ничего не проверив.
    """
    start, end = date(YEAR, 3, 1), date(YEAR, 4, 1)
    before = _norm(client, profile["id"], start, end)

    client.put(
        f"{BASE}/profiles/{profile['id']}/calendar",
        json={"days": [{"day": f"{YEAR}-04-02", "dayType": "holiday"}]},
    )

    assert _norm(client, profile["id"], start, end) == before
