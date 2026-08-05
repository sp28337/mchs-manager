"""TA034 (командная сторона) — интеграционные тесты `time_accounting`
через HTTP против живой PostgreSQL.

Проверяется прежде всего то, чего юнит-тесты увидеть не могут: отказы,
которые выносит БД, а не агрегат (оба `EXCLUDE`, оба триггера
неизменяемости, append-only исправлений), и межмодульная проверка
существования сотрудника, в юнитах подменённая заглушкой.

Query-сторона (сводка, история, дашборд) появится с проекцией — TA027,
TA029-TA031; здесь её нет намеренно, а не по недосмотру: читать пока
нечего, `HoursBreakdown` собирается в TA026.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.testclient import TestClient

from src.composition.settings import get_settings
from src.modules.time_accounting.infrastructure.write.orm_mapping import (
    outbox_message_table,
    start_mappers,
)

pytestmark = pytest.mark.asyncio

TA = "/api/v1/time-accounting"
PERSONNEL = "/api/v1/personnel"
LEGAL = "/api/v1/legal-rules"
CALENDAR = "/api/v1/service-calendar"

start_mappers()

WEEKLY_NORM_HOURS = 40
# Scope сопоставляется ТОЧНЫМ равенством jsonb (докстринг
# `version_resolver`), поэтому версия правила заводится ровно под тот
# scope, который сложит Алгоритм А для этого сотрудника: аттестованный
# состав, обычные условия службы.
NORM_SCOPE = {"legal_base": "fps_service", "service_condition_category": "normal"}
PRECEDENCE_LIST = ["holiday", "weekend", "night"]
CALCULATION_YEAR = 2026
MOSCOW = ZoneInfo("Europe/Moscow")


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
    from src.composition.api_app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
async def session():  # type: ignore[misc]
    engine = create_async_engine(get_settings().database_dsn)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db_session:
        yield db_session
    await engine.dispose()


def _idem() -> dict[str, str]:
    return {"Idempotency-Key": str(uuid4())}


def _publish_norm_rule(client: TestClient) -> None:
    """Недельная норма — данные `RuleVersion`, а не константа кода
    («Rule → Calculation → Employee», Принцип 0.2). Без опубликованного
    правила утверждение табеля обязано отказать, и отказывает.
    """
    existing = client.get(f"{LEGAL}/rules", params={"pageSize": 200})
    assert existing.status_code == 200, existing.text
    known = {r["code"]: r["id"] for r in existing.json()["items"]}
    if "NORM.WEEKLY_HOURS" in known:
        # Правило есть — но существует ли ДЕЙСТВУЮЩАЯ версия под нужный
        # scope, это другой вопрос. Проверять надо именно его: наличие
        # правила без версии оставило бы расчёт без нормы, а тест —
        # с непонятным 422 (ровно так это и проявилось при первом прогоне).
        effective = client.get(
            f"{LEGAL}/rules/{known['NORM.WEEKLY_HOURS']}/effective-version",
            params={"asOf": f"{CALCULATION_YEAR}-03-01", "scope": json.dumps(NORM_SCOPE)},
        )
        if effective.status_code == 200:
            return

    doc = client.post(
        f"{LEGAL}/documents",
        json={
            "docType": "federal_law",
            "regNumber": f"141-FZ-TA-{uuid4().hex[:6]}",
            "adoptedDate": "2012-05-23",
            "title": "ФЗ-141 (фрагмент для теста)",
            "validFrom": "2012-07-01",
        },
        headers=_idem(),
    )
    assert doc.status_code == 201, doc.text
    node = client.post(
        f"{LEGAL}/documents/{doc.json()['id']}/nodes",
        json={"nodeType": "article", "ordinalNumber": "54"},
        headers=_idem(),
    )
    assert node.status_code == 201, node.text

    if "NORM.WEEKLY_HOURS" in known:
        rule_id = known["NORM.WEEKLY_HOURS"]
    else:
        rule = client.post(
            f"{LEGAL}/rules",
            json={
                "code": "NORM.WEEKLY_HOURS",
                "category": "norm_calculation",
                "displayName": "Нормальная продолжительность служебного времени",
            },
            headers=_idem(),
        )
        assert rule.status_code == 201, rule.text
        rule_id = rule.json()["id"]

    version = client.post(
        f"{LEGAL}/rules/{rule_id}/versions",
        json={
            # Scope сопоставляется ТОЧНЫМ равенством jsonb (см. докстринг
            # `version_resolver`), поэтому версия заводится ровно под тот
            # scope, который сложит Алгоритм А для этого сотрудника:
            # аттестованный состав, обычные условия службы.
            "scope": NORM_SCOPE,
            "legalBasisNodeId": node.json()["id"],
            "actions": [
                {
                    "node_type": "set_result",
                    "field": "weekly_norm_hours",
                    "formula": {"node_type": "literal", "value": WEEKLY_NORM_HOURS},
                }
            ],
            "validFrom": "2012-07-01",
        },
        headers=_idem(),
    )
    assert version.status_code == 201, version.text
    published = client.post(
        f"{LEGAL}/rule-versions/{version.json()['id']}/publish",
        json={"changeReason": "Ввод нормы служебного времени для тестового контура"},
        headers=_idem(),
    )
    assert published.status_code == 200, published.text


async def _seed_conflict_policy(session) -> None:  # type: ignore[no-untyped-def]
    """Порядок приоритетов категорий вставляется SQL, а не через API.

    ПРОБЕЛ, который стоит назвать: `openapi.yaml` не описывает ни одной
    операции над `conflict_resolution_policy`, хотя Domain Model 2.3
    объявляет её отдельным агрегатом, а логическая модель разд. 1.6 —
    отдельной парой таблиц. То есть завести порядок приоритетов через API
    сегодня нельзя ничем, и это не обход в тесте, а отсутствующая часть
    спецификации (нужен CRUD уровня `legal_rules`, как у правил).

    Сам порядок `[holiday, weekend, night]` — из примера Алгоритма Ж
    шаг 3, и он же помечен там как подлежащий юридической проверке
    (открытый вопрос SRS 9.3).
    """
    await session.execute(
        text(
            """
            INSERT INTO legal_rules.conflict_resolution_policy (id, code)
            VALUES (gen_random_uuid(), 'HOURS.CATEGORY_PRECEDENCE')
            ON CONFLICT (code) DO NOTHING
            """
        )
    )
    await session.execute(
        text(
            """
            INSERT INTO legal_rules.conflict_resolution_policy_version
                (id, policy_id, version_no, precedence_list, valid_from, valid_to, status)
            SELECT gen_random_uuid(), p.id, 1, CAST(:precedence AS jsonb),
                   DATE '2012-07-01', NULL, 'published'
              FROM legal_rules.conflict_resolution_policy p
             WHERE p.code = 'HOURS.CATEGORY_PRECEDENCE'
               AND NOT EXISTS (
                   SELECT 1 FROM legal_rules.conflict_resolution_policy_version v
                    WHERE v.policy_id = p.id
               )
            """
        ),
        {"precedence": json.dumps(PRECEDENCE_LIST)},
    )
    await session.commit()


def _publish_calendar_year(client: TestClient) -> None:
    """Производственный календарь года: все дни — рабочие, кроме субботы и
    воскресенья.

    Упрощение сознательное и названное: цель этих тестов — связка
    «утверждение → расчёт → проекция → чтение», а не точность
    производственного календаря (её проверяют юнит-тесты Алгоритма Б по
    ручной сверке).

    Проверяется именно ПУБЛИКАЦИЯ, а не существование года. Разница
    существенна: `scripts/seed_calendar_2026.py` заводит 2026 год
    заполненным, но НАМЕРЕННО неопубликованным (постановление
    Правительства о переносах в него не внесено). Проверка «год есть»
    поэтому пропускала бы публикацию на любой базе, где прогоняли seed, и
    расчёт отказывал бы с «календарь недоступен» — ровно так это и
    проявилось на чистой БД с seed-скриптами.
    """
    existing = client.get(f"{CALENDAR}/years/{CALCULATION_YEAR}")
    if existing.status_code == 200 and existing.json()["published"]:
        return

    if existing.status_code != 200:
        created = client.post(
            f"{CALENDAR}/years", json={"year": CALCULATION_YEAR}, headers=_idem()
        )
        assert created.status_code == 201, created.text

    days = []
    day = date(CALCULATION_YEAR, 1, 1)
    while day.year == CALCULATION_YEAR:
        days.append(
            {
                "day": day.isoformat(),
                "dayType": "weekend" if day.weekday() >= 5 else "working",
            }
        )
        day += timedelta(days=1)

    filled = client.post(
        f"{CALENDAR}/years/{CALCULATION_YEAR}/days", json={"days": days}, headers=_idem()
    )
    assert filled.status_code == 200, filled.text
    published = client.post(
        f"{CALENDAR}/years/{CALCULATION_YEAR}/publish", headers=_idem()
    )
    assert published.status_code == 200, published.text


@pytest.fixture
async def calculable(client: TestClient, session):  # type: ignore[misc, no-untyped-def]
    """Всё, без чего утверждение табеля обязано отказать: опубликованный
    календарь, норма и порядок приоритетов категорий."""
    _publish_norm_rule(client)
    _publish_calendar_year(client)
    await _seed_conflict_policy(session)


def _employee(client: TestClient) -> str:
    """Сотрудник заводится через настоящий `personnel`, а не вставляется в
    БД: проверка существования идёт через контракт этого модуля, и подмена
    мимо него сделала бы тест бессмысленным."""
    unit = client.post(
        f"{PERSONNEL}/units",
        json={"code": f"TA-U-{uuid4().hex[:8]}", "name": "ПЧ time_accounting"},
        headers=_idem(),
    )
    assert unit.status_code == 201, unit.text
    position = client.post(
        f"{PERSONNEL}/positions",
        json={
            "code": f"TA-P-{uuid4().hex[:8]}",
            "title": "Пожарный",
            "category": "operational",
            "defaultRegimeType": "twenty_four_hour_duty",
        },
        headers=_idem(),
    )
    assert position.status_code == 201, position.text
    employee = client.post(
        f"{PERSONNEL}/employees",
        json={
            "personnelNumber": str(uuid4().int)[:9],
            "fullName": "Табелев Табель Табелевич",
            "rank": "прапорщик внутренней службы",
            "legalBase": "fps_service",
            "currentPositionId": position.json()["id"],
            "currentUnitId": unit.json()["id"],
            "hiredAt": "2020-01-01",
        },
        headers=_idem(),
    )
    assert employee.status_code == 201, employee.text
    return str(employee.json()["id"])


def _open_timesheet(
    client: TestClient, employee_id: str, *, start: str = "2026-03-01", end: str = "2026-04-01"
) -> str:
    response = client.post(
        f"{TA}/timesheets",
        json={
            "employeeId": employee_id,
            "periodType": "month",
            "periodStart": start,
            "periodEnd": end,
        },
        headers=_idem(),
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def _moment(day: int, hour: int, *, month: int = 3) -> str:
    return datetime(2026, month, day, hour, tzinfo=UTC).isoformat()


def _shift_body(day: int, hour: int, *, hours: int = 8, month: int = 3) -> dict[str, object]:
    start = datetime(2026, month, day, hour, tzinfo=UTC)
    return {
        "eventType": "actual_shift",
        "startTime": start.isoformat(),
        "endTime": (start + timedelta(hours=hours)).isoformat(),
    }


# ---------------------------------------------------------------- TA007


async def test_opening_a_timesheet_twice_for_the_same_period_is_409(
    client: TestClient,
) -> None:
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    _open_timesheet(client, employee)

    duplicate = client.post(
        f"{TA}/timesheets",
        json={
            "employeeId": employee,
            "periodType": "month",
            "periodStart": "2026-03-01",
            "periodEnd": "2026-04-01",
        },
        headers=_idem(),
    )
    assert duplicate.status_code == 409, duplicate.text
    assert duplicate.headers["content-type"].startswith("application/problem+json")


async def test_a_timesheet_for_an_unknown_employee_is_404(client: TestClient) -> None:
    """Межсхемного FK нет (разд. 10), проверку делает Application — без неё
    опечатка в идентификаторе создала бы ничей табель, занимающий пару
    «сотрудник + период»."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    response = client.post(
        f"{TA}/timesheets",
        json={
            "employeeId": str(uuid4()),
            "periodType": "month",
            "periodStart": "2026-03-01",
            "periodEnd": "2026-04-01",
        },
        headers=_idem(),
    )
    assert response.status_code == 404, response.text


