"""Transactional Outbox — проверка того единственного свойства, ради
которого он существует: событие и изменение состояния попадают в БД
вместе либо не попадают вовсе (Architecture разд. 9.2).

Тесты идут через HTTP, а не через писателя напрямую: разорваться
атомарность может именно на реальном пути «команда → обработчик →
commit», а не в самом `OutboxWriter`.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.testclient import TestClient

from src.building_blocks.infrastructure.outbox import (
    OutboxReader,
    event_payload,
    to_jsonable,
)
from src.composition.settings import get_settings
from src.modules.personnel.domain.employee import Employee
from src.modules.personnel.domain.events import EmployeeRegistered
from src.modules.personnel.domain.value_objects import (
    EmploymentStatus,
    LegalBase,
    ServiceConditionCategory,
)
from src.modules.personnel.infrastructure.orm_mapping import outbox_message_table

pytestmark = pytest.mark.asyncio

PERSONNEL = "/api/v1/personnel"


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
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db_session:
        yield db_session
    await engine.dispose()


def _idem() -> dict[str, str]:
    return {"Idempotency-Key": str(uuid4())}


def _register_employee(client: TestClient) -> dict:  # type: ignore[type-arg]
    unit = client.post(
        f"{PERSONNEL}/units",
        json={"code": f"OB-U-{uuid4().hex[:8]}", "name": "ПЧ outbox"},
        headers=_idem(),
    )
    assert unit.status_code == 201, unit.text
    position = client.post(
        f"{PERSONNEL}/positions",
        json={
            "code": f"OB-P-{uuid4().hex[:8]}",
            "title": "Пожарный",
            "category": "operational",
            "defaultRegimeType": "shift_schedule",
        },
        headers=_idem(),
    )
    assert position.status_code == 201, position.text

    resp = client.post(
        f"{PERSONNEL}/employees",
        json={
            "personnelNumber": str(uuid4().int)[:9],
            "fullName": "Outbox Тестовый",
            "rank": "прапорщик внутренней службы",
            "legalBase": "fps_service",
            "currentPositionId": position.json()["id"],
            "currentUnitId": unit.json()["id"],
            "hiredAt": "2021-06-01",
        },
        headers=_idem(),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _outbox_rows(session, aggregate_id: str) -> list[dict]:  # type: ignore[no-untyped-def,type-arg]
    result = await session.execute(
        outbox_message_table.select().where(
            outbox_message_table.c.aggregate_id == aggregate_id
        ).order_by(outbox_message_table.c.occurred_at)
    )
    return [dict(row) for row in result.mappings()]


# --- атомарность -------------------------------------------------------


async def test_state_change_and_event_land_together(client: TestClient, session) -> None:  # type: ignore[no-untyped-def]
    """Регистрация сотрудника: строка в `employee` и строка в
    `outbox_message` появляются одним коммитом."""
    employee = _register_employee(client)

    rows = await _outbox_rows(session, employee["id"])
    assert [r["event_type"] for r in rows] == ["EmployeeRegistered"]

    row = rows[0]
    assert row["aggregate_type"] == "Employee"
    assert str(row["aggregate_id"]) == employee["id"]
    assert row["published_at"] is None, "релей ещё не запускался"
    assert row["attempts"] == 0
    assert row["payload"]["personnel_number"] == employee["personnelNumber"]


async def test_a_rejected_command_leaves_no_event(client: TestClient, session) -> None:
    """Обратная сторона: если команда отклонена, события быть не должно.

    Переход `dismissed → active` запрещён автоматом (Domain Model разд. 3.1
    инвариант 3). Событие `EmploymentStatusChanged` не должно появиться —
    иначе подписчик узнал бы об изменении, которого не произошло.
    """
    employee = _register_employee(client)
    employee_id = employee["id"]

    dismissal = client.patch(
        f"{PERSONNEL}/employees/{employee_id}/status",
        json={
            "newStatus": "dismissed",
            "effectiveDate": "2024-01-31",
            "reason": "по собственному желанию",
        },
        headers=_idem(),
    )
    assert dismissal.status_code == 200, dismissal.text

    before = await _outbox_rows(session, employee_id)

    rejected = client.patch(
        f"{PERSONNEL}/employees/{employee_id}/status",
        json={"newStatus": "active", "effectiveDate": "2024-03-01", "reason": "восстановление"},
        headers=_idem(),
    )
    assert rejected.status_code == 422, rejected.text

    after = await _outbox_rows(session, employee_id)
    assert [r["event_id"] for r in after] == [r["event_id"] for r in before]


async def test_every_state_change_of_a_lifecycle_is_recorded(
    client: TestClient, session
) -> None:  # type: ignore[no-untyped-def]
    """Цепочка событий сотрудника — это то, из чего строится трассируемость
    (SRS разд. 10 п.1), и то, на что подпишется TimeAccounting."""
    employee = _register_employee(client)
    employee_id = employee["id"]

    for status, effective in (("sick", "2022-02-01"), ("active", "2022-02-20")):
        resp = client.patch(
            f"{PERSONNEL}/employees/{employee_id}/status",
            json={"newStatus": status, "effectiveDate": effective, "reason": "по болезни"},
            headers=_idem(),
        )
        assert resp.status_code == 200, resp.text

    rows = await _outbox_rows(session, employee_id)
    assert [r["event_type"] for r in rows] == [
        "EmployeeRegistered",
        "EmploymentStatusChanged",
        "EmploymentStatusChanged",
    ]
    assert rows[1]["payload"]["new_status"] == "sick"
    assert rows[2]["payload"]["new_status"] == "active"
    assert rows[2]["payload"]["previous_status"] == "sick"


async def test_event_ids_are_unique_across_the_outbox(client: TestClient, session) -> None:  # type: ignore[no-untyped-def]
    """`uq_outbox_event_id` — защита от повторной постановки одного и того
    же доменного события."""
    employee = _register_employee(client)
    rows = await _outbox_rows(session, employee["id"])
    existing = rows[0]

    with pytest.raises(Exception) as exc_info:
        await session.execute(
            text(
                "INSERT INTO personnel.outbox_message "
                "(id, event_id, event_type, aggregate_type, aggregate_id, payload, "
                " occurred_at, attempts) "
                "VALUES (gen_random_uuid(), :event_id, 'X', 'Employee', :agg, '{}'::jsonb, "
                " now(), 0)"
            ),
            {"event_id": existing["event_id"], "agg": existing["aggregate_id"]},
        )
    assert "uq_outbox_event_id" in str(exc_info.value)
    await session.rollback()


# --- сторона релея ------------------------------------------------------


async def test_reader_returns_unpublished_oldest_first_and_marks_them(
    client: TestClient, session
) -> None:  # type: ignore[no-untyped-def]
    employee = _register_employee(client)
    reader = OutboxReader(session, outbox_message_table)

    pending = await reader.fetch_unpublished(limit=500)
    mine = [m for m in pending if str(m["aggregate_id"]) == employee["id"]]
    assert mine, "только что записанное событие должно быть неопубликованным"

    occurred = [m["occurred_at"] for m in pending]
    assert occurred == sorted(occurred), "релей разбирает очередь от старых к новым"

    await reader.mark_published([m["id"] for m in mine])
    await session.commit()

    still_pending = await reader.fetch_unpublished(limit=500)
    assert not [m for m in still_pending if str(m["aggregate_id"]) == employee["id"]]


async def test_a_failed_publish_keeps_the_message_and_counts_the_attempt(
    client: TestClient, session
) -> None:  # type: ignore[no-untyped-def]
    """Неопубликованное событие нельзя выбросить: это и есть то основание,
    без которого начисление становится «из воздуха» (инвариант 8.1.2)."""
    employee = _register_employee(client)
    reader = OutboxReader(session, outbox_message_table)

    rows = await _outbox_rows(session, employee["id"])
    message_id = rows[0]["id"]

    await reader.mark_failed(message_id, "брокер недоступен")
    await session.commit()

    after = await _outbox_rows(session, employee["id"])
    assert after[0]["attempts"] == 1
    assert after[0]["last_error"] == "брокер недоступен"
    assert after[0]["published_at"] is None, "сообщение осталось в очереди"


# --- сериализация -------------------------------------------------------


async def test_payload_excludes_base_event_fields() -> None:
    """`event_id` и `occurred_at` живут в собственных колонках; дублировать
    их в payload значит завести два места, которые могут разойтись."""
    event = EmployeeRegistered(
        employee_id=uuid4(), personnel_number="123456", unit_id=uuid4(), position_id=uuid4()
    )
    payload = event_payload(event)

    assert set(payload) == {"employee_id", "personnel_number", "unit_id", "position_id"}
    assert "event_id" not in payload
    assert "occurred_at" not in payload


async def test_to_jsonable_handles_every_type_a_domain_event_can_carry() -> None:
    employee = Employee.register(
        personnel_number="777777",
        full_name="Тест",
        rank="лейтенант внутренней службы",
        legal_base=LegalBase.FPS_SERVICE,
        service_condition_category=ServiceConditionCategory.HAZARDOUS_OR_DANGEROUS,
        position_id=uuid4(),
        unit_id=uuid4(),
        hired_at=date(2020, 1, 1),
        now=datetime(2020, 1, 1, tzinfo=UTC),
    )
    employee.change_employment_status(
        new_status=EmploymentStatus.SICK,
        effective_date=date(2021, 5, 1),
        reason="тест",
        now=datetime(2021, 5, 1, tzinfo=UTC),
    )

    for event in employee.pull_pending_events():
        payload = event_payload(event)
        # Всё, что уходит в jsonb, должно состоять из примитивов: UUID и
        # date/datetime/Enum обязаны быть уже развёрнуты.
        for value in payload.values():
            assert isinstance(value, str | int | float | bool | list | dict | type(None)), value

    assert to_jsonable(LegalBase.FPS_SERVICE) == "fps_service"
    assert to_jsonable(date(2024, 1, 2)) == "2024-01-02"
    assert to_jsonable((1, 2)) == [1, 2]
    assert to_jsonable(timedelta) is timedelta
