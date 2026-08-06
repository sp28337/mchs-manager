"""LM015 — инвариант 9.1.4: отпуск и утверждённая смена несовместимы.

DoD задачи: «тест подтверждает отказ с сообщением о конфликтующей
смене».

    «`LeaveGrant` не может быть создан с `LeavePeriod`, пересекающимся с
    уже утверждённой `PlannedShift` того же сотрудника в `Scheduling` без
    предварительной отмены/переноса этой смены».

Проверяется обе стороны: смена УТВЕРЖДЁННОГО графика отпуск блокирует,
смена черновика — нет. Разница не техническая: черновик есть намерение
планировщика, и запрещать по нему отпуск значило бы дать ему власть,
которой у него нет.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

import pytest
from starlette.testclient import TestClient

from tests.integration.leave_management.conftest import (
    SCHEDULING,
    create_employee,
    db_reachable,
    grant_leave,
    idem,
)

pytestmark = pytest.mark.asyncio

LEGAL = "/api/v1/legal-rules"
MIN_REST_HOURS = 42


def _publish_minimum_rest_rule(client: TestClient) -> None:
    """`scheduling` отказывается ставить смену без нормы межсменного
    отдыха, поэтому она нужна и здесь."""
    listing = client.get(f"{LEGAL}/rules", params={"pageSize": 200})
    assert listing.status_code == 200, listing.text
    known = {r["code"]: r["id"] for r in listing.json()["items"]}
    code = "REST.MINIMUM_HOURS"

    scope = {"legal_base": "fps_service", "regime_type": "twenty_four_hour_duty"}
    if code in known:
        effective = client.get(
            f"{LEGAL}/rules/{known[code]}/effective-version",
            params={"asOf": "2026-03-01", "scope": __import__("json").dumps(scope)},
        )
        if effective.status_code == 200:
            return
        rule_id = known[code]
    else:
        created = client.post(
            f"{LEGAL}/rules",
            json={
                "code": code,
                "category": "minimum_rest_period",
                "displayName": "Минимальный межсменный отдых",
            },
            headers=idem(),
        )
        assert created.status_code == 201, created.text
        rule_id = created.json()["id"]

    doc = client.post(
        f"{LEGAL}/documents",
        json={
            "docType": "federal_law",
            "regNumber": f"141-SC-{uuid4().hex[:6]}",
            "adoptedDate": "2012-05-23",
            "title": "ФЗ-141 (фрагмент, межсменный отдых)",
            "validFrom": "2016-07-01",
        },
        headers=idem(),
    )
    assert doc.status_code == 201, doc.text
    node = client.post(
        f"{LEGAL}/documents/{doc.json()['id']}/nodes",
        json={"nodeType": "article", "ordinalNumber": "55"},
        headers=idem(),
    )
    assert node.status_code == 201, node.text

    version = client.post(
        f"{LEGAL}/rules/{rule_id}/versions",
        json={
            "scope": scope,
            "legalBasisNodeId": node.json()["id"],
            "actions": [
                {
                    "node_type": "set_result",
                    "field": "minimum_rest_hours",
                    "formula": {"node_type": "literal", "value": MIN_REST_HOURS},
                }
            ],
            "validFrom": "2016-07-01",
        },
        headers=idem(),
    )
    assert version.status_code == 201, version.text
    published = client.post(
        f"{LEGAL}/rule-versions/{version.json()['id']}/publish",
        json={"changeReason": "Норма межсменного отдыха для теста конфликта"},
        headers=idem(),
    )
    assert published.status_code == 200, published.text


def _schedule_with_shift(
    client: TestClient, employee: str, *, shift_start: datetime, approve: bool
) -> str:
    schedule = client.post(
        f"{SCHEDULING}/duty-schedules",
        json={
            "unitId": str(uuid4()),
            "periodType": "month",
            "periodStart": date(2026, 3, 1).isoformat(),
            "periodEnd": date(2026, 4, 1).isoformat(),
        },
        headers=idem(),
    )
    assert schedule.status_code == 201, schedule.text
    schedule_id = schedule.json()["id"]

    shift = client.post(
        f"{SCHEDULING}/duty-schedules/{schedule_id}/shifts",
        json={
            "employeeId": employee,
            "startTime": shift_start.isoformat(),
            "endTime": (shift_start + timedelta(hours=24)).isoformat(),
            "dutyType": "twenty_four_hour_duty",
        },
        headers=idem(),
    )
    assert shift.status_code == 201, shift.text

    if approve:
        approved = client.post(
            f"{SCHEDULING}/duty-schedules/{schedule_id}/approve",
            json={"approvalOrderRef": "Приказ № 3 от 20.02.2026"},
            headers=idem(),
        )
        assert approved.status_code == 200, approved.text

    return str(shift.json()["id"])


async def test_a_leave_over_an_approved_shift_is_refused(
    client: TestClient, entitlement_rules
) -> None:  # type: ignore[no-untyped-def]
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    _publish_minimum_rest_rule(client)
    employee = create_employee(client)
    shift_id = _schedule_with_shift(
        client, employee, shift_start=datetime(2026, 3, 10, 8, tzinfo=UTC), approve=True
    )

    refused = grant_leave(client, employee, start="2026-03-05", end="2026-03-20")
    assert refused.status_code == 409, refused.text
    assert refused.headers["content-type"].startswith("application/problem+json")
    # DoD LM015: сообщение называет конфликтующую смену.
    assert shift_id in refused.json()["detail"]


async def test_a_leave_over_a_draft_shift_is_granted(
    client: TestClient, entitlement_rules
) -> None:  # type: ignore[no-untyped-def]
    """Смена черновика — намерение, а не обязательство."""
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    _publish_minimum_rest_rule(client)
    employee = create_employee(client)
    _schedule_with_shift(
        client, employee, shift_start=datetime(2026, 3, 10, 8, tzinfo=UTC), approve=False
    )

    granted = grant_leave(client, employee, start="2026-03-05", end="2026-03-20")
    assert granted.status_code == 201, granted.text


async def test_a_leave_beside_an_approved_shift_is_granted(
    client: TestClient, entitlement_rules
) -> None:  # type: ignore[no-untyped-def]
    """Смена вне периода отпуска не мешает: проверяется пересечение, а не
    наличие смен у сотрудника вообще."""
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    _publish_minimum_rest_rule(client)
    employee = create_employee(client)
    _schedule_with_shift(
        client, employee, shift_start=datetime(2026, 3, 2, 8, tzinfo=UTC), approve=True
    )

    granted = grant_leave(client, employee, start="2026-03-10", end="2026-03-20")
    assert granted.status_code == 201, granted.text