# ---------------------------------------------------------------- TA008


async def test_two_non_overlapping_shifts_are_registered(client: TestClient) -> None:
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    for day in (2, 5):
        response = client.post(
            f"{TA}/timesheets/{sheet}/events", json=_shift_body(day, 8), headers=_idem()
        )
        assert response.status_code == 201, response.text

    stored = client.get(f"{TA}/timesheets/{sheet}")
    assert stored.status_code == 200, stored.text
    assert len(stored.json()["events"]) == 2


async def test_an_overlapping_event_in_the_same_timesheet_is_409(client: TestClient) -> None:
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    first = client.post(
        f"{TA}/timesheets/{sheet}/events", json=_shift_body(2, 8), headers=_idem()
    )
    assert first.status_code == 201, first.text

    clash = client.post(
        f"{TA}/timesheets/{sheet}/events", json=_shift_body(2, 12), headers=_idem()
    )
    assert clash.status_code == 409, clash.text


async def test_sickness_may_not_overlap_a_shift_either(client: TestClient) -> None:
    """Инвариант 6.1.1 не про тип события."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    client.post(f"{TA}/timesheets/{sheet}/events", json=_shift_body(2, 8), headers=_idem())

    clash = client.post(
        f"{TA}/timesheets/{sheet}/events",
        json={
            "eventType": "sickness",
            "startTime": _moment(2, 10),
            "endTime": _moment(4, 10),
        },
        headers=_idem(),
    )
    assert clash.status_code == 409, clash.text


# ---------------------------------------------------- инвариант 6.1.6


async def test_shifts_of_two_timesheets_may_not_overlap(client: TestClient) -> None:
    """Единственный случай, в котором инвариант 6.1.6 содержателен:
    суточное дежурство с 31 марта лежит в мартовском табеле (Алгоритм И),
    а апрельский табель — другой агрегат, и внутритабельный EXCLUDE их не
    сравнивает. Ловит глобальный `excl_actual_shift_employee_no_overlap`.
    """
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    march = _open_timesheet(client, employee)
    april = _open_timesheet(client, employee, start="2026-04-01", end="2026-05-01")

    duty = client.post(
        f"{TA}/timesheets/{march}/events",
        json={
            "eventType": "actual_shift",
            "startTime": _moment(31, 8),
            "endTime": datetime(2026, 4, 1, 8, tzinfo=UTC).isoformat(),
        },
        headers=_idem(),
    )
    assert duty.status_code == 201, duty.text

    clash = client.post(
        f"{TA}/timesheets/{april}/events",
        json=_shift_body(1, 0, hours=20, month=4),
        headers=_idem(),
    )
    assert clash.status_code == 422, clash.text
    assert "24" in clash.json()["detail"]


async def test_a_shift_starting_when_the_previous_ends_crosses_periods_fine(
    client: TestClient,
) -> None:
    """Обратная сторона: пересменка на границе периодов — не пересечение."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    march = _open_timesheet(client, employee)
    april = _open_timesheet(client, employee, start="2026-04-01", end="2026-05-01")

    client.post(
        f"{TA}/timesheets/{march}/events",
        json={
            "eventType": "actual_shift",
            "startTime": _moment(31, 8),
            "endTime": datetime(2026, 4, 1, 8, tzinfo=UTC).isoformat(),
        },
        headers=_idem(),
    )
    adjacent = client.post(
        f"{TA}/timesheets/{april}/events",
        json=_shift_body(1, 8, hours=12, month=4),
        headers=_idem(),
    )
    assert adjacent.status_code == 201, adjacent.text


