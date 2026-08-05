"""SD012/SD013 — интеграционные тесты `scheduling` через HTTP против живой
PostgreSQL.

Проверяется прежде всего то, что нельзя проверить в юнит-тестах: отказы,
которые выносит БД, а не агрегат, и межмодульные вызовы, которые в юнитах
подменены заглушками.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.testclient import TestClient

from src.composition.settings import get_settings
from src.modules.scheduling.contracts.get_planned_shifts import get_planned_shifts_for_employee
from src.modules.scheduling.infrastructure.orm_mapping import (
    outbox_message_table,
    start_mappers,
)

pytestmark = pytest.mark.asyncio

SCHED = "/api/v1/scheduling"
PERSONNEL = "/api/v1/personnel"
LEGAL = "/api/v1/legal-rules"

start_mappers()

MIN_REST_HOURS = 24


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


# --- подготовка данных в соседних модулях ------------------------------


def _active_employee(client: TestClient) -> str:
    """Сотрудник заводится через настоящий `personnel`, а не подсовывается
    в БД: инвариант 5.1.4 проверяется через контракт этого модуля, и
    подмена данных мимо него сделала бы тест бессмысленным."""
    unit = client.post(
        f"{PERSONNEL}/units",
        json={"code": f"SD-U-{uuid4().hex[:8]}", "name": "ПЧ scheduling"},
        headers=_idem(),
    )
    assert unit.status_code == 201, unit.text
    position = client.post(
        f"{PERSONNEL}/positions",
        json={
            "code": f"SD-P-{uuid4().hex[:8]}",
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
            "fullName": "Караулов Караул Караулович",
            "rank": "прапорщик внутренней службы",
            "legalBase": "fps_service",
            "currentPositionId": position.json()["id"],
            "currentUnitId": unit.json()["id"],
            "hiredAt": "2020-01-01",
        },
        headers=_idem(),
    )
    assert employee.status_code == 201, employee.text
    return employee.json()["id"]


def _publish_minimum_rest_rule(client: TestClient) -> None:
    """Правило минимального отдыха заводится один раз на прогон.

    Величина отдыха — данные `RuleVersion`, а не константа в коде
    («Rule → Calculation → Employee»), поэтому без опубликованного правила
    ни одна смена назначена быть не может. Это не обходной приём в тесте,
    а буквально то поведение, которого требует Принцип 0.2.
    """
    existing = client.get(f"{LEGAL}/rules", params={"pageSize": 200})
    assert existing.status_code == 200, existing.text
    if any(r["code"] == "REST.MINIMUM_BETWEEN_SHIFTS" for r in existing.json()["items"]):
        return

    doc = client.post(
        f"{LEGAL}/documents",
        json={
            "docType": "departmental_order",
            "regNumber": f"410-SD-{uuid4().hex[:6]}",
            "adoptedDate": "2018-09-24",
            "title": "Приказ МЧС России № 410 (фрагмент для теста)",
            "validFrom": "2018-10-01",
        },
        headers=_idem(),
    )
    assert doc.status_code == 201, doc.text
    node = client.post(
        f"{LEGAL}/documents/{doc.json()['id']}/nodes",
        json={"nodeType": "paragraph", "ordinalNumber": "12"},
        headers=_idem(),
    )
    assert node.status_code == 201, node.text

    rule = client.post(
        f"{LEGAL}/rules",
        json={
            "code": "REST.MINIMUM_BETWEEN_SHIFTS",
            "category": "minimum_rest_period",
            "displayName": "Минимальный межсменный отдых",
        },
        headers=_idem(),
    )
    assert rule.status_code == 201, rule.text

    version = client.post(
        f"{LEGAL}/rules/{rule.json()['id']}/versions",
        json={
            "scope": {},
            "legalBasisNodeId": node.json()["id"],
            "actions": [
                {
                    "node_type": "set_result",
                    "field": "minimum_rest_hours",
                    "formula": {"node_type": "literal", "value": MIN_REST_HOURS},
                }
            ],
            "validFrom": "2018-10-01",
        },
        headers=_idem(),
    )
    assert version.status_code == 201, version.text
    published = client.post(
        f"{LEGAL}/rule-versions/{version.json()['id']}/publish",
        json={"changeReason": "Ввод нормы межсменного отдыха для тестового контура"},
        headers=_idem(),
    )
    assert published.status_code == 200, published.text


def _schedule(client: TestClient, *, start: date, end: date, unit_id: str | None = None) -> dict:  # type: ignore[type-arg]
    resp = client.post(
        f"{SCHED}/duty-schedules",
        json={
            "unitId": unit_id or str(uuid4()),
            "periodType": "month",
            "periodStart": start.isoformat(),
            "periodEnd": end.isoformat(),
        },
        headers=_idem(),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _add_shift(client: TestClient, schedule_id: str, employee_id: str, start: datetime, hours: int):  # type: ignore[no-untyped-def]
    return client.post(
        f"{SCHED}/duty-schedules/{schedule_id}/shifts",
        json={
            "employeeId": employee_id,
            "startTime": start.isoformat(),
            "endTime": (start + timedelta(hours=hours)).isoformat(),
            "dutyType": "twenty_four_hour_duty",
        },
        headers=_idem(),
    )


# --- SD012 -------------------------------------------------------------


async def test_overlapping_shift_inside_one_schedule_is_409(client: TestClient) -> None:
    """DoD SD012: «Тест через HTTP подтверждает 409 и Problem-тело»."""
    _publish_minimum_rest_rule(client)
    employee = _active_employee(client)
    schedule = _schedule(client, start=date(2026, 3, 1), end=date(2026, 4, 1))

    first = _add_shift(client, schedule["id"], employee, datetime(2026, 3, 2, 8, tzinfo=UTC), 24)
    assert first.status_code == 201, first.text

    clash = _add_shift(client, schedule["id"], employee, datetime(2026, 3, 2, 20, tzinfo=UTC), 24)
    assert clash.status_code == 409, clash.text
    problem = clash.json()["detail"]
    assert problem["status"] == 409
    assert problem["type"].endswith("/overlapping-interval")
    assert problem["traceId"]


async def test_overlap_ACROSS_two_schedules_is_also_409(client: TestClient) -> None:
    """Случай, ради которого EXCLUDE сделан глобальным: агрегат апреля не
    видит смен марта, ловит только БД. Без перехвата `IntegrityError` в
    роутере это был бы 500."""
    _publish_minimum_rest_rule(client)
    employee = _active_employee(client)
    unit = str(uuid4())
    march = _schedule(client, start=date(2026, 3, 1), end=date(2026, 4, 1), unit_id=unit)
    april = _schedule(client, start=date(2026, 4, 1), end=date(2026, 5, 1), unit_id=unit)

    # 31 марта 20:00 → 1 апреля 20:00
    first = _add_shift(client, march["id"], employee, datetime(2026, 3, 31, 20, tzinfo=UTC), 24)
    assert first.status_code == 201, first.text

    # 1 апреля 08:00 → 2 апреля 08:00 — пересекается с мартовской
    clash = _add_shift(client, april["id"], employee, datetime(2026, 4, 1, 8, tzinfo=UTC), 24)
    assert clash.status_code == 409, clash.text
    assert clash.json()["detail"]["type"].endswith("/overlapping-interval")


async def test_a_shift_violating_the_minimum_rest_is_422(client: TestClient) -> None:
    """Инвариант 5.1.2 целиком: величина отдыха взята из опубликованной
    `RuleVersion`, а не из константы."""
    _publish_minimum_rest_rule(client)
    employee = _active_employee(client)
    schedule = _schedule(client, start=date(2026, 3, 1), end=date(2026, 4, 1))

    first = _add_shift(client, schedule["id"], employee, datetime(2026, 3, 2, 8, tzinfo=UTC), 24)
    assert first.status_code == 201, first.text

    # Кончилась 3 марта 08:00; следующая через 12 ч при норме 24.
    too_soon = _add_shift(
        client, schedule["id"], employee, datetime(2026, 3, 3, 20, tzinfo=UTC), 24
    )
    assert too_soon.status_code == 422, too_soon.text
    assert "межсменный отдых" in too_soon.json()["detail"]["title"]

    # Ровно 24 ч спустя — принимается.
    ok = _add_shift(client, schedule["id"], employee, datetime(2026, 3, 4, 8, tzinfo=UTC), 24)
    assert ok.status_code == 201, ok.text


async def test_a_dismissed_employee_cannot_be_scheduled(client: TestClient) -> None:
    """Инвариант 5.1.4 через настоящий контракт `personnel`."""
    _publish_minimum_rest_rule(client)
    employee = _active_employee(client)
    dismissal = client.patch(
        f"{PERSONNEL}/employees/{employee}/status",
        json={
            "newStatus": "dismissed",
            "effectiveDate": "2025-12-31",
            "reason": "по собственному желанию",
        },
        headers=_idem(),
    )
    assert dismissal.status_code == 200, dismissal.text

    schedule = _schedule(client, start=date(2026, 3, 1), end=date(2026, 4, 1))
    resp = _add_shift(client, schedule["id"], employee, datetime(2026, 3, 2, 8, tzinfo=UTC), 24)

    assert resp.status_code == 422, resp.text
    assert "dismissed" in resp.json()["detail"]["detail"]


async def test_a_shift_dated_before_the_rest_rule_took_effect_is_refused(
    client: TestClient,
) -> None:
    """Отсутствие применимой нормы отдыха — ОТКАЗ, а не «ноль часов».

    Ноль означал бы «отдых не требуется» и тихо разрешил бы ставить смены
    подряд. Правило заведено с `validFrom = 2018-10-01`, поэтому смена,
    датированная 2017 годом, применимой версии не находит (Принцип 0.2:
    правило берётся на дату события, а не на дату расчёта).
    """
    _publish_minimum_rest_rule(client)
    employee = _active_employee(client)
    schedule = _schedule(client, start=date(2031, 3, 1), end=date(2031, 4, 1))

    first = _add_shift(client, schedule["id"], employee, datetime(2031, 3, 2, 8, tzinfo=UTC), 24)
    assert first.status_code == 201, "первая смена сотрудника сравнивать не с чем"

    early = _schedule(client, start=date(2017, 3, 1), end=date(2017, 4, 1))
    second = _add_shift(client, early["id"], employee, datetime(2017, 3, 2, 8, tzinfo=UTC), 24)
    assert second.status_code == 422, second.text
    assert second.json()["detail"]["type"].endswith("/rule-version-not-found")


# --- SD013: draft → approve → revise -----------------------------------


async def test_draft_approve_revise_keeps_the_history(client: TestClient, session) -> None:  # type: ignore[no-untyped-def]
    """DoD SD013: «Полный цикл проходит, история версий сохранена»."""
    _publish_minimum_rest_rule(client)
    employee = _active_employee(client)
    unit = str(uuid4())
    schedule = _schedule(client, start=date(2026, 6, 1), end=date(2026, 7, 1), unit_id=unit)
    assert schedule["status"] == "draft"
    assert schedule["revisionNo"] == 1

    added = _add_shift(client, schedule["id"], employee, datetime(2026, 6, 2, 8, tzinfo=UTC), 24)
    assert added.status_code == 201, added.text

    approved = client.post(
        f"{SCHED}/duty-schedules/{schedule['id']}/approve",
        json={"approvalOrderRef": "Приказ № 17 от 25.05.2026"},
        headers=_idem(),
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"

    # Утверждённый график неизменяем.
    locked = _add_shift(client, schedule["id"], employee, datetime(2026, 6, 8, 8, tzinfo=UTC), 24)
    assert locked.status_code == 423, locked.text

    revised = client.post(
        f"{SCHED}/duty-schedules/{schedule['id']}/revise",
        json={"reason": "Замена по болезни начальника караула"},
        headers=_idem(),
    )
    assert revised.status_code == 201, revised.text
    successor = revised.json()
    assert successor["revisionNo"] == 2
    assert successor["previousScheduleId"] == schedule["id"]
    assert successor["status"] == "draft"
    assert len(successor["shifts"]) == 1, "смены перенесены в новую версию"

    # Старая версия закрыта, но осталась.
    old = client.get(f"{SCHED}/duty-schedules/{schedule['id']}").json()
    assert old["status"] == "closed"

    # Обе версии видны в истории подразделения.
    listed = client.get(
        f"{SCHED}/units/{unit}/duty-schedules",
        params={"periodStart": "2026-06-01", "periodEnd": "2026-07-01"},
    ).json()
    assert {s["revisionNo"] for s in listed} == {1, 2}

    # Событие пересмотра записано в outbox той же транзакцией.
    rows = await session.execute(
        outbox_message_table.select().where(
            outbox_message_table.c.aggregate_id == schedule["id"]
        )
    )
    types = [r.event_type for r in rows.mappings()]
    assert types == ["ScheduleApproved", "ScheduleRevised"]


async def test_the_successor_can_be_edited_and_approved_with_a_new_order(
    client: TestClient,
) -> None:
    _publish_minimum_rest_rule(client)
    employee = _active_employee(client)
    unit = str(uuid4())
    schedule = _schedule(client, start=date(2026, 8, 1), end=date(2026, 9, 1), unit_id=unit)
    _add_shift(client, schedule["id"], employee, datetime(2026, 8, 3, 8, tzinfo=UTC), 24)
    client.post(
        f"{SCHED}/duty-schedules/{schedule['id']}/approve",
        json={"approvalOrderRef": "Приказ № 20"},
        headers=_idem(),
    )
    successor = client.post(
        f"{SCHED}/duty-schedules/{schedule['id']}/revise",
        json={"reason": "Корректировка состава"},
        headers=_idem(),
    ).json()

    extra = _add_shift(
        client, successor["id"], employee, datetime(2026, 8, 10, 8, tzinfo=UTC), 24
    )
    assert extra.status_code == 201, extra.text

    approved = client.post(
        f"{SCHED}/duty-schedules/{successor['id']}/approve",
        json={"approvalOrderRef": "Приказ № 26"},
        headers=_idem(),
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["approvalOrderRef"] == "Приказ № 26"


# --- SD015: контракт ---------------------------------------------------


async def test_contract_returns_only_active_shifts(client: TestClient, session) -> None:  # type: ignore[no-untyped-def]
    """`TimeAccounting` не должен видеть смены отменённой версии: привязать
    к ним факт значило бы обосновать отработанное время отменённым
    приказом."""
    _publish_minimum_rest_rule(client)
    employee = _active_employee(client)
    unit = str(uuid4())
    schedule = _schedule(client, start=date(2026, 9, 1), end=date(2026, 10, 1), unit_id=unit)
    _add_shift(client, schedule["id"], employee, datetime(2026, 9, 2, 8, tzinfo=UTC), 24)
    client.post(
        f"{SCHED}/duty-schedules/{schedule['id']}/approve",
        json={"approvalOrderRef": "Приказ № 30"},
        headers=_idem(),
    )

    before = await get_planned_shifts_for_employee(
        session, employee_id=employee, period_start=date(2026, 9, 1), period_end=date(2026, 10, 1)
    )
    assert len(before) == 1
    assert before[0].schedule_status == "approved"

    client.post(
        f"{SCHED}/duty-schedules/{schedule['id']}/revise",
        json={"reason": "Корректировка"},
        headers=_idem(),
    )

    after = await get_planned_shifts_for_employee(
        session, employee_id=employee, period_start=date(2026, 9, 1), period_end=date(2026, 10, 1)
    )
    assert len(after) == 1, "видна ровно одна смена — из действующей версии"
    assert after[0].shift_id != before[0].shift_id
    assert after[0].schedule_status == "draft"


async def test_contract_includes_a_shift_starting_in_the_previous_period(
    client: TestClient, session
) -> None:  # type: ignore[no-untyped-def]
    """Суточное дежурство, начавшееся 31-го числа, попадает в следующий
    период своей второй половиной. Потерять его значит потерять часы."""
    _publish_minimum_rest_rule(client)
    employee = _active_employee(client)
    unit = str(uuid4())
    october = _schedule(client, start=date(2026, 10, 1), end=date(2026, 11, 1), unit_id=unit)
    added = _add_shift(
        client, october["id"], employee, datetime(2026, 10, 31, 20, tzinfo=UTC), 24
    )
    assert added.status_code == 201, added.text

    november = await get_planned_shifts_for_employee(
        session, employee_id=employee, period_start=date(2026, 11, 1), period_end=date(2026, 12, 1)
    )
    assert len(november) == 1
    assert november[0].start_time.month == 10


async def test_contract_rejects_an_inverted_period(client: TestClient, session) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(ValueError, match="period_end"):
        await get_planned_shifts_for_employee(
            session,
            employee_id=uuid4(),
            period_start=date(2026, 4, 1),
            period_end=date(2026, 3, 1),
        )


async def test_planned_shift_range_is_stored_as_a_half_open_interval(
    client: TestClient, session
) -> None:  # type: ignore[no-untyped-def]
    """Границы `'[)'` обязаны совпадать с семантикой `TimeInterval`: иначе
    пересменка считалась бы пересечением, и разница вылезла бы ровно на
    суточных дежурствах."""
    _publish_minimum_rest_rule(client)
    employee = _active_employee(client)
    schedule = _schedule(client, start=date(2026, 12, 1), end=date(2027, 1, 1))
    added = _add_shift(client, schedule["id"], employee, datetime(2026, 12, 2, 8, tzinfo=UTC), 24)
    assert added.status_code == 201, added.text

    bounds = await session.execute(
        text(
            "SELECT lower_inc(time_range) AS li, upper_inc(time_range) AS ui "
            "FROM scheduling.planned_shift WHERE id = :sid"
        ),
        {"sid": added.json()["id"]},
    )
    row = bounds.mappings().one()
    assert row["li"] is True and row["ui"] is False
