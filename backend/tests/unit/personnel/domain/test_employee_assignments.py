"""PE001/PE002 — unit tests for the position and secondment invariants of
the `Employee` aggregate, plus the append-only guard on
`ServiceRecordEntry`. Pure domain, no DB.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

import pytest

from src.modules.personnel.domain.employee import Employee
from src.modules.personnel.domain.errors import (
    OverlappingSecondaryAssignmentError,
    PersonnelNumberImmutableError,
    SecondmentWhileUnavailableError,
    SecondPrimaryPositionError,
    ServiceRecordBackdatedError,
)
from src.modules.personnel.domain.events import EmployeeTransferred
from src.modules.personnel.domain.service_record import (
    SecondaryAssignment,
    ServiceRecordEntry,
    ServiceRecordImmutableError,
)
from src.modules.personnel.domain.value_objects import (
    EmploymentStatus,
    LegalBase,
    ServiceConditionCategory,
    ServiceRecordEventType,
)

NOW = datetime.now(UTC)
HIRED_AT = date(2020, 3, 1)
PRIMARY_POSITION = uuid4()
HOME_UNIT = uuid4()


def _employee() -> Employee:
    return Employee.register(
        personnel_number="654321",
        full_name="Петров Пётр Петрович",
        rank="капитан внутренней службы",
        legal_base=LegalBase.FPS_SERVICE,
        service_condition_category=ServiceConditionCategory.NORMAL,
        position_id=PRIMARY_POSITION,
        unit_id=HOME_UNIT,
        hired_at=HIRED_AT,
        now=NOW,
    )


# ------------------------------------------------------- PE001: primary post


def test_registration_opens_the_service_record_with_an_assignment() -> None:
    employee = _employee()
    assert len(employee.service_record) == 1
    entry = employee.service_record[0]
    assert entry.event_type == ServiceRecordEventType.ASSIGNMENT
    assert entry.effective_date == HIRED_AT
    assert entry.position_id == PRIMARY_POSITION


def test_secondment_to_the_already_held_primary_position_is_rejected() -> None:
    """The DoD case for PE001 — "вторая активная основная должность". The
    primary post is a single field, so the only way to end up holding two
    is to smuggle one in as a secondment."""
    employee = _employee()
    with pytest.raises(SecondPrimaryPositionError):
        employee.add_secondary_assignment(
            position_id=PRIMARY_POSITION, unit_id=HOME_UNIT, valid_from=date(2024, 1, 1)
        )


def test_transfer_replaces_the_primary_post_and_records_the_move() -> None:
    employee = _employee()
    employee.pull_pending_events()
    new_position, new_unit = uuid4(), uuid4()

    employee.transfer(
        position_id=new_position, unit_id=new_unit, effective_date=date(2024, 2, 1), now=NOW
    )

    assert employee.current_position_id == new_position
    assert employee.current_unit_id == new_unit
    assert employee.service_record[-1].event_type == ServiceRecordEventType.TRANSFER

    events = employee.pull_pending_events()
    assert len(events) == 1
    event = events[0]
    assert isinstance(event, EmployeeTransferred)
    assert event.previous_position_id == PRIMARY_POSITION
    assert event.new_position_id == new_position


def test_a_post_freed_by_transfer_can_then_be_taken_as_a_secondment() -> None:
    """The mirror of the PE001 refusal: once the post is no longer primary,
    seconding to it is legitimate — the rule is "not twice at once", not
    "never again"."""
    employee = _employee()
    employee.transfer(
        position_id=uuid4(), unit_id=HOME_UNIT, effective_date=date(2024, 2, 1), now=NOW
    )

    assignment = employee.add_secondary_assignment(
        position_id=PRIMARY_POSITION, unit_id=HOME_UNIT, valid_from=date(2024, 3, 1)
    )
    assert assignment in employee.secondary_assignments


# -------------------------------------------------------- PE002: secondments


def test_overlapping_secondments_are_rejected() -> None:
    employee = _employee()
    employee.add_secondary_assignment(
        position_id=uuid4(),
        unit_id=HOME_UNIT,
        valid_from=date(2024, 1, 1),
        valid_to=date(2024, 6, 1),
    )

    with pytest.raises(OverlappingSecondaryAssignmentError):
        employee.add_secondary_assignment(
            position_id=uuid4(),
            unit_id=HOME_UNIT,
            valid_from=date(2024, 5, 1),
            valid_to=date(2024, 9, 1),
        )


def test_secondments_touching_at_the_boundary_do_not_overlap() -> None:
    """Half-open `[from, to)` — identical to the DB's
    `daterange(..., '[)')` (migration 0008), so domain and constraint can
    never disagree about the handover date itself."""
    employee = _employee()
    employee.add_secondary_assignment(
        position_id=uuid4(),
        unit_id=HOME_UNIT,
        valid_from=date(2024, 1, 1),
        valid_to=date(2024, 6, 1),
    )
    employee.add_secondary_assignment(
        position_id=uuid4(), unit_id=HOME_UNIT, valid_from=date(2024, 6, 1)
    )
    assert len(employee.secondary_assignments) == 2


@pytest.mark.parametrize("status", [EmploymentStatus.SICK, EmploymentStatus.SUSPENDED])
def test_incapacitated_employee_cannot_be_seconded(status: EmploymentStatus) -> None:
    """Domain Model разд. 3.1 инвариант 4 — "нельзя нести обязанности по
    совмещаемой должности, будучи признанным нетрудоспособным": временная
    нетрудоспособность и отстранение. See `Employee`'s module docstring for
    why this is checked against the employee's CURRENT status rather than
    against sickness intervals, which live in `TimeAccounting`."""
    employee = _employee()
    employee.change_employment_status(
        new_status=status, effective_date=date(2024, 1, 1), reason="тест", now=NOW
    )

    with pytest.raises(SecondmentWhileUnavailableError):
        employee.add_secondary_assignment(
            position_id=uuid4(), unit_id=HOME_UNIT, valid_from=date(2024, 2, 1)
        )


def test_employee_on_leave_may_still_hold_a_secondment() -> None:
    """`ON_LEAVE` is deliberately absent from the incapacity set: being on
    leave is not being unfit for duty, and инвариант 4 names only
    нетрудоспособность and отстранение."""
    employee = _employee()
    employee.change_employment_status(
        new_status=EmploymentStatus.ON_LEAVE,
        effective_date=date(2024, 1, 1),
        reason="основной отпуск",
        now=NOW,
    )

    assignment = employee.add_secondary_assignment(
        position_id=uuid4(), unit_id=HOME_UNIT, valid_from=date(2024, 2, 1)
    )
    assert assignment in employee.secondary_assignments


def test_dismissal_closes_open_secondments_rather_than_deleting_them() -> None:
    employee = _employee()
    employee.add_secondary_assignment(
        position_id=uuid4(), unit_id=HOME_UNIT, valid_from=date(2024, 1, 1)
    )

    employee.change_employment_status(
        new_status=EmploymentStatus.DISMISSED,
        effective_date=date(2024, 4, 1),
        reason="по собственному желанию",
        now=NOW,
    )

    assert len(employee.secondary_assignments) == 1
    assert employee.secondary_assignments[0].valid_to == date(2024, 4, 1)


def test_secondary_assignment_rejects_an_inverted_period() -> None:
    with pytest.raises(ValueError, match="valid_to"):
        SecondaryAssignment(
            id=uuid4(),
            employee_id=uuid4(),
            position_id=uuid4(),
            unit_id=uuid4(),
            valid_from=date(2024, 6, 1),
            valid_to=date(2024, 1, 1),
        )


# ------------------------------------------------- append-only service record


def test_personnel_number_is_immutable() -> None:
    """Domain Model разд. 3.1, VO `PersonalIdentity`. The UNIQUE constraint
    covers "no two employees share one"; this covers "and it never changes
    under the one who has it"."""
    employee = _employee()
    with pytest.raises(PersonnelNumberImmutableError):
        employee.personnel_number = "999999"