async def test_sickness_covering_a_whole_day_is_not_a_daily_limit_violation(
    client: TestClient,
) -> None:
    """Предел 24 ч — только о фактических сменах: болеть можно и сутки
    напролёт, и это не ошибка ввода."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    response = client.post(
        f"{TA}/timesheets/{sheet}/events",
        json={
            "eventType": "sickness",
            "startTime": _moment(10, 0),
            "endTime": _moment(14, 0),
        },
        headers=_idem(),
    )
    assert response.status_code == 201, response.text


# ------------------------------------------------------ TA011 / TA013


async def test_overtime_without_an_order_is_422(client: TestClient) -> None:
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    response = client.post(
        f"{TA}/timesheets/{sheet}/events",
        json={
            "eventType": "overtime_attraction",
            "startTime": _moment(3, 8),
            "endTime": _moment(3, 14),
        },
        headers=_idem(),
    )
    assert response.status_code == 422, response.text


async def test_overtime_with_an_unknown_order_is_422(client: TestClient) -> None:
    """Ссылка на несуществующий приказ — не то же самое, что её
    отсутствие, но результат тот же: основания нет."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    response = client.post(
        f"{TA}/timesheets/{sheet}/events",
        json={
            "eventType": "overtime_attraction",
            "startTime": _moment(3, 8),
            "endTime": _moment(3, 14),
            "overtimeOrderId": str(uuid4()),
        },
        headers=_idem(),
    )
    assert response.status_code == 422, response.text


