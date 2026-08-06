"""PE013 — HTTP-level integration test for the employee lifecycle.

Drives the actual FastAPI app (not handlers directly) against a REAL
PostgreSQL, through the whole sequence a real person goes through:
подразделение → должность → приём на службу → перевод → изменение статуса
→ увольнение, then verifies the service history that accumulated along the
way is correct AND that it cannot be rewritten.

Same shape and same skip-if-no-DB behaviour as
`tests/integration/legal_rules/test_api_router.py`.
"""

from __future__ import annotations

from datetime import date
from uuid import UUID, uuid4

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.testclient import TestClient

from src.composition.settings import get_settings

pytestmark = pytest.mark.asyncio

BASE = "/api/v1/personnel"


@pytest.fixture
async def session():  # type: ignore[misc]
    """Прямая сессия для контрактов, у которых нет HTTP-поверхности:
    `get_employee_state_as_of` вызывается расчётом, а не клиентом."""
    engine = create_async_engine(get_settings().database_dsn)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db_session:
        yield db_session
    await engine.dispose()


async def _db_reachable() -> bool:
    try:
        engine = create_async_engine(get_settings().database_dsn)
        async with engine.connect():
            pass
        await engine.dispose()
        return True
    except (OperationalError, OSError):
        # OSError matters: asyncpg raises a bare ConnectionRefusedError when the
        # port is closed, and SQLAlchemy does not wrap OS-level errors in
        # OperationalError — catching only the latter made this check a no-op
        # in exactly the case it exists for. See tests/integration/conftest.py.
        return False


@pytest.fixture
async def client():  # type: ignore[misc]
    if not await _db_reachable():
        pytest.skip(
            "PostgreSQL not reachable — start it with `make up` first (see docker-compose.yml)"
        )

    from src.composition.api_app import app

    with TestClient(app) as test_client:
        yield test_client


def _idem() -> dict[str, str]:
    """Every state-changing operation in `openapi.yaml` requires an
    `Idempotency-Key`. The header is validated but not yet honoured — see
    `personnel/api/router.py`'s docstring — so a fresh one per call is
    correct here, not a workaround."""
    return {"Idempotency-Key": str(uuid4())}


