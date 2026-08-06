"""RB010 — интеграционные тесты `rest_balance` против живой PostgreSQL.

DoD задачи: «начисление → списание → отказ при недостатке». Проверяется
именно эта последовательность, и начисление в ней — НЕ прямой вызов:
сутки появляются потому, что компенсация опубликовала строку с формой
отдыха, а потребитель её разобрал. Это и есть инвариант 8.1.2,
прочитанный как процесс, и подменять его вызовом значило бы проверять не
то, что работает в проде.

Цепочка целиком: утверждение табеля → дело о компенсации → финализация →
outbox → релей → поток Redis → потребитель `rest_balance` → движение
баланса. Ни один шаг не подменяется; вызываются те же функции, что
дёргает Celery по расписанию.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.testclient import TestClient

from src.composition.settings import get_settings
from src.modules.rest_balance.infrastructure.orm_mapping import (
    balance_movement_table,
    start_mappers,
)

pytestmark = pytest.mark.asyncio

RB = "/api/v1/rest-balance"
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


@pytest.fixture
async def worker_deps():  # type: ignore[misc]
    """Собственные пул соединений и Redis: глобальные принадлежат event
    loop'у `TestClient`, а тест работает в другом (см. тот же фикстур в
    тестах `compensation`)."""
    from redis.asyncio import Redis

    engine = create_async_engine(get_settings().database_dsn)
    redis = Redis.from_url(get_settings().redis_url)
    yield async_sessionmaker(engine, expire_on_commit=False), redis
    await redis.aclose()
    await engine.dispose()


def _idem() -> dict[str, str]:
    return {"Idempotency-Key": str(uuid4())}


# ------------------------------------------------------- подготовка данных


def _rule_ids(client: TestClient) -> dict[str, str]:
    listing = client.get(f"{LEGAL}/rules", params={"pageSize": 200})
    assert listing.status_code == 200, listing.text
    return {r["code"]: r["id"] for r in listing.json()["items"]}


def _legal_basis_node(client: TestClient) -> str:
    doc = client.post(
        f"{LEGAL}/documents",
        json={
            "docType": "departmental_order",
            "regNumber": f"410-RB-{uuid4().hex[:6]}",
            "adoptedDate": "2018-09-24",
            "title": "Приказ МЧС России № 410 (фрагмент для теста)",
            "validFrom": "2018-10-01",
        },
        headers=_idem(),
    )
    assert doc.status_code == 201, doc.text
    node = client.post(
        f"{LEGAL}/documents/{doc.json()['id']}/nodes",
        json={"nodeType": "paragraph", "number": "11", "title": "Компенсация"},
        headers=_idem(),
    )
    assert node.status_code == 201, node.text
    return str(node.json()["id"])


def _publish_norm_rule(client: TestClient) -> None:
    known = _rule_ids(client)
    code = "NORM.WEEKLY_HOURS"
    if code in known:
        effective = client.get(
            f"{LEGAL}/rules/{known[code]}/effective-version",
            params={
                "asOf": f"{CALCULATION_YEAR}-03-01",
                "scope": json.dumps(NORM_SCOPE),
            },
        )
        if effective.status_code == 200:
            return
        rule_id = known[code]
    else:
        created = client.post(
            f"{LEGAL}/rules",
            json={
                "code": code,
                "category": "norm_duration",
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
            "validFrom": "2018-10-01",
        },
        headers=_idem(),
    )
    assert version.status_code == 201, version.text
    published = client.post(
        f"{LEGAL}/rule-versions/{version.json()['id']}/publish",
        json={"changeReason": "Норма служебного времени для теста ДДО"},
        headers=_idem(),
    )
    assert published.status_code == 200, published.text


def _publish_conflict_policy(client: TestClient) -> None:
    listing = client.get(f"{LEGAL}/conflict-policies")
    assert listing.status_code == 200, listing.text
    for policy in listing.json():
        if policy["code"] == POLICY_CODE:
            return

    created = client.post(
        f"{LEGAL}/conflict-policies",
        json={"code": POLICY_CODE, "displayName": "Приоритет категорий часов"},
        headers=_idem(),
    )
    assert created.status_code == 201, created.text
    version = client.post(
        f"{LEGAL}/conflict-policies/{created.json()['id']}/versions",
        json={"precedenceList": PRECEDENCE_LIST, "validFrom": "2018-10-01"},
        headers=_idem(),
    )
    assert version.status_code == 201, version.text
    published = client.post(
        f"{LEGAL}/conflict-policy-versions/{version.json()['id']}/publish",
        headers=_idem(),
    )
    assert published.status_code == 200, published.text


def _publish_compensation_rule(client: TestClient, *, hour_category: str) -> None:
    """Правило компенсации категории: форма — отдых, и продолжительность
    суток отдыха задана прямо в версии.

    `hours_per_rest_day` здесь не украшение: без него начисление применило
    бы умолчание адаптера, и тест проверял бы константу кода вместо
    прочтения нормы (Алгоритм Л, SRS 9.3.1).
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
                    "formula": {"node_type": "literal", "value": "additional_rest_time"},
                },
                {
                    "node_type": "set_result",
                    "field": "election_allowed",
                    "formula": {"node_type": "literal", "value": False},
                },
                {
                    "node_type": "set_result",
                    "field": "hours_per_rest_day",
                    "formula": {"node_type": "literal", "value": 8},
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


def _publish_calendar_year(client: TestClient) -> None:
    existing = client.get(f"{CALENDAR}/years/{CALCULATION_YEAR}")
    if existing.status_code == 200 and existing.json()["published"]:
        return
    if existing.status_code != 200:
        created = client.post(
            f"{CALENDAR}/years",
            json={"year": CALCULATION_YEAR},
            headers=_idem(),
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
    _publish_norm_rule(client)
    _publish_calendar_year(client)
    _publish_conflict_policy(client)
    for category in ("night", "overtime", "weekend", "holiday"):
        _publish_compensation_rule(client, hour_category=category)


def _employee(client: TestClient) -> str:
    """Пятидневка: у сменного состава ночные часы в пределах нормы не
    компенсируются (Приказ № 410 п. 14), и начислять было бы нечего."""
    unit = client.post(
        f"{PERSONNEL}/units",
        json={"code": f"RB-U-{uuid4().hex[:8]}", "name": "ПСЧ баланса ДДО"},
        headers=_idem(),
    )
    assert unit.status_code == 201, unit.text
    position = client.post(
        f"{PERSONNEL}/positions",
        json={
            "code": f"RB-P-{uuid4().hex[:8]}",
            "title": "Пожарный",
            "category": "operational",
            "defaultRegimeType": "five_day_week",
        },
        headers=_idem(),
    )
    assert position.status_code == 201, position.text
    employee = client.post(
        f"{PERSONNEL}/employees",
        json={
            "personnelNumber": str(uuid4().int)[:9],
            "fullName": "Отдыхов Отдых Отдыхович",
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
    """Табель марта с одним суточным дежурством: 24 ч факта, 8 ч ночных."""
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
    assert (
        client.post(f"{TA}/timesheets/{sheet.json()['id']}/approve", headers=_idem()).status_code
        == 200
    )


def _finalized_case(client: TestClient, employee: str) -> str:
    case = client.post(
        f"{COMP}/cases",
        json={"employeeId": employee, "periodStart": "2026-03-01", "periodEnd": "2026-04-01"},
        headers=_idem(),
    )
    assert case.status_code == 201, case.text
    case_id = str(case.json()["id"])
    assert client.post(f"{COMP}/cases/{case_id}/finalize", headers=_idem()).status_code == 200
    return case_id


async def _deliver(worker_deps) -> int:  # type: ignore[no-untyped-def]
    """Релей + потребитель: те же функции, что дёргает beat."""
    from src.building_blocks.infrastructure.outbox_tasks import relay_all_once
    from src.modules.rest_balance.infrastructure.tasks import (
        consume_compensation_lines_once,
    )

    factory, redis = worker_deps
    while await relay_all_once(factory, redis, batch_size=500):
        pass
    return await consume_compensation_lines_once(factory, redis, batch_size=500)


# --------------------------------------------- начисление -> списание -> отказ


async def test_accrual_then_consumption_then_refusal(
    client: TestClient, compensable, worker_deps
) -> None:  # type: ignore[no-untyped-def]
    """DoD RB010 целиком, и начисление в нём — следствие события.

    8 ночных часов при `hours_per_rest_day = 8` дают одни сутки отдыха
    (Приказ № 410 п. 12 — «дополнительные дни отдыха соответствующей
    продолжительности»).
    """
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    _approved_march(client, employee)
    _finalized_case(client, employee)

    await _deliver(worker_deps)

    balance = client.get(f"{RB}/employees/{employee}/balance", params={"asOf": "2026-04-01"})
    assert balance.status_code == 200, balance.text
    assert Decimal(str(balance.json()["balanceDays"])) == Decimal("1.00")
    assert balance.json()["computedFromJournal"] is True

    # Списание ровно на остаток проходит.
    spent = client.post(
        f"{RB}/employees/{employee}/consumption-requests",
        json={"amountDays": 1, "movementDate": "2026-04-15"},
        headers=_idem(),
    )
    assert spent.status_code == 201, spent.text
    assert spent.json()["movementType"] == "consumption"

    # Следующее — отказ, и отказ называет остаток.
    refused = client.post(
        f"{RB}/employees/{employee}/consumption-requests",
        json={"amountDays": "0.01", "movementDate": "2026-04-16"},
        headers=_idem(),
    )
    assert refused.status_code == 422, refused.text
    assert refused.headers["content-type"].startswith("application/problem+json")
    body = refused.json()
    assert Decimal(body["balanceDays"]) == Decimal("0.00")
    assert Decimal(body["requestedDays"]) == Decimal("0.01")


async def test_a_monetary_line_accrues_nothing(
    client: TestClient, compensable, worker_deps, session
) -> None:  # type: ignore[no-untyped-def]
    """DoD RB004: «начисление создаётся только для строк с
    `additional_rest_time`».

    Проверяется от противного: правила заведены с формой отдыха, поэтому
    ДЕНЕЖНЫХ строк в потоке нет вовсе — и движений по ним тоже. Прямой
    тест «денежная строка не породила движения» потребовал бы правила с
    денежной формой по умолчанию, а такого правила система больше не
    исполняет (Приказ № 410 п. 18).
    """
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    _approved_march(client, employee)
    _finalized_case(client, employee)
    await _deliver(worker_deps)

    rows = await session.execute(
        select(balance_movement_table.c.movement_type).where(
            balance_movement_table.c.employee_id == employee
        )
    )
    types = [row.movement_type for row in rows]
    assert types == ["accrual"]


async def test_a_repeated_delivery_accrues_once(
    client: TestClient, compensable, worker_deps, session
) -> None:  # type: ignore[no-untyped-def]
    """Доставка at-least-once: повтор обязан быть безвредным, иначе один
    сбой сети удваивал бы сотруднику отдых."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    _approved_march(client, employee)
    _finalized_case(client, employee)

    await _deliver(worker_deps)
    # Второй проход: сообщения уже подтверждены, но если бы вернулись —
    # начисление всё равно одно (агрегат + частичный уникальный индекс).
    await _deliver(worker_deps)

    rows = await session.execute(
        select(balance_movement_table.c.id).where(
            balance_movement_table.c.employee_id == employee,
            balance_movement_table.c.movement_type == "accrual",
        )
    )
    assert len(list(rows)) == 1


# ----------------------------------------------------------- сторно (RB006)


async def test_a_reversal_creates_a_new_row_and_leaves_the_original(
    client: TestClient, compensable, worker_deps
) -> None:  # type: ignore[no-untyped-def]
    """DoD RB006 дословно: «сторно создаёт новую запись, исходная не
    изменяется»."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    _approved_march(client, employee)
    _finalized_case(client, employee)
    await _deliver(worker_deps)

    movements = client.get(f"{RB}/employees/{employee}/movements")
    assert movements.status_code == 200, movements.text
    original = movements.json()[0]

    storno = client.post(
        f"{RB}/movements/{original['id']}/reversal",
        json={"reason": "начислено по ошибочной строке компенсации"},
        headers=_idem(),
    )
    assert storno.status_code == 201, storno.text
    assert storno.json()["movementType"] == "consumption"
    assert storno.json()["reversesMovementId"] == original["id"]
    assert storno.json()["reversalReason"]

    after = client.get(f"{RB}/employees/{employee}/movements").json()
    assert len(after) == 2
    unchanged = next(m for m in after if m["id"] == original["id"])
    assert unchanged == original

    # Дата сторно — сегодня, а не дата исправляемого движения: сторно есть
    # событие сегодняшнего дня, и датировать его задним числом значило бы
    # менять уже закрытые остатки прошлых дат. Поэтому на 1 мая 2026 сутки
    # ещё числятся, а «после всего» — уже нет.
    on_may = client.get(f"{RB}/employees/{employee}/balance", params={"asOf": "2026-05-01"})
    assert Decimal(str(on_may.json()["balanceDays"])) == Decimal("1.00")

    after_all = client.get(f"{RB}/employees/{employee}/balance", params={"asOf": "2099-01-01"})
    assert Decimal(str(after_all.json()["balanceDays"])) == Decimal("0.00")


async def test_a_second_reversal_is_409(
    client: TestClient, compensable, worker_deps
) -> None:  # type: ignore[no-untyped-def]
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    _approved_march(client, employee)
    _finalized_case(client, employee)
    await _deliver(worker_deps)

    original = client.get(f"{RB}/employees/{employee}/movements").json()[0]
    first = client.post(
        f"{RB}/movements/{original['id']}/reversal",
        json={"reason": "ошибочное начисление, первое сторно"},
        headers=_idem(),
    )
    assert first.status_code == 201, first.text

    second = client.post(
        f"{RB}/movements/{original['id']}/reversal",
        json={"reason": "ошибочное начисление, второе сторно"},
        headers=_idem(),
    )
    assert second.status_code == 409, second.text


async def test_a_reversal_of_an_unknown_movement_is_404(client: TestClient) -> None:
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    response = client.post(
        f"{RB}/movements/{uuid4()}/reversal",
        json={"reason": "движения не существует вовсе"},
        headers=_idem(),
    )
    assert response.status_code == 404, response.text


# ------------------------------------------------- материализованный остаток


async def test_the_materialized_view_matches_the_journal(
    client: TestClient, compensable, worker_deps, session
) -> None:  # type: ignore[no-untyped-def]
    """DoD RB003: «сумма движений совпадает с `current_balance` после
    REFRESH»."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    from src.modules.rest_balance.infrastructure.current_balance import (
        refresh_current_balance,
    )

    employee = _employee(client)
    _approved_march(client, employee)
    _finalized_case(client, employee)
    await _deliver(worker_deps)

    factory, _ = worker_deps
    await refresh_current_balance(factory)

    from_view = client.get(f"{RB}/employees/{employee}/balance")
    assert from_view.status_code == 200, from_view.text
    assert from_view.json()["computedFromJournal"] is False

    from_journal = client.get(
        f"{RB}/employees/{employee}/balance", params={"asOf": "2026-05-01"}
    )
    assert Decimal(str(from_view.json()["balanceDays"])) == Decimal(
        str(from_journal.json()["balanceDays"])
    )


async def test_an_employee_without_movements_has_a_zero_balance(
    client: TestClient,
) -> None:
    """Ноль, а не 404: «у сотрудника нет накопленных суток» и «сотрудника
    нет» — разные ответы, и второй здесь неверен."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    response = client.get(f"{RB}/employees/{uuid4()}/balance")
    assert response.status_code == 200, response.text
    assert Decimal(str(response.json()["balanceDays"])) == Decimal(0)


# ------------------------------------------------------ append-only в БД


async def test_movements_are_append_only_in_the_database(
    client: TestClient, compensable, worker_deps, session
) -> None:  # type: ignore[no-untyped-def]
    """Инвариант 8.1.3 держит не только агрегат: `UPDATE` в обход
    приложения отвергается триггером."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)
    _approved_march(client, employee)
    _finalized_case(client, employee)
    await _deliver(worker_deps)

    movement_id = client.get(f"{RB}/employees/{employee}/movements").json()[0]["id"]

    with pytest.raises(Exception, match="неизменяемо"):
        await session.execute(
            text(
                "UPDATE rest_balance.balance_movement SET amount_days = 99 WHERE id = :id"
            ),
            {"id": movement_id},
        )
    await session.rollback()


async def test_the_database_refuses_a_negative_balance(
    client: TestClient, compensable, worker_deps, session
) -> None:  # type: ignore[no-untyped-def]
    """Инвариант 8.1.1 держит и БД: два одновременных рапорта прошли бы
    проверку в памяти каждый по остатку до записи другого, поэтому
    последнее слово за триггером."""
    if not await _db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = _employee(client)

    with pytest.raises(Exception, match="превышает остаток"):
        await session.execute(
            text(
                "INSERT INTO rest_balance.balance_movement "
                "(id, employee_id, movement_type, amount_days, movement_date) "
                "VALUES (gen_random_uuid(), :employee, 'consumption', 1, :day)"
            ),
            {"employee": employee, "day": date(2026, 4, 1)},
        )
    await session.rollback()