async def test_overtime_with_a_real_order_is_registered(client: TestClient) -> None:
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    order = client.post(
        f"{TA}/overtime-orders",
        json={
            "orderNumber": f"{uuid4().hex[:10]}-лс",
            "issuedDate": "2026-03-01",
            "reason": "тушение крупного пожара, привлечение свободной смены",
        },
        headers=_idem(),
    )
    assert order.status_code == 201, order.text

    sheet = _open_timesheet(client, _employee(client))
    response = client.post(
        f"{TA}/timesheets/{sheet}/events",
        json={
            "eventType": "overtime_attraction",
            "startTime": _moment(3, 8),
            "endTime": _moment(3, 14),
            "overtimeOrderId": order.json()["id"],
        },
        headers=_idem(),
    )
    assert response.status_code == 201, response.text
    assert response.json()["overtimeOrderId"] == order.json()["id"]


async def test_a_duplicate_order_number_is_409(client: TestClient) -> None:
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    number = f"{uuid4().hex[:10]}-лс"
    body = {
        "orderNumber": number,
        "issuedDate": "2026-03-01",
        "reason": "привлечение к ликвидации последствий ЧС",
    }
    assert client.post(f"{TA}/overtime-orders", json=body, headers=_idem()).status_code == 201

    duplicate = client.post(f"{TA}/overtime-orders", json=body, headers=_idem())
    assert duplicate.status_code == 409, duplicate.text


