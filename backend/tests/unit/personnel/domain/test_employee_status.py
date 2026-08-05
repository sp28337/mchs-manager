"""PE003 — unit tests for the `EmploymentStatus` state machine.

Zero DB, zero HTTP — pure domain (Architecture разд. 14: "Domain |
Модульные тесты агрегатов/инвариантов — чистые объекты, без фейков").
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

import pytest

from src.modules.personnel.domain.employee import Employee
from src.modules.personnel.domain.errors import (
    EmployeeDismissedError,
    InvalidEmploymentStatusTransitionError,
    ServiceRecordBackdatedError,
)
from src.modules.personnel.domain.events import EmploymentStatusChanged
from src.modules.personnel.domain.value_objects import (
    EmploymentStatus,
    LegalBase,
    ServiceConditionCategory,
    ServiceRecordEventType,
)

NOW = datetime.now(UTC)
HIRED_AT = date(2020, 3, 1)


def _employee(**overrides: object) -> Employee:
    kwargs: dict[str, object] = {
        "personnel_number": "123456",
        "full_name": "Иванов Иван Иванович",
        "rank": "майор внутренней службы",
        "legal_base": LegalBase.FPS_SERVICE,
        "service_condition_category": ServiceConditionCategory.HAZARDOUS_OR_DANGEROUS,
        "position_id": uuid4(),
        "unit_id": uuid4(),
        "hired_at": HIRED_AT,
        "now": NOW,
    }
    kwargs.update(overrides)
    return Employee.register(**kwargs)  # type: ignore[arg-type]


def _move(employee: Employee, status: EmploymentStatus, when: date = date(2024, 5, 1)) -> None:
    employee.change_employment_status(
        new_status=status, effective_date=when, reason="плановое изменение", now=NOW
    )


# --------------------------------------------------------------- happy paths


@pytest.mark.parametrize(
    "target",
    [
        EmploymentStatus.ON_LEAVE,
        EmploymentStatus.SICK,
        EmploymentStatus.SUSPENDED,
        EmploymentStatus.DISMISSED,
    ],
)
def test_active_can_move_to_every_other_status(target: EmploymentStatus) -> None:
    employee = _employee()
    _move(employee, target)
    assert employee.employment_status == target


@pytest.mark.parametrize(
    ("start", "target"),
    [
        (EmploymentStatus.ON_LEAVE, EmploymentStatus.ACTIVE),
        (EmploymentStatus.ON_LEAVE, EmploymentStatus.SICK),
        (EmploymentStatus.SICK, EmploymentStatus.ACTIVE),
        (EmploymentStatus.SICK, EmploymentStatus.ON_LEAVE),
        (EmploymentStatus.SUSPENDED, EmploymentStatus.ACTIVE),
    ],
)
def test_permitted_transitions(start: EmploymentStatus, target: EmploymentStatus) -> None:
    employee = _employee()
    _move(employee, start)
    _move(employee, target, when=date(2024, 6, 1))
    assert employee.employment_status == target


# ------------------------------------------------------------------ refusals


def test_dismissed_to_active_is_rejected() -> None:
    """The DoD case for PE003: увольнение терминально."""
    employee = _employee()
    _move(employee, EmploymentStatus.DISMISSED)

    with pytest.raises(InvalidEmploymentStatusTransitionError):
        _move(employee, EmploymentStatus.ACTIVE, when=date(2024, 7, 1))


@pytest.mark.parametrize(
    "target",
    [
        EmploymentStatus.ACTIVE,
        EmploymentStatus.ON_LEAVE,
        EmploymentStatus.SICK,
        EmploymentStatus.SUSPENDED,
    ],
)
def test_dismissed_is_terminal_for_every_target(target: EmploymentStatus) -> None:
    employee = _employee()
    _move(employee, EmploymentStatus.DISMISSED)

    with pytest.raises(InvalidEmploymentStatusTransitionError):
        _move(employee, target, when=date(2024, 7, 1))


def test_suspended_cannot_go_on_leave() -> None:
    """Отстранение — не отпуск: a disciplinary state may only end by
    returning to duty or by dismissal (see `_ALLOWED_TRANSITIONS`)."""
    employee = _employee()
    _move(employee, EmploymentStatus.SUSPENDED)

    with pytest.raises(InvalidEmploymentStatusTransitionError):
        _move(employee, EmploymentStatus.ON_LEAVE, when=date(2024, 6, 1))


def test_status_change_effective_before_hire_date_is_rejected() -> None:
    employee = _employee()
    with pytest.raises(ServiceRecordBackdatedError):
        _move(employee, EmploymentStatus.SICK, when=date(2019, 1, 1))


# --------------------------------------------------------------- side effects


def test_repeating_the_current_status_is_a_no_op_not_an_error() -> None:
    """An idempotent retry of the same PATCH (API_Conventions разд. 5) must
    not blow up — and must not emit a second event either."""
    employee = _employee()
    _move(employee, EmploymentStatus.SICK)
    employee.pull_pending_events()

    _move(employee, EmploymentStatus.SICK, when=date(2024, 6, 1))

    assert employee.employment_status == EmploymentStatus.SICK
    assert employee.pull_pending_events() == []


def test_dismissal_sets_dismissed_at_and_appends_a_dismissal_record() -> None:
    """`ck_employee_dismissed` (migration 0007) is bidirectional — status and
    date must move together or the row will not persist at all."""
    employee = _employee()
    _move(employee, EmploymentStatus.DISMISSED, when=date(2024, 5, 1))

    assert employee.dismissed_at == date(2024, 5, 1)
    assert employee.service_record[-1].event_type == ServiceRecordEventType.DISMISSAL
    assert employee.service_record[-1].effective_date == date(2024, 5, 1)


def test_status_change_raises_domain_event_with_both_ends_of_the_transition() -> None:
    employee = _employee()
    employee.pull_pending_events()  # drop EmployeeRegistered

    _move(employee, EmploymentStatus.SICK)

    events = employee.pull_pending_events()
    assert len(events) == 1
    event = events[0]
    assert isinstance(event, EmploymentStatusChanged)
    assert event.previous_status == EmploymentStatus.ACTIVE
    assert event.new_status == EmploymentStatus.SICK


def test_dismissed_employee_refuses_every_state_changing_operation() -> None:
    employee = _employee()
    _move(employee, EmploymentStatus.DISMISSED)

    with pytest.raises(EmployeeDismissedError):
        employee.transfer(
            position_id=uuid4(), unit_id=uuid4(), effective_date=date(2024, 6, 1), now=NOW
        )
    with pytest.raises(EmployeeDismissedError):
        employee.change_rank(rank="полковник", effective_date=date(2024, 6, 1), now=NOW)
    with pytest.raises(EmployeeDismissedError):
        employee.add_secondary_assignment(
            position_id=uuid4(), unit_id=uuid4(), valid_from=date(2024, 6, 1)
        )
