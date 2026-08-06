"""LM006 — одноразовость `personal_circumstances_20y`.

DoD задачи: «повторная попытка выдачи отклоняется».

Отпуск по личным обстоятельствам при стаже 20 лет и более (ФЗ-141 ст. 64
ч. 1 п. 2) даётся ОДИН РАЗ за весь период службы, и проверка эта
межагрегатная: нужна вся история предоставлений, а не состояние
создаваемого.

Здесь же проверяется вторая половина инварианта 9.1.1 — присоединение
смежных отпусков, — потому что она про ту же границу: `daterange` с `[)`
и различает наложение от стыка.
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import text
from starlette.testclient import TestClient

from tests.integration.leave_management.conftest import (
    create_employee,
    db_reachable,
    grant_leave,
)

pytestmark = pytest.mark.asyncio


async def test_the_once_per_service_leave_is_refused_the_second_time(
    client: TestClient, entitlement_rules
) -> None:  # type: ignore[no-untyped-def]
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = create_employee(client)

    first = grant_leave(
        client,
        employee,
        leave_type="personal_circumstances_20y",
        start="2026-03-01",
        end="2026-03-31",
    )
    assert first.status_code == 201, first.text

    # Другие даты, тот же вид — и всё равно отказ: право расходуется
    # навсегда, а не на период.
    second = grant_leave(
        client,
        employee,
        leave_type="personal_circumstances_20y",
        start="2027-06-01",
        end="2027-06-30",
    )
    assert second.status_code == 422, second.text
    assert second.headers["content-type"].startswith("application/problem+json")
    assert "один раз" in second.json()["detail"]


async def test_another_employee_is_unaffected(
    client: TestClient, entitlement_rules
) -> None:  # type: ignore[no-untyped-def]
    """Право одноразовое у каждого своё: индекс частичный ПО СОТРУДНИКУ."""
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    first_employee = create_employee(client)
    second_employee = create_employee(client)

    assert (
        grant_leave(
            client,
            first_employee,
            leave_type="personal_circumstances_20y",
            start="2026-03-01",
            end="2026-03-31",
        ).status_code
        == 201
    )
    assert (
        grant_leave(
            client,
            second_employee,
            leave_type="personal_circumstances_20y",
            start="2026-03-01",
            end="2026-03-31",
        ).status_code
        == 201
    )


async def test_the_database_refuses_a_duplicate_bypassing_the_service(
    client: TestClient, entitlement_rules, session
) -> None:  # type: ignore[no-untyped-def]
    """DoD DB018 дословно: «повторная вставка `personal_circumstances_20y`
    для `employee_id` падает по частичному индексу».

    Проверка доменным сервисом — первое слово, индекс — последнее: два
    приказа, оформленных одновременно, увидели бы одинаковое «ещё не
    выдавался».
    """
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = create_employee(client)
    first = grant_leave(
        client,
        employee,
        leave_type="personal_circumstances_20y",
        start="2026-03-01",
        end="2026-03-31",
    )
    assert first.status_code == 201, first.text
    basis = first.json()["entitlementBasisRuleVersionId"]

    with pytest.raises(Exception, match="uq_leave_personal_circumstances_once"):
        await session.execute(
            text(
                "INSERT INTO leave_management.leave_grant "
                "(id, employee_id, leave_type, leave_period, "
                " entitlement_basis_rule_version_id, entitled_days, status) "
                "VALUES (gen_random_uuid(), :employee, 'personal_circumstances_20y', "
                " daterange(:start, :end, '[)'), :basis, 30, 'active')"
            ),
            {
                "employee": employee,
                "start": date(2028, 1, 1),
                "end": date(2028, 1, 31),
                "basis": basis,
            },
        )
    await session.rollback()


# --------------------------------------------- инвариант 9.1.1 через HTTP


async def test_adjacent_leaves_are_both_granted(
    client: TestClient, entitlement_rules
) -> None:  # type: ignore[no-untyped-def]
    """Присоединение: основной отпуск по 14 марта включительно и
    дополнительный с 15-го.

    Приказ МЧС России № 410 п. 12 прямо допускает присоединение
    дополнительных дней отдыха к ежегодному отпуску, ФЗ-141 ст. 63 —
    соединение частей. Граница `[)` делает это возможным без особого
    режима.
    """
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = create_employee(client)

    first = grant_leave(client, employee, start="2026-03-01", end="2026-03-15")
    assert first.status_code == 201, first.text

    second = grant_leave(
        client, employee, leave_type="additional", start="2026-03-15", end="2026-03-20"
    )
    assert second.status_code == 201, second.text


async def test_an_overlapping_leave_is_409(
    client: TestClient, entitlement_rules
) -> None:  # type: ignore[no-untyped-def]
    """DoD LM005: «пересечение с существующим отпуском возвращает 409».

    Граница на день левее предыдущего теста — и 15 марта попадает в оба
    отпуска.
    """
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = create_employee(client)

    assert grant_leave(client, employee, start="2026-03-01", end="2026-03-16").status_code == 201

    overlapping = grant_leave(
        client, employee, leave_type="additional", start="2026-03-15", end="2026-03-20"
    )
    assert overlapping.status_code == 409, overlapping.text
    assert "пересекается" in overlapping.json()["detail"]


async def test_a_cancelled_style_conflict_names_the_other_leave(
    client: TestClient, entitlement_rules
) -> None:
    """Отказ называет конкретный мешающий отпуск, а не имя ограничения:
    кадровику нужно знать, какой приказ переносить."""
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    employee = create_employee(client)
    assert grant_leave(client, employee, start="2026-05-01", end="2026-05-20").status_code == 201

    conflict = grant_leave(client, employee, start="2026-05-10", end="2026-05-25")
    assert conflict.status_code == 409, conflict.text
    detail = conflict.json()["detail"]
    assert "2026-05-01" in detail and "2026-05-20" in detail


# ------------------------------------------------------- продолжительность


async def test_the_entitlement_depends_on_seniority(
    client: TestClient, entitlement_rules
) -> None:  # type: ignore[no-untyped-def]
    """DoD LM004: «продолжительность зависит от стажа и действующей
    `RuleVersion`».

    Два сотрудника, разная дата приёма — разное число дней, и оба числа
    пришли из правил, а не из кода.
    """
    if not await db_reachable():
        pytest.skip("PostgreSQL не запущена — `make up`")

    veteran = create_employee(client, hired_at="2000-01-01")
    novice = create_employee(client, hired_at="2024-01-01")

    veteran_grant = grant_leave(client, veteran, start="2026-03-01", end="2026-03-21")
    novice_grant = grant_leave(client, novice, start="2026-03-01", end="2026-03-21")

    assert veteran_grant.status_code == 201, veteran_grant.text
    assert novice_grant.status_code == 201, novice_grant.text

    assert veteran_grant.json()["entitledDays"] == 45
    assert veteran_grant.json()["seniorityYears"] == 26
    assert novice_grant.json()["entitledDays"] == 30
    assert novice_grant.json()["seniorityYears"] == 2