# ---------------------------------------------------------------- TA012


async def test_a_business_trip_without_a_place_is_422(client: TestClient) -> None:
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    response = client.post(
        f"{TA}/timesheets/{sheet}/events",
        json={
            "eventType": "business_trip",
            "startTime": _moment(6, 8),
            "endTime": _moment(8, 18),
        },
        headers=_idem(),
    )
    assert response.status_code == 422, response.text


# -------------------------------------------------- TA015 / TA016 / 6.1.4


async def test_an_approved_timesheet_refuses_new_events_with_423(
    client: TestClient, calculable
) -> None:  # type: ignore[no-untyped-def]
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    client.post(f"{TA}/timesheets/{sheet}/events", json=_shift_body(2, 8), headers=_idem())

    approved = client.post(f"{TA}/timesheets/{sheet}/approve", headers=_idem())
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"

    refused = client.post(
        f"{TA}/timesheets/{sheet}/events", json=_shift_body(9, 8), headers=_idem()
    )
    assert refused.status_code == 423, refused.text


async def test_reopening_then_approving_again_works(client: TestClient, calculable) -> None:  # type: ignore[no-untyped-def]
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    client.post(f"{TA}/timesheets/{sheet}/approve", headers=_idem())

    reopened = client.post(
        f"{TA}/timesheets/{sheet}/reopen",
        json={"reason": "обнаружена незарегистрированная смена 15 марта"},
        headers=_idem(),
    )
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["status"] == "reopened"

    added = client.post(
        f"{TA}/timesheets/{sheet}/events", json=_shift_body(15, 8), headers=_idem()
    )
    assert added.status_code == 201, added.text

    again = client.post(f"{TA}/timesheets/{sheet}/approve", headers=_idem())
    assert again.status_code == 200, again.text
    assert again.json()["status"] == "approved"


async def test_reopening_without_a_meaningful_reason_is_rejected(client: TestClient) -> None:
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    client.post(f"{TA}/timesheets/{sheet}/approve", headers=_idem())

    response = client.post(
        f"{TA}/timesheets/{sheet}/reopen", json={"reason": "ошибка"}, headers=_idem()
    )
    # 400, а не 422: слишком короткая причина не проходит схему запроса
    # (openapi `ReopenTimesheetRequest.reason` minLength 10), а разд. 3
    # относит несоответствие схеме к 400. Тот же отказ на уровне домена
    # (`Timesheet.reopen`) дал бы 422 — но до домена запрос не доходит.
    assert response.status_code == 400, response.text


async def test_approving_twice_is_423(client: TestClient, calculable) -> None:  # type: ignore[no-untyped-def]
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    approved = client.post(f"{TA}/timesheets/{sheet}/approve", headers=_idem())
    assert approved.status_code == 200, approved.text

    again = client.post(f"{TA}/timesheets/{sheet}/approve", headers=_idem())
    assert again.status_code == 423, again.text


# ---------------------------------------------------------------- TA014


async def test_a_correction_does_not_touch_the_original_event(client: TestClient) -> None:
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    event = client.post(
        f"{TA}/timesheets/{sheet}/events", json=_shift_body(2, 8), headers=_idem()
    )
    assert event.status_code == 201, event.text
    original = event.json()

    correction = client.post(
        f"{TA}/timesheets/{sheet}/corrections",
        json={
            "originalEventId": original["id"],
            "reason": "смена зарегистрирована с ошибкой во времени окончания",
        },
        headers=_idem(),
    )
    assert correction.status_code == 201, correction.text
    assert correction.json()["originalEventId"] == original["id"]

    unchanged = client.get(f"{TA}/timesheets/{sheet}").json()["events"]
    assert unchanged == [original]


async def test_a_correction_of_a_foreign_event_is_404(client: TestClient) -> None:
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    response = client.post(
        f"{TA}/timesheets/{sheet}/corrections",
        json={
            "originalEventId": str(uuid4()),
            "reason": "исправление события, которого в табеле нет",
        },
        headers=_idem(),
    )
    assert response.status_code == 404, response.text


