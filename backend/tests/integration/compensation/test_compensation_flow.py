"""CO018 — интеграционные тесты `compensation` через HTTP против живой
PostgreSQL.

Проверяется цепочка целиком: утверждение табеля в `time_accounting` →
заведение дела → волеизъявление сотрудника → финализация → событие в
outbox. Ни один шаг не подменяется: дело заводится по НАСТОЯЩЕМУ
утверждённому расчёту, а правила компенсации — по настоящим версиям
правил, заведённым через API `legal_rules`.

Асинхронное порождение дела из события `TimesheetApproved` (CO010/CO011)
здесь не проверяется: релея outbox не существует (F013), и подписчика у
события пока нет. Дело заводится вызовом API — тем же, который потом
будет дёргать Celery-задача.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.testclient import TestClient

from src.composition.settings import get_settings
from src.modules.compensation.infrastructure.orm_mapping import (
    outbox_message_table,
    start_mappers,
)

pytestmark = pytest.mark.asyncio

COMP = "/api/v1/compensation"
TA = "/api/v1/time-accounting"
PERSONNEL = "/api/v1/personnel"
LEGAL = "/api/v1/legal-rules"
CALENDAR = "/api/v1/service-calendar"

start_mappers()

MOSCOW = ZoneInfo("Europe/Moscow")
CALCULATION_YEAR = 2026
WEEKLY_NORM_HOURS = 40
NORM_SCOPE = {
    "legal_base": "fps_service",
    "service_condition_category": "normal",
    "position_category": "operational",
}
PRECEDENCE_LIST = ["holiday", "weekend", "night"]
POLICY_CODE = "HOURS.CATEGORY_PRECEDENCE"
COEFFICIENT_RULE_CODE = "COMPENSATION.COEFFICIENT"


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


def _rule_ids(client: TestClient) -> dict[str, str]:
    listing = client.get(f"{LEGAL}/rules", params={"pageSize": 200})
    assert listing.status_code == 200, listing.text
    return {r["code"]: r["id"] for r in listing.json()["items"]}


def _legal_basis_node(client: TestClient) -> str:
    doc = client.post(
        f"{LEGAL}/documents",
        json={
            "docType": "departmental_order",
            "regNumber": f"410-CO-{uuid4().hex[:6]}",
            "adoptedDate": "2018-09-24",
            "title": "Приказ МЧС России № 410 (фрагмент для теста)",
            "validFrom": "2018-10-01",
        },
        headers=_idem(),
    )
    assert doc.status_code == 201, doc.text
    node = client.post(
        f"{LEGAL}/documents/{doc.json()['id']}/nodes",
        json={"nodeType": "paragraph", "ordinalNumber": "5"},
        headers=_idem(),
    )
    assert node.status_code == 201, node.text
    return str(node.json()["id"])


def _publish_norm_rule(client: TestClient) -> None:
    known = _rule_ids(client)
    if "NORM.WEEKLY_HOURS" in known:
        effective = client.get(
            f"{LEGAL}/rules/{known['NORM.WEEKLY_HOURS']}/effective-version",
            params={"asOf": f"{CALCULATION_YEAR}-03-01", "scope": json.dumps(NORM_SCOPE)},
        )
        if effective.status_code == 200:
            return
        rule_id = known["NORM.WEEKLY_HOURS"]
    else:
        created = client.post(
            f"{LEGAL}/rules",
            json={
                "code": "NORM.WEEKLY_HOURS",
                "category": "norm_calculation",
                "displayName": "Нормальная продолжительность служебного времени",
            },
            headers=_idem(),
        )
        assert created.status_code == 201, created.text
        rule_id = created.json()["id"]

    version = client.post(
        f"{LEGAL}/rules/{rule_id}/versions",
        json={
            "scope": NORM_SCOPE,
            "legalBasisNodeId": _legal_basis_node(client),
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


def _publish_compensation_rule(
    client: TestClient, *, hour_category: str, default_form: str, election_allowed: bool
) -> None:
    """Правило компенсации для одной категории часов.

    Форма по умолчанию и допустимость выбора — ДАННЫЕ версии правила, а не
    константы кода: ТК РФ ст. 152/153 даёт выбор работнику, но какие
    категории им охвачены, определяет ведомственный акт (инвариант 7.1.3).
    """
    scope = {"legal_base": "fps_service", "hour_category": hour_category}
    known = _rule_ids(client)
    if COEFFICIENT_RULE_CODE in known:
        effective = client.get(
            f"{LEGAL}/rules/{known[COEFFICIENT_RULE_CODE]}/effective-version",
            params={"asOf": f"{CALCULATION_YEAR}-04-01", "scope": json.dumps(scope)},
        )
        if effective.status_code == 200:
            return
        rule_id = known[COEFFICIENT_RULE_CODE]
    else:
        created = client.post(
            f"{LEGAL}/rules",
            json={
                "code": COEFFICIENT_RULE_CODE,
                "category": "compensation_coefficient",
                "displayName": "Порядок компенсации по категориям часов",
            },
            headers=_idem(),
        )
        assert created.status_code == 201, created.text
        rule_id = created.json()["id"]

    version = client.post(
        f"{LEGAL}/rules/{rule_id}/versions",
        json={
            "scope": scope,
            "legalBasisNodeId": _legal_basis_node(client),
            "actions": [
                {
                    "node_type": "set_result",
                    "field": "default_compensation_form",
                    "formula": {"node_type": "literal", "value": default_form},
                },
                {
                    "node_type": "set_result",
                    "field": "election_allowed",
                    "formula": {"node_type": "literal", "value": election_allowed},
                },
            ],
            "validFrom": "2018-10-01",
        },
        headers=_idem(),
    )
    assert version.status_code == 201, version.text
    published = client.post(
        f"{LEGAL}/rule-versions/{version.json()['id']}/publish",
        json={"changeReason": f"Порядок компенсации категории {hour_category}"},
        headers=_idem(),
    )
    assert published.status_code == 200, published.text


def _publish_conflict_policy(client: TestClient) -> None:
    existing = client.get(f"{LEGAL}/conflict-policies")
    assert existing.status_code == 200, existing.text
    if any(p["code"] == POLICY_CODE and p["versions"] for p in existing.json()):
        return
    if not any(p["code"] == POLICY_CODE for p in existing.json()):
        created = client.post(
            f"{LEGAL}/conflict-policies", json={"code": POLICY_CODE}, headers=_idem()
        )
        assert created.status_code == 201, created.text
    version = client.post(
        f"{LEGAL}/conflict-policies/{POLICY_CODE}/versions",
        json={"precedenceList": PRECEDENCE_LIST, "validFrom": "2012-07-01"},
        headers=_idem(),
    )
    assert version.status_code == 201, version.text
    assert (
        client.post(
            f"{LEGAL}/conflict-policy-versions/{version.json()['id']}/publish",
            headers=_idem(),
        ).status_code
        == 200
    )


def _publish_calendar_year(client: TestClient) -> None:
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
    assert (
        client.post(
            f"{CALENDAR}/years/{CALCULATION_YEAR}/days", json={"days": days}, headers=_idem()
        ).status_code
        == 200
    )
    assert (
        client.post(f"{CALENDAR}/years/{CALCULATION_YEAR}/publish", headers=_idem()).status_code
        == 200
    )


@pytest.fixture
def compensable(client: TestClient) -> None:
    """Всё, без чего расчёт и компенсация отказывают."""
    _publish_norm_rule(client)
    _publish_calendar_year(client)
    _publish_conflict_policy(client)
    # Ночные — деньгами без выбора; сверхурочные — с правом выбора
    # (ТК РФ ст. 152).
    _publish_compensation_rule(
        client, hour_category="night", default_form="monetary", election_allowed=False
    )
    _publish_compensation_rule(
        client, hour_category="overtime", default_form="monetary", election_allowed=True
    )
    _publish_compensation_rule(
        client, hour_category="weekend", default_form="monetary", election_allowed=True
    )
    _publish_compensation_rule(
        client, hour_category="holiday", default_form="monetary", election_allowed=True
    )


def _employee(client: TestClient) -> str:
    unit = client.post(
        f"{PERSONNEL}/units",
        json={"code": f"CO-U-{uuid4().hex[:8]}", "name": "ПЧ compensation"},
        headers=_idem(),
    )
    position = client.post(
        f"{PERSONNEL}/positions",
        json={
            "code": f"CO-P-{uuid4().hex[:8]}",
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
            "fullName": "Компенсаров Компенсар Компенсарович",
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


def _approved_march(client: TestClient, employee: str) -> None:
    """Табель марта с одним суточным дежурством: 24 ч факта, из них 8 ч
    ночных."""
    sheet = client.post(
        f"{TA}/timesheets",
        json={
            "employeeId": employee,
            "periodType": "month",
            "periodStart": "2026-03-01",
            "periodEnd": "2026-04-01",
        },
        headers=_idem(),
    )
    assert sheet.status_code == 201, sheet.text
    shift = client.post(
        f"{TA}/timesheets/{sheet.json()['id']}/events",
        json={
            "eventType": "actual_shift",
            "startTime": datetime(2026, 3, 2, 8, tzinfo=MOSCOW).isoformat(),
            "endTime": datetime(2026, 3, 3, 8, tzinfo=MOSCOW).isoformat(),
        },
        headers=_idem(),
    )
    assert shift.status_code == 201, shift.text
    approved = client.post(f"{TA}/timesheets/{sheet.json()['id']}/approve", headers=_idem())
    assert approved.status_code == 200, approved.text


def _create_case(client: TestClient, employee: str):  # type: ignore[no-untyped-def]
    return client.post(
        f"{COMP}/cases",
        json={
            "employeeId": employee,
            "periodStart": "2026-03-01",
            "periodEnd": "2026-04-01",
        },
        headers=_idem(),
    )


# ----------------------------------------------------- инвариант 7.1.1


async def test_a_case_for_an_unapproved_period_is_422(
    client: TestClient, compensable
) -> None:  # type: ignore[no-untyped-def]
    """«Компенсация не может опережать факт»."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    response = _create_case(client, _employee(client))
    assert response.status_code == 422, response.text
    assert response.headers["content-type"].startswith("application/problem+json")


