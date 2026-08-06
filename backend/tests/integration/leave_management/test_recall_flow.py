"""LM011 — предоставление → отзыв → учёт остатка.

DoD задачи: «тест подтверждает корректный `RecallEvent` и статус
`LeaveGrant`».

Главное здесь — инвариант 9.1.3: «наличие `RecallEvent` не уменьшает
`EntitlementBasis` — неиспользованный остаток обязан быть учтён
(запрещено „тихое" аннулирование дней отпуска)». Проверяется поимённо:
период не укоротился, остаток назван числом, и число это уехало в
событие.

Здесь же LM009 — присоединение суток ДДО к отпуску (Приказ МЧС России
№ 410 п. 12): списание идёт через контракт `rest_balance`, и отказ в нём
отменяет приказ целиком.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import select
from starlette.testclient import TestClient

from src.modules.leave_management.infrastructure.orm_mapping import outbox_message_table
from tests.integration.leave_management.conftest import (
    LEAVE,
    RB,
    create_employee,
    db_reachable,
    grant_leave,
    idem,
)

pytestmark = pytest.mark.asyncio


async def test_grant_then_recall_records_the_remainder(
    client: TestClient, entitlement_rules
) -> None:  # type: ignore[no-untyped-def]
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = create_employee(client)
    granted = grant_leave(client, employee, start="2026-03-01", end="2026-03-21")
    assert granted.status_code == 201, granted.text
    grant_id = granted.json()["id"]
    assert granted.json()["status"] == "active"
    assert granted.json()["unusedDays"] == 0

    recall = client.post(
        f"{LEAVE}/grants/{grant_id}/recall",
        json={"recallDate": "2026-03-05", "effectiveFrom": "2026-03-08"},
        headers=idem(),
    )
    assert recall.status_code == 201, recall.text
    assert recall.json()["leaveGrantId"] == grant_id
    assert recall.json()["recallDate"] == "2026-03-05"
    assert recall.json()["effectiveFrom"] == "2026-03-08"
    # DoD LM007: остаток дней зафиксирован явно.
    assert recall.json()["usedDays"] == 7
    assert recall.json()["unusedDays"] == 13

    after = client.get(f"{LEAVE}/grants/{grant_id}")
    assert after.status_code == 200, after.text
    assert after.json()["status"] == "recalled"
    # Инвариант 9.1.3: период НЕ укоротился.
    assert after.json()["periodStart"] == "2026-03-01"
    assert after.json()["periodEnd"] == "2026-03-21"
    assert after.json()["unusedDays"] == 13


async def test_the_recall_event_reaches_the_outbox_with_the_remainder(
    client: TestClient, entitlement_rules, session
) -> None:  # type: ignore[no-untyped-def]
    """Остаток уезжает вместе с фактом: кадровая служба обязана
    предоставить неиспользованную часть в удобное для сотрудника время
    (ФЗ-141 ст. 65 ч. 3), и считать его по своей копии периода она не
    должна."""
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = create_employee(client)
    grant_id = grant_leave(client, employee, start="2026-04-01", end="2026-04-21").json()["id"]
    assert (
        client.post(
            f"{LEAVE}/grants/{grant_id}/recall",
            json={"recallDate": "2026-04-03", "effectiveFrom": "2026-04-05"},
            headers=idem(),
        ).status_code
        == 201
    )

    rows = await session.execute(
        select(
            outbox_message_table.c.event_type, outbox_message_table.c.payload
        ).where(outbox_message_table.c.aggregate_id == grant_id)
    )
    events = {row.event_type: row.payload for row in rows}
    assert "LeaveGrantCreated" in events
    assert "LeaveGrantRecalled" in events
    assert events["LeaveGrantRecalled"]["unused_days"] == 16
    assert events["LeaveGrantRecalled"]["used_days"] == 4


async def test_a_recall_outside_the_leave_is_422(
    client: TestClient, entitlement_rules
) -> None:  # type: ignore[no-untyped-def]
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = create_employee(client)
    grant_id = grant_leave(client, employee, start="2026-03-01", end="2026-03-21").json()["id"]

    response = client.post(
        f"{LEAVE}/grants/{grant_id}/recall",
        json={"recallDate": "2026-04-01", "effectiveFrom": "2026-04-01"},
        headers=idem(),
    )
    assert response.status_code == 422, response.text
    assert response.headers["content-type"].startswith("application/problem+json")


async def test_a_second_recall_is_422(
    client: TestClient, entitlement_rules
) -> None:  # type: ignore[no-untyped-def]
    """Вернуть сотрудника в отпуск после отзыва можно только новым
    приказом: прерывать уже прерванный нечего."""
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = create_employee(client)
    grant_id = grant_leave(client, employee, start="2026-03-01", end="2026-03-21").json()["id"]

    first = client.post(
        f"{LEAVE}/grants/{grant_id}/recall",
        json={"recallDate": "2026-03-05", "effectiveFrom": "2026-03-08"},
        headers=idem(),
    )
    assert first.status_code == 201, first.text

    second = client.post(
        f"{LEAVE}/grants/{grant_id}/recall",
        json={"recallDate": "2026-03-10", "effectiveFrom": "2026-03-12"},
        headers=idem(),
    )
    assert second.status_code == 422, second.text


async def test_a_recall_of_an_unknown_grant_is_404(client: TestClient) -> None:
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    from uuid import uuid4

    response = client.post(
        f"{LEAVE}/grants/{uuid4()}/recall",
        json={"recallDate": "2026-03-05", "effectiveFrom": "2026-03-08"},
        headers=idem(),
    )
    assert response.status_code == 404, response.text


async def test_a_recalled_leave_still_blocks_the_same_dates(
    client: TestClient, entitlement_rules
) -> None:  # type: ignore[no-untyped-def]
    """Отозванный отпуск СОСТОЯЛСЯ: сотрудник в нём был, и перекрыть эти
    даты новым отпуском значило бы выдать их дважды."""
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = create_employee(client)
    grant_id = grant_leave(client, employee, start="2026-03-01", end="2026-03-21").json()["id"]
    assert (
        client.post(
            f"{LEAVE}/grants/{grant_id}/recall",
            json={"recallDate": "2026-03-05", "effectiveFrom": "2026-03-08"},
            headers=idem(),
        ).status_code
        == 201
    )

    again = grant_leave(client, employee, start="2026-03-10", end="2026-03-15")
    assert again.status_code == 409, again.text


# ------------------------------------- LM009: присоединение суток ДДО


async def test_attaching_rest_days_consumes_them_from_the_balance(
    client: TestClient, entitlement_rules
) -> None:  # type: ignore[no-untyped-def]
    """Приказ МЧС России № 410 п. 12: дополнительные дни отдыха по
    желанию сотрудника присоединяются к ежегодному отпуску.

    Списание идёт через контракт `rest_balance` (DoD LM009) и в той же
    транзакции: приказ либо издан со списанием, либо не издан.
    """
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = create_employee(client)

    # Прямого способа начислить сутки у API нет — начисление рождается
    # только из компенсации (инвариант 8.1.2), — поэтому здесь проверяется
    # обратная сторона: без остатка присоединение отклоняется.
    refused = grant_leave(
        client, employee, start="2026-03-01", end="2026-03-21", attached_rest_days="3"
    )
    assert refused.status_code == 422, refused.text
    assert refused.json()["type"].endswith("insufficient-balance")
    assert Decimal(refused.json()["balanceDays"]) == Decimal(0)
    assert Decimal(refused.json()["requestedDays"]) == Decimal(3)

    # И приказ не издан: откат затронул и предоставление тоже.
    grants = client.get(f"{LEAVE}/employees/{employee}/grants")
    assert grants.status_code == 200, grants.text
    assert grants.json() == []

    # Сутки на баланс не легли: движения нет.
    movements = client.get(f"{RB}/employees/{employee}/movements")
    assert movements.status_code == 200, movements.text
    assert movements.json() == []


async def test_a_leave_without_attachment_touches_no_balance(
    client: TestClient, entitlement_rules
) -> None:  # type: ignore[no-untyped-def]
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = create_employee(client)
    assert grant_leave(client, employee, start="2026-03-01", end="2026-03-21").status_code == 201

    movements = client.get(f"{RB}/employees/{employee}/movements")
    assert movements.json() == []


# ----------------------------------------------------------- список


async def test_the_list_shows_the_employees_grants(
    client: TestClient, entitlement_rules
) -> None:  # type: ignore[no-untyped-def]
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = create_employee(client)
    grant_leave(client, employee, start="2026-03-01", end="2026-03-15")
    grant_leave(client, employee, leave_type="additional", start="2026-05-01", end="2026-05-10")

    listing = client.get(f"{LEAVE}/employees/{employee}/grants")
    assert listing.status_code == 200, listing.text
    assert len(listing.json()) == 2
    # Новые сверху.
    assert listing.json()[0]["periodStart"] == "2026-05-01"


async def test_an_unknown_grant_is_404(client: TestClient) -> None:
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    from uuid import uuid4

    response = client.get(f"{LEAVE}/grants/{uuid4()}")
    assert response.status_code == 404, response.text