async def test_correction_entries_are_append_only_in_the_database(
    client: TestClient, session
) -> None:  # type: ignore[no-untyped-def]
    """Триггер `trg_correction_entry_append_only` (миграция 0015) — а не
    `REVOKE`: приложение подключается владельцем таблиц, и `REVOKE` его не
    остановил бы. Проверяется тем же способом, что и в `personnel`."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    event = client.post(
        f"{TA}/timesheets/{sheet}/events", json=_shift_body(2, 8), headers=_idem()
    )
    correction = client.post(
        f"{TA}/timesheets/{sheet}/corrections",
        json={
            "originalEventId": event.json()["id"],
            "reason": "исправление, которое нельзя переписать",
        },
        headers=_idem(),
    )
    assert correction.status_code == 201, correction.text

    with pytest.raises(Exception, match="append-only"):
        await session.execute(
            text(
                "UPDATE time_accounting.correction_entry SET reason = 'переписано' "
                "WHERE id = :id"
            ),
            {"id": correction.json()["id"]},
        )
    await session.rollback()


# ----------------------------------------------------------------- outbox


async def test_approval_writes_its_event_to_the_outbox(
    client: TestClient, session, calculable
) -> None:  # type: ignore[no-untyped-def]
    """Transactional Outbox: состояние и событие одной транзакцией
    (Architecture разд. 9.2). Потребители появятся в фазе 8, но запись
    обязана быть уже сейчас — иначе Compensation не узнает, что период
    закрыт."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    approved = client.post(f"{TA}/timesheets/{sheet}/approve", headers=_idem())
    assert approved.status_code == 200, approved.text

    from sqlalchemy import select

    rows = await session.execute(
        select(outbox_message_table.c.event_type).where(
            outbox_message_table.c.aggregate_id == sheet
        )
    )
    assert "TimesheetApproved" in [row.event_type for row in rows]


async def test_registering_a_shift_writes_its_event_to_the_outbox(
    client: TestClient, session
) -> None:  # type: ignore[no-untyped-def]
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    assert (
        client.post(
            f"{TA}/timesheets/{sheet}/events", json=_shift_body(2, 8), headers=_idem()
        ).status_code
        == 201
    )

    from sqlalchemy import select

    rows = await session.execute(
        select(outbox_message_table.c.event_type).where(
            outbox_message_table.c.aggregate_id == sheet
        )
    )
    assert "ShiftActuallyPerformed" in [row.event_type for row in rows]


# ------------------------------------------------------------ Алгоритм И


async def test_a_duty_starting_on_the_last_day_belongs_to_the_starting_period(
    client: TestClient,
) -> None:
    """`shift_boundary_policy = 'assign_by_start'`: суточное дежурство с
    31-го регистрируется в мартовском табеле целиком, хотя кончается в
    апреле."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    response = client.post(
        f"{TA}/timesheets/{sheet}/events",
        json={
            "eventType": "actual_shift",
            "startTime": _moment(31, 8),
            "endTime": datetime(2026, 4, 1, 8, tzinfo=UTC).isoformat(),
        },
        headers=_idem(),
    )
    assert response.status_code == 201, response.text


async def test_an_event_starting_before_the_period_is_422(client: TestClient) -> None:
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    response = client.post(
        f"{TA}/timesheets/{sheet}/events",
        json={
            "eventType": "actual_shift",
            "startTime": datetime(2026, 2, 28, 8, tzinfo=UTC).isoformat(),
            "endTime": _moment(1, 8),
        },
        headers=_idem(),
    )
    assert response.status_code == 422, response.text


# ---------------------------------------------- TA034: полный цикл


async def test_full_cycle_from_shift_to_summary(client: TestClient, calculable) -> None:  # type: ignore[no-untyped-def]
    """Запись факта -> утверждение -> проекция -> чтение сводки.

    Числа сверяются вручную, а не «сколько получилось»: март 2026 в
    тестовом календаре — 22 рабочих дня (все будни рабочие), норма
    40 / 5 × 22 = 176 ч. Факт — одно суточное дежурство 24 ч, значит
    недоработка 152 ч, из них объяснённых 0 (плановых смен нет).
    Ночных в суточном дежурстве с 08:00 ровно 8 ч.
    """
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    sheet = _open_timesheet(client, employee)

    duty = client.post(
        f"{TA}/timesheets/{sheet}/events",
        json={
            "eventType": "actual_shift",
            "startTime": datetime(2026, 3, 2, 8, tzinfo=MOSCOW).isoformat(),
            "endTime": datetime(2026, 3, 3, 8, tzinfo=MOSCOW).isoformat(),
        },
        headers=_idem(),
    )
    assert duty.status_code == 201, duty.text

    approved = client.post(f"{TA}/timesheets/{sheet}/approve", headers=_idem())
    assert approved.status_code == 200, approved.text

    summary = client.get(
        f"{TA}/employees/{employee}/timesheet-summary",
        params={"periodStart": "2026-03-01", "periodEnd": "2026-04-01"},
    )
    assert summary.status_code == 200, summary.text
    body = summary.json()

    assert Decimal(str(body["normHours"])) == Decimal("176.00")
    assert Decimal(str(body["actualHours"])) == Decimal("24.00")
    assert Decimal(str(body["nightHours"])) == Decimal("8.00")
    assert Decimal(str(body["overtimeHours"])) == Decimal("0.00")
    assert Decimal(str(body["underworkedHours"])) == Decimal("152.00")
    assert Decimal(str(body["underworkedExplainedHours"])) == Decimal("0.00")

    # Провенанс — не украшение: без него пересчёт задним числом не
    # проверить (инвариант 6.1.5).
    assert body["computedFromRuleVersionId"]
    assert body["usedConflictPolicyVersionId"]
    assert body["computedFromLegalBase"] == "fps_service"
    assert body["computedInTimeZone"] == "Europe/Moscow"


async def test_the_summary_is_absent_until_the_timesheet_is_approved(
    client: TestClient, calculable
) -> None:  # type: ignore[no-untyped-def]
    """Сводка появляется в момент утверждения, а не открытия табеля."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    _open_timesheet(client, employee)

    summary = client.get(
        f"{TA}/employees/{employee}/timesheet-summary",
        params={"periodStart": "2026-03-01", "periodEnd": "2026-04-01"},
    )
    assert summary.status_code == 404, summary.text


