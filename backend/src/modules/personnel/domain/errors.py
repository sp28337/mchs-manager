"""Domain-level exceptions for PersonnelAndOrganization.

Raised by aggregate methods only (never by Application/Infrastructure) and
mapped to HTTP responses at the API boundary alone (API_Conventions разд.
3) — the domain knows nothing about status codes. Same split as
`legal_rules/domain/errors.py`.
"""

from __future__ import annotations


class PersonnelDomainError(Exception):
    """Base class for every error raised from this module's domain layer."""


class InvalidEmploymentStatusTransitionError(PersonnelDomainError):
    """PE003 — the `EmploymentStatus` state machine refused the move
    (`Employee._ALLOWED_TRANSITIONS`). The canonical case is
    `dismissed -> active`: dismissal is terminal, and re-hiring is a NEW
    `Employee` with its own `hired_at`, not a resurrection of the old
    record whose service history would silently gain a gap. Maps to 422."""


class EmployeeDismissedError(PersonnelDomainError):
    """Any state-changing operation attempted on a dismissed employee
    (transfer, secondment, service-record append other than the dismissal
    itself). Maps to 422."""


class SecondPrimaryPositionError(PersonnelDomainError):
    """PE001 инвариант: сотрудник занимает ровно одну основную должность.
    Raised when a secondment (`add_secondary_assignment`) names the very
    position the employee already holds as primary — that is not
    совмещение, it is a second primary post by another name. Maps to 422."""


class OverlappingSecondaryAssignmentError(PersonnelDomainError):
    """PE002 инвариант: two secondments of one employee may not overlap in
    time. Mirrors `excl_secondary_assignment_no_overlap` (migration 0008).
    Maps to 409."""


class SecondmentWhileUnavailableError(PersonnelDomainError):
    """PE002 инвариант: an employee who is sick/suspended/on leave cannot
    be seconded to an additional post. See `Employee.add_secondary_assignment`
    for what this can and cannot see across module boundaries. Maps to 422."""


class ServiceRecordBackdatedError(PersonnelDomainError):
    """A `ServiceRecordEntry` cannot take effect before the employee was
    hired — the history of a service is bounded by that service. Maps to 422."""


class EmployeeNotFoundError(PersonnelDomainError):
    """No `Employee` with the given id exists. Maps to 404."""


class UnitNotFoundError(PersonnelDomainError):
    """No `Unit` with the given id exists. Maps to 404."""


class PositionNotFoundError(PersonnelDomainError):
    """No `Position` with the given id exists. Maps to 404."""


class PersonnelNumberImmutableError(PersonnelDomainError):
    """Domain Model разд. 3.1, VO `PersonalIdentity`: табельный номер
    неизменяем. Raised by `Employee.__setattr__` on any attempt to change
    it after construction. Maps to 423 Locked."""


class PersonnelNumberAlreadyExistsError(PersonnelDomainError):
    """`personnel.employee.personnel_number` is UNIQUE
    (`uq_employee_personnel_number`, migration 0007). Cross-aggregate, so
    checked at the repository/Application boundary rather than inside
    `Employee` — same split as `legal_rules`' `NormativeDocumentAlreadyExistsError`.
    Maps to 409."""


class UnitCodeAlreadyExistsError(PersonnelDomainError):
    """`uq_unit_code` (migration 0006). Maps to 409."""


class PositionCodeAlreadyExistsError(PersonnelDomainError):
    """`uq_position_code` (migration 0006). Maps to 409."""