def _create_unit(client: TestClient, *, parent_id: str | None = None) -> dict:  # type: ignore[type-arg]
    body: dict[str, object] = {"code": f"UNIT-{uuid4().hex[:10]}", "name": "ПЧ-тест"}
    if parent_id is not None:
        body["parentUnitId"] = parent_id
    resp = client.post(f"{BASE}/units", json=body, headers=_idem())
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_position(client: TestClient) -> dict:  # type: ignore[type-arg]
    resp = client.post(
        f"{BASE}/positions",
        json={
            "code": f"POS-{uuid4().hex[:10]}",
            "title": "Начальник караула",
            "category": "operational",
            "defaultRegimeType": "twenty_four_hour_duty",
        },
        headers=_idem(),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _register_employee(client: TestClient, unit: dict, position: dict) -> dict:  # type: ignore[type-arg]
    resp = client.post(
        f"{BASE}/employees",
        json={
            "personnelNumber": str(uuid4().int)[:9],
            "fullName": "Иванов Иван Иванович",
            "rank": "майор внутренней службы",
            "legalBase": "fps_service",
            "serviceConditionCategory": "hazardous_or_dangerous",
            "currentPositionId": position["id"],
            "currentUnitId": unit["id"],
            "hiredAt": "2020-03-01",
        },
        headers=_idem(),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_full_employee_lifecycle_over_http(client: TestClient) -> None:
    root = _create_unit(client)
    station = _create_unit(client, parent_id=root["id"])
    position = _create_position(client)

    # The child's ltree path extends the parent's — derived server-side
    # from the parent, never supplied by the caller.
    assert station["hierarchyPath"].startswith(root["hierarchyPath"] + ".")
    assert station["parentUnitId"] == root["id"]

    employee = _register_employee(client, station, position)
    employee_id = employee["id"]
    assert employee["employmentStatus"] == "active"
    assert employee["dismissedAt"] is None

    # Registration opened the service record with the initial assignment.
    history = client.get(f"{BASE}/employees/{employee_id}/service-record-entries")
    assert history.status_code == 200, history.text
    assert [e["eventType"] for e in history.json()] == ["assignment"]

    # --- перевод в другое подразделение, через общий append-эндпоинт
    new_station = _create_unit(client, parent_id=root["id"])
    transfer = client.post(
        f"{BASE}/employees/{employee_id}/service-record-entries",
        json={"eventType": "transfer", "effectiveDate": "2022-01-15", "unitId": new_station["id"]},
        headers=_idem(),
    )
    assert transfer.status_code == 201, transfer.text

    # Recording the transfer MOVED the employee — the history and the
    # current state are one act, not two (see the aggregate).
    moved = client.get(f"{BASE}/employees/{employee_id}").json()
    assert moved["currentUnitId"] == new_station["id"]

    # --- больничный, затем возврат в строй
    for status, effective in (("sick", "2023-02-01"), ("active", "2023-02-20")):
        resp = client.patch(
            f"{BASE}/employees/{employee_id}/status",
            json={"newStatus": status, "effectiveDate": effective, "reason": "по болезни"},
            headers=_idem(),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["employmentStatus"] == status

    # --- увольнение
    dismissal = client.patch(
        f"{BASE}/employees/{employee_id}/status",
        json={
            "newStatus": "dismissed",
            "effectiveDate": "2024-06-30",
            "reason": "по собственному желанию",
        },
        headers=_idem(),
    )
    assert dismissal.status_code == 200, dismissal.text
    assert dismissal.json()["dismissedAt"] == "2024-06-30"

    # --- увольнение терминально (PE003)
    rehire = client.patch(
        f"{BASE}/employees/{employee_id}/status",
        json={"newStatus": "active", "effectiveDate": "2024-08-01", "reason": "восстановление"},
        headers=_idem(),
    )
    assert rehire.status_code == 422, rehire.text
    assert rehire.json()["status"] == 422

    final_history = client.get(f"{BASE}/employees/{employee_id}/service-record-entries").json()
    assert [e["eventType"] for e in final_history] == ["assignment", "transfer", "dismissal"]
    # Ordered by effective_date, and every entry carries its recording time.
    assert [e["effectiveDate"] for e in final_history] == [
        "2020-03-01",
        "2022-01-15",
        "2024-06-30",
    ]
    assert all(e["recordedAt"] for e in final_history)


async def test_listing_employees_filters_by_unit_and_reports_total(client: TestClient) -> None:
    unit = _create_unit(client)
    position = _create_position(client)
    first = _register_employee(client, unit, position)
    second = _register_employee(client, unit, position)

    resp = client.get(f"{BASE}/employees", params={"unitId": unit["id"], "pageSize": 50})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["totalCount"] == 2
    assert {e["id"] for e in body["items"]} == {first["id"], second["id"]}
    assert body["page"] == 1
    assert body["pageSize"] == 50


async def test_duplicate_personnel_number_is_a_conflict(client: TestClient) -> None:
    unit = _create_unit(client)
    position = _create_position(client)
    existing = _register_employee(client, unit, position)

    resp = client.post(
        f"{BASE}/employees",
        json={
            "personnelNumber": existing["personnelNumber"],
            "fullName": "Другой человек",
            "rank": "лейтенант внутренней службы",
            "legalBase": "fps_service",
            "currentPositionId": position["id"],
            "currentUnitId": unit["id"],
            "hiredAt": "2021-01-01",
        },
        headers=_idem(),
    )
    assert resp.status_code == 409, resp.text


async def test_unknown_unit_on_registration_is_a_404(client: TestClient) -> None:
    position = _create_position(client)
    resp = client.post(
        f"{BASE}/employees",
        json={
            "personnelNumber": str(uuid4().int)[:9],
            "fullName": "Никто",
            "rank": "лейтенант внутренней службы",
            "legalBase": "fps_service",
            "currentPositionId": position["id"],
            "currentUnitId": str(uuid4()),
            "hiredAt": "2021-01-01",
        },
        headers=_idem(),
    )
    assert resp.status_code == 404, resp.text


async def test_missing_idempotency_key_is_rejected(client: TestClient) -> None:
    """`openapi.yaml` marks the header `required: true` on every
    state-changing operation. It is not yet honoured for replay
    suppression, but it IS required — a client that omits it is not
    conforming, and silently accepting the request would hide that."""
    resp = client.post(f"{BASE}/units", json={"code": f"U-{uuid4().hex[:8]}", "name": "Без ключа"})
    # 400, а не 422: API_Conventions разд. 3 разводит эти коды по существу —
    # 400 «не проходит JSON Schema валидацию тела/параметров», 422
    # «синтаксически верный запрос нарушает бизнес-инвариант домена».
    # Отсутствующий обязательный заголовок — первое, а не второе.
    assert resp.status_code == 400, resp.text
    assert resp.json()["type"].endswith("/validation-failed")


async def test_service_record_entry_missing_its_payload_is_a_400(client: TestClient) -> None:
    """Mirrors `ck_service_record_payload` (migration 0008): a `rank_change`
    that does not say which rank."""
    unit = _create_unit(client)
    position = _create_position(client)
    employee = _register_employee(client, unit, position)

    resp = client.post(
        f"{BASE}/employees/{employee['id']}/service-record-entries",
        json={"eventType": "rank_change", "effectiveDate": "2023-01-01"},
        headers=_idem(),
    )
    assert resp.status_code == 400, resp.text


# ------------------- состояние на дату (Алгоритм Б шаг 1)


async def test_the_state_as_of_a_past_date_survives_a_later_transfer(
    client: TestClient, session
) -> None:  # type: ignore[no-untyped-def]
    """Правовое требование, а не техническое удобство.

    SRS разд. 4 требует «пересчитать переработку за любой прошлый год»,
    Domain Model инвариант 6.1.5 — чтобы повторный расчёт тех же данных
    дал идентичный результат. Пока категории брались текущими, пересчёт
    марта 2024 после перевода сотрудника с оперативной должности на
    административную тихо давал другую норму: другой `scope` → другая
    `RuleVersion` → другое число, без ошибки и без следа.
    """
    from src.modules.personnel.contracts.get_employee_snapshot_as_of import (
        EmployeeStateUnknownAsOf,
        get_employee_state_as_of,
    )

    operational = client.post(
        f"{BASE}/positions",
        json={
            "code": f"P-OPS-{uuid4().hex[:8]}",
            "title": "Пожарный",
            "category": "operational",
            "defaultRegimeType": "twenty_four_hour_duty",
        },
        headers=_idem(),
    )
    assert operational.status_code == 201, operational.text
    administrative = client.post(
        f"{BASE}/positions",
        json={
            "code": f"P-ADM-{uuid4().hex[:8]}",
            "title": "Инспектор",
            "category": "administrative",
            "defaultRegimeType": "five_day_week",
        },
        headers=_idem(),
    )
    assert administrative.status_code == 201, administrative.text

    unit = client.post(
        f"{BASE}/units",
        json={"code": f"U-ASOF-{uuid4().hex[:8]}", "name": "ПЧ для проверки истории"},
        headers=_idem(),
    )
    assert unit.status_code == 201, unit.text

    employee = client.post(
        f"{BASE}/employees",
        json={
            "personnelNumber": str(uuid4().int)[:9],
            "fullName": "Переводов Перевод Переводович",
            "rank": "прапорщик внутренней службы",
            "legalBase": "fps_service",
            "currentPositionId": operational.json()["id"],
            "currentUnitId": unit.json()["id"],
            "hiredAt": "2024-01-10",
        },
        headers=_idem(),
    )
    assert employee.status_code == 201, employee.text
    employee_id = employee.json()["id"]

    transfer = client.post(
        f"{BASE}/employees/{employee_id}/service-record-entries",
        json={
            "eventType": "transfer",
            "effectiveDate": "2025-06-01",
            "positionId": administrative.json()["id"],
            "unitId": unit.json()["id"],
        },
        headers=_idem(),
    )
    assert transfer.status_code == 201, transfer.text

    # Сегодня сотрудник административный...
    now = await get_employee_state_as_of(
        session, employee_id=UUID(employee_id), as_of=date(2026, 1, 1)
    )
    assert now.position_category == "administrative"
    assert now.regime_type == "five_day_week"

    # ...а в марте 2024 был оперативным, и пересчёт того периода обязан
    # видеть именно это.
    then = await get_employee_state_as_of(
        session, employee_id=UUID(employee_id), as_of=date(2024, 3, 1)
    )
    assert then.position_category == "operational"
    assert then.regime_type == "twenty_four_hour_duty"

    # До приёма на службу состояния нет — и это отказ, а не подстановка
    # текущего: иначе человеку начислялась бы норма за период, когда он
    # ещё не служил.
    with pytest.raises(EmployeeStateUnknownAsOf):
        await get_employee_state_as_of(
            session, employee_id=UUID(employee_id), as_of=date(2023, 1, 1)
        )


async def test_a_rank_change_does_not_erase_the_position(
    client: TestClient, session
) -> None:  # type: ignore[no-untyped-def]
    """Запись `rank_change` не несёт ни должности, ни подразделения (они
    NULL). Брать состояние «из последней записи» значило бы считать, что
    присвоение звания перевело человека в никуда."""
    from src.modules.personnel.contracts.get_employee_snapshot_as_of import (
        get_employee_state_as_of,
    )

    position = client.post(
        f"{BASE}/positions",
        json={
            "code": f"P-RANK-{uuid4().hex[:8]}",
            "title": "Пожарный",
            "category": "operational",
            "defaultRegimeType": "twenty_four_hour_duty",
        },
        headers=_idem(),
    )
    unit = client.post(
        f"{BASE}/units",
        json={"code": f"U-RANK-{uuid4().hex[:8]}", "name": "ПЧ для проверки звания"},
        headers=_idem(),
    )
    employee = client.post(
        f"{BASE}/employees",
        json={
            "personnelNumber": str(uuid4().int)[:9],
            "fullName": "Званиев Звание Званиевич",
            "rank": "сержант внутренней службы",
            "legalBase": "fps_service",
            "currentPositionId": position.json()["id"],
            "currentUnitId": unit.json()["id"],
            "hiredAt": "2024-01-10",
        },
        headers=_idem(),
    )
    assert employee.status_code == 201, employee.text
    employee_id = employee.json()["id"]

    promoted = client.post(
        f"{BASE}/employees/{employee_id}/service-record-entries",
        json={
            "eventType": "rank_change",
            "effectiveDate": "2025-02-01",
            "rank": "старший сержант внутренней службы",
        },
        headers=_idem(),
    )
    assert promoted.status_code == 201, promoted.text

    state = await get_employee_state_as_of(
        session, employee_id=UUID(employee_id), as_of=date(2025, 3, 1)
    )
    assert state.position_category == "operational"
    assert state.rank == "старший сержант внутренней службы"


async def test_the_legal_base_of_a_past_period_survives_a_later_transfer(
    client: TestClient, session
) -> None:  # type: ignore[no-untyped-def]
    """Правовая база — исторический факт (миграция 0020).

    ФЗ-141 и ТК РФ дают разные нормы: у аттестованного состава служебное
    время (ст. 54-55 ФЗ-141), у гражданского персонала рабочее (ст. 91,
    99, 104, 152, 153 ТК РФ). Пересчёт периода, когда человек был
    вольнонаёмным, по нормам ФЗ-141 — это применение к нему закона,
    который тогда на него не распространялся.
    """
    from src.modules.personnel.contracts.get_employee_snapshot_as_of import (
        get_employee_state_as_of,
    )

    position = client.post(
        f"{BASE}/positions",
        json={
            "code": f"P-LB-{uuid4().hex[:8]}",
            "title": "Специалист",
            "category": "administrative",
            "defaultRegimeType": "five_day_week",
        },
        headers=_idem(),
    )
    unit = client.post(
        f"{BASE}/units",
        json={"code": f"U-LB-{uuid4().hex[:8]}", "name": "ПЧ правовой базы"},
        headers=_idem(),
    )

    # Принят вольнонаёмным: ТК РФ.
    employee = client.post(
        f"{BASE}/employees",
        json={
            "personnelNumber": str(uuid4().int)[:9],
            "fullName": "Правовой Базис Базисович",
            # У гражданского персонала специального звания нет; поле
            # обязательно по openapi, поэтому пишется прямо.
            "rank": "без специального звания",
            "legalBase": "labor_code",
            "currentPositionId": position.json()["id"],
            "currentUnitId": unit.json()["id"],
            "hiredAt": "2024-01-10",
        },
        headers=_idem(),
    )
    assert employee.status_code == 201, employee.text
    employee_id = employee.json()["id"]

    # В 2025-м переведён в аттестованный состав: ФЗ-141.
    transfer = client.post(
        f"{BASE}/employees/{employee_id}/service-record-entries",
        json={
            "eventType": "transfer",
            "effectiveDate": "2025-06-01",
            "positionId": position.json()["id"],
            "unitId": unit.json()["id"],
            "legalBase": "fps_service",
        },
        headers=_idem(),
    )
    assert transfer.status_code == 201, transfer.text
    assert transfer.json()["legalBase"] == "fps_service"

    # Карточка отвечает на «кто он сейчас».
    current = client.get(f"{BASE}/employees/{employee_id}")
    assert current.json()["legalBase"] == "fps_service"

    # Летопись — на «кем был тогда».
    then = await get_employee_state_as_of(
        session, employee_id=UUID(employee_id), as_of=date(2024, 3, 1)
    )
    assert then.legal_base == "labor_code"

    now = await get_employee_state_as_of(
        session, employee_id=UUID(employee_id), as_of=date(2026, 1, 1)
    )
    assert now.legal_base == "fps_service"


async def test_a_rank_change_does_not_touch_the_legal_base(
    client: TestClient, session
) -> None:  # type: ignore[no-untyped-def]
    """Присвоение звания правовую базу не устанавливает: колонка в такой
    записи `NULL`, и состояние на дату берётся из последней записи, где
    она заполнена."""
    from src.modules.personnel.contracts.get_employee_snapshot_as_of import (
        get_employee_state_as_of,
    )

    position = client.post(
        f"{BASE}/positions",
        json={
            "code": f"P-LBR-{uuid4().hex[:8]}",
            "title": "Пожарный",
            "category": "operational",
            "defaultRegimeType": "twenty_four_hour_duty",
        },
        headers=_idem(),
    )
    unit = client.post(
        f"{BASE}/units",
        json={"code": f"U-LBR-{uuid4().hex[:8]}", "name": "ПЧ звания"},
        headers=_idem(),
    )
    employee = client.post(
        f"{BASE}/employees",
        json={
            "personnelNumber": str(uuid4().int)[:9],
            "fullName": "Званиев Звание Званиевич",
            "rank": "сержант внутренней службы",
            "legalBase": "fps_service",
            "currentPositionId": position.json()["id"],
            "currentUnitId": unit.json()["id"],
            "hiredAt": "2024-01-10",
        },
        headers=_idem(),
    )
    employee_id = employee.json()["id"]

    promoted = client.post(
        f"{BASE}/employees/{employee_id}/service-record-entries",
        json={
            "eventType": "rank_change",
            "effectiveDate": "2025-02-01",
            "rank": "старший сержант внутренней службы",
        },
        headers=_idem(),
    )
    assert promoted.status_code == 201, promoted.text
    assert promoted.json()["legalBase"] is None

    state = await get_employee_state_as_of(
        session, employee_id=UUID(employee_id), as_of=date(2025, 3, 1)
    )
    assert state.legal_base == "fps_service"