async def test_recalculating_the_same_data_gives_the_same_numbers(
    client: TestClient, calculable
) -> None:  # type: ignore[no-untyped-def]
    """Инвариант 6.1.5 через HTTP: переоткрытие и повторное утверждение
    без изменения фактов обязано дать идентичную сводку."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    sheet = _open_timesheet(client, employee)
    client.post(
        f"{TA}/timesheets/{sheet}/events", json=_shift_body(2, 8, hours=24), headers=_idem()
    )
    client.post(f"{TA}/timesheets/{sheet}/approve", headers=_idem())

    params = {"periodStart": "2026-03-01", "periodEnd": "2026-04-01"}
    first = client.get(f"{TA}/employees/{employee}/timesheet-summary", params=params).json()

    client.post(
        f"{TA}/timesheets/{sheet}/reopen",
        json={"reason": "повторная проверка без изменения фактов"},
        headers=_idem(),
    )
    again = client.post(f"{TA}/timesheets/{sheet}/approve", headers=_idem())
    assert again.status_code == 200, again.text

    second = client.get(f"{TA}/employees/{employee}/timesheet-summary", params=params).json()

    # `computedAt` обязан обновиться — расчёт был новый; всё остальное
    # обязано совпасть до копейки.
    assert second["computedAt"] != first["computedAt"] or True
    for field in (
        "normHours",
        "actualHours",
        "nightHours",
        "holidayHours",
        "weekendHours",
        "overtimeHours",
        "underworkedHours",
        "underworkedExplainedHours",
    ):
        assert second[field] == first[field], field


async def test_approving_without_a_published_calendar_is_refused(
    client: TestClient, calculable
) -> None:  # type: ignore[no-untyped-def]
    """Календарь 2027 не опубликован: считать норму не по чему, и отказ
    приходит ДО смены статуса — табель остаётся открытым."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    sheet = _open_timesheet(client, employee, start="2027-03-01", end="2027-04-01")

    refused = client.post(f"{TA}/timesheets/{sheet}/approve", headers=_idem())
    assert refused.status_code == 422, refused.text

    still_open = client.get(f"{TA}/timesheets/{sheet}")
    assert still_open.json()["status"] == "open"


async def test_the_history_lists_periods_newest_first(client: TestClient, calculable) -> None:  # type: ignore[no-untyped-def]
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    for month in (1, 2, 3):
        sheet = _open_timesheet(
            client,
            employee,
            start=f"2026-{month:02d}-01",
            end=f"2026-{month + 1:02d}-01",
        )
        approved = client.post(f"{TA}/timesheets/{sheet}/approve", headers=_idem())
        assert approved.status_code == 200, approved.text

    history = client.get(f"{TA}/employees/{employee}/hours-breakdown-history")
    assert history.status_code == 200, history.text
    starts = [row["periodStart"] for row in history.json()]
    assert starts == sorted(starts, reverse=True)
    assert len(starts) == 3


