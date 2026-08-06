"""Общие фикстуры интеграционных тестов `leave_management`.

Три файла тестов (LM006, LM011, LM015) требуют одной и той же подготовки:
правило продолжительности отпуска, сотрудник, клиент. Держать её в каждом
означало бы три копии, расходящиеся при первой же правке.
"""

from __future__ import annotations

import json
from uuid import uuid4

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.testclient import TestClient

from src.composition.settings import get_settings
from src.modules.leave_management.infrastructure.orm_mapping import start_mappers

LEAVE = "/api/v1/leave"
RB = "/api/v1/rest-balance"
PERSONNEL = "/api/v1/personnel"
LEGAL = "/api/v1/legal-rules"
SCHEDULING = "/api/v1/scheduling"

ENTITLEMENT_RULE_CODE = "LEAVE.ENTITLEMENT_DAYS"

start_mappers()


async def db_reachable() -> bool:
    try:
        engine = create_async_engine(get_settings().database_dsn)
        async with engine.connect():
            pass
        await engine.dispose()
        return True
    except (OperationalError, OSError):
        return False


def idem() -> dict[str, str]:
    return {"Idempotency-Key": str(uuid4())}


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


def _rule_ids(client: TestClient) -> dict[str, str]:
    listing = client.get(f"{LEGAL}/rules", params={"pageSize": 200})
    assert listing.status_code == 200, listing.text
    return {r["code"]: r["id"] for r in listing.json()["items"]}


def _legal_basis_node(client: TestClient) -> str:
    doc = client.post(
        f"{LEGAL}/documents",
        json={
            "docType": "federal_law",
            "regNumber": f"141-LM-{uuid4().hex[:6]}",
            "adoptedDate": "2012-05-23",
            "title": "ФЗ-141 (фрагмент для теста отпусков)",
            "validFrom": "2016-07-01",
        },
        headers=idem(),
    )
    assert doc.status_code == 201, doc.text
    node = client.post(
        f"{LEGAL}/documents/{doc.json()['id']}/nodes",
        json={"nodeType": "article", "ordinalNumber": "58"},
        headers=idem(),
    )
    assert node.status_code == 201, node.text
    return str(node.json()["id"])


def publish_entitlement_rule(
    client: TestClient, *, leave_type: str, seniority_band: str, days: int
) -> None:
    """Правило продолжительности отпуска для вида и ступени выслуги.

    Числа дней — данные версии правила, а не константы кода: ФЗ-141
    ст. 58 ч. 3 ставит продолжительность в зависимость от выслуги, и
    пороги меняются редакцией акта.
    """
    scope = {"leave_type": leave_type, "seniority_band": seniority_band}
    known = _rule_ids(client)
    if ENTITLEMENT_RULE_CODE in known:
        effective = client.get(
            f"{LEGAL}/rules/{known[ENTITLEMENT_RULE_CODE]}/effective-version",
            params={"asOf": "2026-03-01", "scope": json.dumps(scope)},
        )
        if effective.status_code == 200:
            return
        rule_id = known[ENTITLEMENT_RULE_CODE]
    else:
        created = client.post(
            f"{LEGAL}/rules",
            json={
                "code": ENTITLEMENT_RULE_CODE,
                "category": "leave_entitlement",
                "displayName": "Продолжительность отпуска",
            },
            headers=idem(),
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
                    "field": "entitled_days",
                    "formula": {"node_type": "literal", "value": days},
                }
            ],
            "validFrom": "2016-07-01",
        },
        headers=idem(),
    )
    assert version.status_code == 201, version.text
    published = client.post(
        f"{LEGAL}/rule-versions/{version.json()['id']}/publish",
        json={"changeReason": f"Продолжительность {leave_type}/{seniority_band}"},
        headers=idem(),
    )
    assert published.status_code == 200, published.text


@pytest.fixture
def entitlement_rules(client: TestClient) -> None:
    """Ступени по ФЗ-141 ст. 58 ч. 3 плюс виды, продолжительность которых
    от выслуги не зависит."""
    for band, days in (
        ("under_10", 30),
        ("from_10_to_15", 35),
        ("from_15_to_20", 40),
        ("from_20", 45),
    ):
        publish_entitlement_rule(
            client, leave_type="basic", seniority_band=band, days=days
        )
    for band in ("under_10", "from_10_to_15", "from_15_to_20", "from_20"):
        publish_entitlement_rule(
            client,
            leave_type="personal_circumstances_20y",
            seniority_band=band,
            days=30,
        )
        publish_entitlement_rule(
            client, leave_type="additional", seniority_band=band, days=10
        )


def create_employee(client: TestClient, *, hired_at: str = "2000-01-01") -> str:
    unit = client.post(
        f"{PERSONNEL}/units",
        json={"code": f"LM-U-{uuid4().hex[:8]}", "name": "ПЧ отпусков"},
        headers=idem(),
    )
    assert unit.status_code == 201, unit.text
    position = client.post(
        f"{PERSONNEL}/positions",
        json={
            "code": f"LM-P-{uuid4().hex[:8]}",
            "title": "Пожарный",
            "category": "operational",
            "defaultRegimeType": "five_day_week",
        },
        headers=idem(),
    )
    assert position.status_code == 201, position.text
    employee = client.post(
        f"{PERSONNEL}/employees",
        json={
            "personnelNumber": str(uuid4().int)[:9],
            "fullName": "Отпускной Отпуск Отпускович",
            "rank": "прапорщик внутренней службы",
            "legalBase": "fps_service",
            "currentPositionId": position.json()["id"],
            "currentUnitId": unit.json()["id"],
            "hiredAt": hired_at,
        },
        headers=idem(),
    )
    assert employee.status_code == 201, employee.text
    return str(employee.json()["id"])


def grant_leave(
    client: TestClient,
    employee_id: str,
    *,
    leave_type: str = "basic",
    start: str = "2026-03-01",
    end: str = "2026-03-21",
    attached_rest_days: str | None = None,
):  # type: ignore[no-untyped-def]
    body = {
        "employeeId": employee_id,
        "leaveType": leave_type,
        "periodStart": start,
        "periodEnd": end,
    }
    if attached_rest_days is not None:
        body["attachedRestDays"] = attached_rest_days
    return client.post(f"{LEAVE}/grants", json=body, headers=idem())