# ----------------------------------------------------------- CO005/CO006


async def test_a_case_is_created_from_the_approved_breakdown(
    client: TestClient, compensable
) -> None:  # type: ignore[no-untyped-def]
    """Суточное дежурство с 08:00 даёт 8 ночных часов (Алгоритм Г), и
    ровно они попадают в строку компенсации — не больше и не меньше."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    _approved_march(client, employee)

    created = _create_case(client, employee)
    assert created.status_code == 201, created.text
    body = created.json()

    assert body["status"] == "draft"
    assert len(body["lines"]) == 1
    line = body["lines"][0]
    assert line["hourCategory"] == "night"
    assert Decimal(str(line["hoursAmount"])) == Decimal("8.00")
    # Провенанс: строка обязана ссылаться на норму, по которой возникла.
    assert line["legalBasisRuleVersionId"]
    # Ночные по заведённому правилу выбора не допускают.
    assert line["electionAllowed"] is False


async def test_a_second_case_for_the_same_period_is_409(
    client: TestClient, compensable
) -> None:  # type: ignore[no-untyped-def]
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    _approved_march(client, employee)
    assert _create_case(client, employee).status_code == 201

    duplicate = _create_case(client, employee)
    assert duplicate.status_code == 409, duplicate.text


# ----------------------------------------------------------- CO008


async def test_an_election_is_refused_where_the_rule_forbids_it(
    client: TestClient, compensable
) -> None:  # type: ignore[no-untyped-def]
    """Ночные часы заведены с `election_allowed = false`: правило
    определяет форму однозначно, и рапорт по ним не принимается."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    _approved_march(client, employee)
    case_id = _create_case(client, employee).json()["id"]

    response = client.post(
        f"{COMP}/cases/{case_id}/elections",
        json={"hourCategory": "night", "compensationForm": "additional_rest_time"},
        headers=_idem(),
    )
    assert response.status_code == 422, response.text


