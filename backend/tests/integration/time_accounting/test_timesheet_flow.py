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

from datetime import UTC, datetime, timedelta
from uuid import uuid4

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

start_mappers()


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


async def test_an_approved_timesheet_refuses_new_events_with_423(client: TestClient) -> None:
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


async def test_reopening_then_approving_again_works(client: TestClient) -> None:
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


async def test_approving_twice_is_423(client: TestClient) -> None:
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    assert client.post(f"{TA}/timesheets/{sheet}/approve", headers=_idem()).status_code == 200

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


async def test_approval_writes_its_event_to_the_outbox(client: TestClient, session) -> None:  # type: ignore[no-untyped-def]
    """Transactional Outbox: состояние и событие одной транзакцией
    (Architecture разд. 9.2). Потребители появятся в фазе 8, но запись
    обязана быть уже сейчас — иначе Compensation не узнает, что период
    закрыт."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    sheet = _open_timesheet(client, _employee(client))
    assert client.post(f"{TA}/timesheets/{sheet}/approve", headers=_idem()).status_code == 200

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