def test_recorded_service_record_entry_cannot_be_modified() -> None:
    employee = _employee()
    entry = employee.service_record[0]

    with pytest.raises(ServiceRecordImmutableError):
        entry.effective_date = date(2021, 1, 1)


def test_service_record_entry_requires_the_payload_of_its_event_type() -> None:
    """Mirrors `ck_service_record_payload` (migration 0008): an
    `assignment` with no position records that something happened without
    recording what."""
    with pytest.raises(ValueError, match="position_id"):
        ServiceRecordEntry(
            id=uuid4(),
            employee_id=uuid4(),
            event_type=ServiceRecordEventType.ASSIGNMENT,
            effective_date=date(2024, 1, 1),
        )


def test_service_record_cannot_predate_the_hire_date() -> None:
    employee = _employee()
    with pytest.raises(ServiceRecordBackdatedError):
        employee.add_service_record_entry(
            event_type=ServiceRecordEventType.RANK_CHANGE,
            effective_date=date(2019, 1, 1),
            rank="полковник",
            now=NOW,
        )


def test_generic_append_of_a_transfer_actually_moves_the_employee() -> None:
    """PE009's endpoint is generic; the aggregate still refuses to record a
    transfer without performing it (see `add_service_record_entry`)."""
    employee = _employee()
    new_unit = uuid4()

    employee.add_service_record_entry(
        event_type=ServiceRecordEventType.TRANSFER,
        effective_date=date(2024, 2, 1),
        unit_id=new_unit,
        now=NOW,
    )

    assert employee.current_unit_id == new_unit
