"""SD007 — юнит-тесты `RestPeriodPolicyService`, включая стык периодов.

Без БД и без `legal_rules`: резолвер правила подсовывается функцией — это
и есть смысл инъекции, ради которой сервис не импортирует чужой модуль.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from src.modules.scheduling.application.services.rest_period_policy import (
    RestPeriodPolicyService,
)
from src.modules.scheduling.domain.errors import MinimumRestPeriodViolationError
from src.modules.scheduling.domain.value_objects import TimeInterval

pytestmark = pytest.mark.asyncio

EMPLOYEE = uuid4()
SCOPE = {"legalBase": "fps_service"}


def _service(minimum_hours: float) -> RestPeriodPolicyService:
    async def resolve(as_of, scope):  # type: ignore[no-untyped-def]
        assert scope == SCOPE, "scope доходит до резолвера неизменённым"
        return minimum_hours

    return RestPeriodPolicyService(resolve)


def _interval(day: int, hour: int, hours: int, *, month: int = 3) -> TimeInterval:
    start = datetime(2026, month, day, hour, tzinfo=UTC)
    return TimeInterval(start=start, end=start + timedelta(hours=hours))


async def test_sufficient_rest_passes() -> None:
    previous = _interval(2, 8, 24)          # до 3 марта 08:00
    candidate = _interval(5, 8, 24)         # через 48 ч
    await _service(24).ensure_rest_before(
        employee_id=EMPLOYEE, candidate=candidate, existing_shifts=[previous], scope=SCOPE
    )


async def test_a_shift_starting_before_the_rest_elapsed_is_rejected() -> None:
    """DoD SD007: «Смена раньше минимального отдыха после предыдущей
    отклоняется»."""
    previous = _interval(2, 8, 24)          # до 3 марта 08:00
    candidate = _interval(3, 20, 24)        # через 12 ч при минимуме 24
    with pytest.raises(MinimumRestPeriodViolationError, match="12.00 ч"):
        await _service(24).ensure_rest_before(
            employee_id=EMPLOYEE, candidate=candidate, existing_shifts=[previous], scope=SCOPE
        )


async def test_rest_exactly_equal_to_the_minimum_passes() -> None:
    previous = _interval(2, 8, 24)          # до 3 марта 08:00
    candidate = _interval(4, 8, 24)         # ровно 24 ч спустя
    await _service(24).ensure_rest_before(
        employee_id=EMPLOYEE, candidate=candidate, existing_shifts=[previous], scope=SCOPE
    )


async def test_rest_is_checked_on_BOTH_sides_of_the_new_shift() -> None:
    """График дополняется и задним числом. Проверять только предыдущую
    смену — ошибка, дающая ложное «всё в порядке» ровно тогда, когда новая
    смена вставлена перед уже существующей."""
    following = _interval(5, 8, 24)         # уже есть, начинается 5 марта 08:00
    candidate = _interval(4, 8, 12)         # кончается 4 марта 20:00 → всего 12 ч отдыха

    with pytest.raises(MinimumRestPeriodViolationError, match="следующей"):
        await _service(24).ensure_rest_before(
            employee_id=EMPLOYEE, candidate=candidate, existing_shifts=[following], scope=SCOPE
        )


async def test_rest_across_a_period_boundary_is_checked() -> None:
    """Инвариант 5.1.2 существует прежде всего ради этого случая: смена
    последнего дня марта и смена первого дня апреля принадлежат РАЗНЫМ
    агрегатам, поэтому увидеть их вместе может только этот сервис."""
    march_last = _interval(31, 20, 24)              # до 1 апреля 20:00
    april_first = _interval(2, 8, 24, month=4)      # 2 апреля 08:00 → всего 12 ч

    with pytest.raises(MinimumRestPeriodViolationError):
        await _service(24).ensure_rest_before(
            employee_id=EMPLOYEE,
            candidate=april_first,
            existing_shifts=[march_last],
            scope=SCOPE,
        )


async def test_the_first_shift_of_an_employee_has_nothing_to_violate() -> None:
    await _service(24).ensure_rest_before(
        employee_id=EMPLOYEE, candidate=_interval(2, 8, 24), existing_shifts=[], scope=SCOPE
    )


async def test_the_minimum_comes_from_the_rule_not_from_a_constant() -> None:
    """«Rule → Calculation → Employee»: величина отдыха — данные
    `RuleVersion`, а не константа в коде. Тот же зазор проходит при одном
    правиле и отклоняется при другом."""
    previous = _interval(2, 8, 24)
    candidate = _interval(4, 0, 24)         # 16 ч отдыха

    await _service(12).ensure_rest_before(
        employee_id=EMPLOYEE, candidate=candidate, existing_shifts=[previous], scope=SCOPE
    )
    with pytest.raises(MinimumRestPeriodViolationError):
        await _service(24).ensure_rest_before(
            employee_id=EMPLOYEE, candidate=candidate, existing_shifts=[previous], scope=SCOPE
        )


async def test_the_rule_is_resolved_as_of_the_shift_date() -> None:
    """Правило берётся на дату СМЕНЫ, а не на дату расчёта (Принцип 0.2) —
    иначе график, составленный сегодня на прошлый период, проверялся бы по
    сегодняшней норме отдыха."""
    seen: list[object] = []

    async def resolve(as_of, scope):  # type: ignore[no-untyped-def]
        seen.append(as_of)
        return 24.0

    candidate = _interval(4, 8, 24)
    await RestPeriodPolicyService(resolve).ensure_rest_before(
        employee_id=EMPLOYEE,
        candidate=candidate,
        existing_shifts=[_interval(2, 8, 24)],
        scope=SCOPE,
    )
    assert seen == [candidate.start.date()]