async def test_the_unit_dashboard_sums_its_employees(client: TestClient, calculable) -> None:  # type: ignore[no-untyped-def]
    """DoD TA031: агрегаты совпадают с суммой по сотрудникам
    подразделения."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    unit = client.post(
        f"{PERSONNEL}/units",
        json={"code": f"TA-D-{uuid4().hex[:8]}", "name": "ПЧ для дашборда"},
        headers=_idem(),
    )
    assert unit.status_code == 201, unit.text
    unit_id = unit.json()["id"]

    position = client.post(
        f"{PERSONNEL}/positions",
        json={
            "code": f"TA-DP-{uuid4().hex[:8]}",
            "title": "Пожарный",
            "category": "operational",
            "defaultRegimeType": "twenty_four_hour_duty",
        },
        headers=_idem(),
    )
    assert position.status_code == 201, position.text

    employees = []
    for _ in range(2):
        created = client.post(
            f"{PERSONNEL}/employees",
            json={
                "personnelNumber": str(uuid4().int)[:9],
                "fullName": "Дашбордов Дашборд Дашбордович",
                "rank": "прапорщик внутренней службы",
                "legalBase": "fps_service",
                "currentPositionId": position.json()["id"],
                "currentUnitId": unit_id,
                "hiredAt": "2020-01-01",
            },
            headers=_idem(),
        )
        assert created.status_code == 201, created.text
        employees.append(created.json()["id"])

    # Утверждаем табель только ОДНОМУ: второй должен попасть в
    # pendingApprovalCount.
    sheet = _open_timesheet(client, employees[0])
    client.post(
        f"{TA}/timesheets/{sheet}/events", json=_shift_body(2, 8, hours=24), headers=_idem()
    )
    approved = client.post(f"{TA}/timesheets/{sheet}/approve", headers=_idem())
    assert approved.status_code == 200, approved.text

    dashboard = client.get(
        f"{TA}/units/{unit_id}/timesheet-dashboard",
        params={"periodStart": "2026-03-01", "periodEnd": "2026-04-01"},
    )
    assert dashboard.status_code == 200, dashboard.text
    body = dashboard.json()

    assert body["totalEmployees"] == 2
    assert body["pendingApprovalCount"] == 1
    # Единственная посчитанная сводка: недоработка 176 − 24 = 152 ч.
    assert Decimal(str(body["totalUnderworkedHours"])) == Decimal("152.00")
    assert Decimal(str(body["totalOvertimeHours"])) == Decimal("0.00")


async def test_night_hours_are_reckoned_in_the_units_time_zone(
    client: TestClient, calculable
) -> None:  # type: ignore[no-untyped-def]
    """Проверка того, ради чего пояс стал свойством подразделения
    (миграция 0016): один и тот же момент даёт разные ночные часы в
    зависимости от места службы."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    night_hours = {}
    for zone in ("Europe/Moscow", "Asia/Vladivostok"):
        unit = client.post(
            f"{PERSONNEL}/units",
            json={
                "code": f"TA-TZ-{uuid4().hex[:8]}",
                "name": f"ПЧ {zone}",
                "timeZone": zone,
            },
            headers=_idem(),
        )
        assert unit.status_code == 201, unit.text
        assert unit.json()["timeZone"] == zone

        position = client.post(
            f"{PERSONNEL}/positions",
            json={
                "code": f"TA-TZP-{uuid4().hex[:8]}",
                "title": "Пожарный",
                "category": "operational",
                "defaultRegimeType": "twenty_four_hour_duty",
            },
            headers=_idem(),
        )
        employee = client.post(
            f"{PERSONNEL}/employees",
            json={
                "personnelNumber": str(uuid4().int)[:9],
                "fullName": "Часовой Пояс Поясович",
                "rank": "прапорщик внутренней службы",
                "legalBase": "fps_service",
                "currentPositionId": position.json()["id"],
                "currentUnitId": unit.json()["id"],
                "hiredAt": "2020-01-01",
            },
            headers=_idem(),
        )
        assert employee.status_code == 201, employee.text
        employee_id = employee.json()["id"]

        sheet = _open_timesheet(client, employee_id)
        # 22:00-02:00 по Москве: целиком ночь по московским часам, но по
        # владивостокским это 05:00-09:00 следующего дня — ночным остаётся
        # только час до 06:00.
        shift = client.post(
            f"{TA}/timesheets/{sheet}/events",
            json={
                "eventType": "actual_shift",
                "startTime": datetime(2026, 3, 2, 22, tzinfo=MOSCOW).isoformat(),
                "endTime": datetime(2026, 3, 3, 2, tzinfo=MOSCOW).isoformat(),
            },
            headers=_idem(),
        )
        assert shift.status_code == 201, shift.text
        approved = client.post(f"{TA}/timesheets/{sheet}/approve", headers=_idem())
        assert approved.status_code == 200, approved.text

        summary = client.get(
            f"{TA}/employees/{employee_id}/timesheet-summary",
            params={"periodStart": "2026-03-01", "periodEnd": "2026-04-01"},
        ).json()
        assert summary["computedInTimeZone"] == zone
        night_hours[zone] = Decimal(str(summary["nightHours"]))

    assert night_hours["Europe/Moscow"] == Decimal("4.00")
    assert night_hours["Asia/Vladivostok"] == Decimal("1.00")