# ----------------------------------------------------------- CO009


async def test_finalizing_freezes_the_case_and_writes_events(
    client: TestClient, session, compensable
) -> None:  # type: ignore[no-untyped-def]
    """DoD CO009: финализация публикует `CompensationLineCreated` для
    каждой строки. Потребитель — `rest_balance` (фаза 9)."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    _approved_march(client, employee)
    case_id = _create_case(client, employee).json()["id"]

    finalized = client.post(f"{COMP}/cases/{case_id}/finalize", headers=_idem())
    assert finalized.status_code == 200, finalized.text
    assert finalized.json()["status"] == "finalized"
    assert finalized.json()["finalizedAt"] is not None

    rows = await session.execute(
        select(outbox_message_table.c.event_type).where(
            outbox_message_table.c.aggregate_id == case_id
        )
    )
    types = [row.event_type for row in rows]
    assert "CompensationLineCreated" in types
    assert "CompensationCaseFinalized" in types


async def test_a_finalized_case_refuses_further_changes(
    client: TestClient, compensable
) -> None:  # type: ignore[no-untyped-def]
    """Инвариант 7.1.4: начисление уже произошло, и отменить его задним
    числом нельзя."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    _approved_march(client, employee)
    case_id = _create_case(client, employee).json()["id"]
    assert client.post(f"{COMP}/cases/{case_id}/finalize", headers=_idem()).status_code == 200

    again = client.post(f"{COMP}/cases/{case_id}/finalize", headers=_idem())
    assert again.status_code == 423, again.text

    election = client.post(
        f"{COMP}/cases/{case_id}/elections",
        json={"hourCategory": "night", "compensationForm": "monetary"},
        headers=_idem(),
    )
    assert election.status_code == 423, election.text


# ----------------------------------------------------------- CO012


async def test_the_history_lists_the_employees_cases(
    client: TestClient, compensable
) -> None:  # type: ignore[no-untyped-def]
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    _approved_march(client, employee)
    _create_case(client, employee)

    history = client.get(f"{COMP}/employees/{employee}/history")
    assert history.status_code == 200, history.text
    assert len(history.json()) == 1
    assert history.json()[0]["employeeId"] == employee


async def test_compensation_never_exceeds_the_approved_fact(
    client: TestClient, compensable
) -> None:  # type: ignore[no-untyped-def]
    """Инвариант 7.1.2 в самой прямой форме: сумма начисленных часов по
    категории равна тому, что зафиксировал утверждённый расчёт."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    _approved_march(client, employee)
    case_body = _create_case(client, employee).json()

    summary = client.get(
        f"{TA}/employees/{employee}/timesheet-summary",
        params={"periodStart": "2026-03-01", "periodEnd": "2026-04-01"},
    ).json()

    by_category = {
        line["hourCategory"]: Decimal(str(line["hoursAmount"]))
        for line in case_body["lines"]
    }
    assert by_category.get("night", Decimal(0)) == Decimal(str(summary["nightHours"]))
    assert by_category.get("overtime", Decimal(0)) == Decimal(str(summary["overtimeHours"]))
