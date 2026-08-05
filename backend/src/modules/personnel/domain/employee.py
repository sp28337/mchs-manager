"""`Employee` aggregate — Domain_Model_DDD_Sluzhebnoe_Vremya_FPS.md разд. 3.

The aggregate root every other bounded context points at by id and none
of them owns: `Timesheet`, `PlannedShift`, `CompensationCase`,
`RestDaysBalance`, `LeaveGrant` all carry an `employee_id` and nothing
more (Architecture разд. 4.2 — cross-module references are by identifier
only; migration 0007's docstring records the DB-level counterpart, the
deliberate absence of cross-schema FKs).

Consistency boundary: the employee, their service history
(`ServiceRecordEntry`) and their secondments (`SecondaryAssignment`).
Everything inside is loaded and saved together; anything outside is an id.

--- How the two PE invariants land here -------------------------------

**PE001 — "вторая активная основная должность отклоняется."** The primary
post is a single field (`current_position_id`), so a second one cannot be
*stored*; what could still smuggle one in is a secondment naming the post
the employee already occupies. `add_secondary_assignment()` rejects
exactly that (`SecondPrimaryPositionError`). Changing the primary post is
`transfer()` — one post in, one post out, with a `ServiceRecordEntry`
recording the move — never an addition.

**PE002 — "SecondaryAssignment, пересекающийся с больничным, отклоняется."**
Stated in full, because the boundary matters: the *periods* an employee is
sick are `time_accounting.service_time_event` rows (`eventType: sickness`
in `openapi.yaml`), inside another bounded context that this module must
not read — Architecture разд. 4.2 п.1 permits `Contracts/` only, and
`TimeAccounting` does not exist yet. What this aggregate can see is the
employee's *current* `EmploymentStatus`, so what it enforces is: an
employee who is sick or suspended right now cannot be seconded
(`SecondmentWhileUnavailableError` — those two states only, matching
инвариант 4's "нетрудоспособность или отстранение"; leave is not
incapacity), plus no two secondments overlapping each other (mirroring
`excl_secondary_assignment_no_overlap`, migration 0008). A retrospective
secondment overlapping a *past* sickness interval
is not detectable from here and is not silently pretended otherwise —
that check belongs on the `TimeAccounting` side, against
`ServiceTimeEvent`, once that module can be asked.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any
from uuid import UUID, uuid4

from src.building_blocks.domain.aggregate_root import AggregateRoot
from src.modules.personnel.domain.errors import (
    EmployeeDismissedError,
    InvalidEmploymentStatusTransitionError,
    OverlappingSecondaryAssignmentError,
    PersonnelNumberImmutableError,
    SecondmentWhileUnavailableError,
    SecondPrimaryPositionError,
    ServiceRecordBackdatedError,
)
from src.modules.personnel.domain.events import (
    EmployeeRegistered,
    EmployeeTransferred,
    EmploymentStatusChanged,
)
from src.modules.personnel.domain.service_record import SecondaryAssignment, ServiceRecordEntry
from src.modules.personnel.domain.value_objects import (
    EmploymentStatus,
    LegalBase,
    ServiceConditionCategory,
    ServiceRecordEventType,
)

# PE003. A literal transcription of Domain Model разд. 3.1 инвариант 3:
#
#     Active ⇄ OnLeave,  Active ⇄ Sick,
#     Active → Suspended → (Active | Dismissed),
#     * → Dismissed  (терминальное состояние, необратимо)
#
# Note what that does NOT contain: any edge between `OnLeave` and `Sick`.
# Every move between the two non-terminal absence states goes back through
# `Active`, so falling ill during leave is recorded as "returned to duty,
# then fell ill" rather than as a silent reclassification of one absence
# into another. That distinction is the whole point — the two states have
# different consequences for the norm (Алгоритм З: sickness produces
# `underworked_explained_hours`, leave does not), so an undocumented
# OnLeave→Sick edge would let a period change its accounting meaning with
# no `ServiceRecordEntry` marking when.
#
# `DISMISSED` maps to the empty set: увольнение терминально. Re-hiring the
# same person is a NEW `Employee` with its own `hired_at` and its own
# service history — resurrecting the old row would leave an unexplained
# gap in a record that is legally required to be continuous (Domain Model
# разд. 13).
_ALLOWED_TRANSITIONS: dict[EmploymentStatus, frozenset[EmploymentStatus]] = {
    EmploymentStatus.ACTIVE: frozenset(
        {
            EmploymentStatus.ON_LEAVE,
            EmploymentStatus.SICK,
            EmploymentStatus.SUSPENDED,
            EmploymentStatus.DISMISSED,
        }
    ),
    EmploymentStatus.ON_LEAVE: frozenset({EmploymentStatus.ACTIVE, EmploymentStatus.DISMISSED}),
    EmploymentStatus.SICK: frozenset({EmploymentStatus.ACTIVE, EmploymentStatus.DISMISSED}),
    EmploymentStatus.SUSPENDED: frozenset({EmploymentStatus.ACTIVE, EmploymentStatus.DISMISSED}),
    EmploymentStatus.DISMISSED: frozenset(),
}

# Domain Model разд. 3.1 инвариант 4: "нельзя нести обязанности по
# совмещаемой должности, будучи признанным нетрудоспособным" — временная
# нетрудоспособность и отстранение, and those two only. `ON_LEAVE` is
# deliberately NOT here: being on leave is not incapacity, and an employee
# may legitimately hold a secondment across their own leave.
_UNAVAILABLE_FOR_SECONDMENT = frozenset(
    {EmploymentStatus.SICK, EmploymentStatus.SUSPENDED}
)


@dataclass(eq=False, kw_only=True)
class Employee(AggregateRoot):
    personnel_number: str
    full_name: str
    rank: str
    legal_base: LegalBase
    service_condition_category: ServiceConditionCategory
    current_position_id: UUID
    current_unit_id: UUID
    hired_at: date
    employment_status: EmploymentStatus = EmploymentStatus.ACTIVE
    dismissed_at: date | None = None
    service_record: list[ServiceRecordEntry] = field(default_factory=list)
    secondary_assignments: list[SecondaryAssignment] = field(default_factory=list)

    def __setattr__(self, name: str, value: Any) -> None:
        """Domain Model разд. 3.1, VO `PersonalIdentity`: "табельный номер
        уникален и **неизменяем**".

        Immutability is the half that a UNIQUE constraint cannot express —
        `uq_employee_personnel_number` (migration 0007) stops two employees
        sharing a number, but would happily let one employee's number be
        swapped for an unused one, silently detaching every historical
        record that identifies them by it.

        Same short-circuit-before-getattr shape, and for the same reason,
        as `legal_rules`' `RuleVersion.__setattr__`: SQLAlchemy's ORM
        instrumentation sets its own internal state marker through this
        method before the instance has any queryable state, so the getattr
        must never run for unrelated attribute names. The first assignment
        (from the dataclass `__init__`, when the attribute does not exist
        yet) reads `None` and is allowed; every later one is not.
        """
        if name == "personnel_number" and getattr(self, "personnel_number", None) is not None:
            raise PersonnelNumberImmutableError(
                f"employee {getattr(self, 'id', '?')}: personnel_number "
                f"{self.personnel_number!r} is immutable"
            )
        super().__setattr__(name, value)

    # ---------------------------------------------------------------- create

    @classmethod
    def register(
        cls,
        *,
        personnel_number: str,
        full_name: str,
        rank: str,
        legal_base: LegalBase,
        service_condition_category: ServiceConditionCategory,
        position_id: UUID,
        unit_id: UUID,
        hired_at: date,
        now: datetime,
    ) -> Employee:
        """PE007. Registration is not a bare constructor call: it also opens
        the service record with the initial `assignment` entry. An employee
        whose history did not start at their appointment would be a record
        with a hole in it from the first day."""
        employee = cls(
            id=uuid4(),
            personnel_number=personnel_number,
            full_name=full_name,
            rank=rank,
            legal_base=legal_base,
            service_condition_category=service_condition_category,
            current_position_id=position_id,
            current_unit_id=unit_id,
            hired_at=hired_at,
            employment_status=EmploymentStatus.ACTIVE,
        )
        employee._append_service_record(
            ServiceRecordEntry(
                id=uuid4(),
                employee_id=employee.id,
                event_type=ServiceRecordEventType.ASSIGNMENT,
                effective_date=hired_at,
                position_id=position_id,
                unit_id=unit_id,
                rank=rank,
                recorded_at=now,
            )
        )
        employee.raise_event(
            EmployeeRegistered(
                employee_id=employee.id,
                personnel_number=personnel_number,
                unit_id=unit_id,
                position_id=position_id,
            )
        )
        return employee

    # ---------------------------------------------------------------- state

    @property
    def is_dismissed(self) -> bool:
        return self.employment_status == EmploymentStatus.DISMISSED

    def change_employment_status(
        self, *, new_status: EmploymentStatus, effective_date: date, reason: str, now: datetime
    ) -> None:
        """PE008. `reason` is required by `openapi.yaml`
        (`ChangeEmploymentStatusRequest.reason`) and is deliberately NOT
        stored on the employee: a status change is a fact about a moment,
        and the place for its narrative is `audit.audit_log`
        (PostgreSQL_Logical_Model разд. 9), which has no writer wired up
        yet. Flagged here rather than parked in a column that nothing
        reads — the same call `legal_rules`' `PublishRuleVersionHandler`
        makes about `change_reason`.
        """
        allowed = _ALLOWED_TRANSITIONS[self.employment_status]
        if new_status == self.employment_status:
            # Not an error and not a no-op worth an event: re-asserting the
            # current status is how an idempotent retry of the same PATCH
            # looks (API_Conventions разд. 5, `Idempotency-Key`).
            return
        if new_status not in allowed:
            raise InvalidEmploymentStatusTransitionError(
                f"employee {self.id}: transition {self.employment_status} -> {new_status} "
                f"is not permitted (allowed: {sorted(allowed) or 'none — terminal state'})"
            )
        if effective_date < self.hired_at:
            raise ServiceRecordBackdatedError(
                f"effective_date {effective_date} precedes hired_at {self.hired_at}"
            )

        previous = self.employment_status
        self.employment_status = new_status

        if new_status == EmploymentStatus.DISMISSED:
            # `ck_employee_dismissed` (migration 0007) is bidirectional, so
            # these two fields must move together or the row is rejected.
            self.dismissed_at = effective_date
            self._append_service_record(
                ServiceRecordEntry(
                    id=uuid4(),
                    employee_id=self.id,
                    event_type=ServiceRecordEventType.DISMISSAL,
                    effective_date=effective_date,
                    recorded_at=now,
                )
            )
            self._close_open_secondments(effective_date)

        self.raise_event(
            EmploymentStatusChanged(
                employee_id=self.id,
                previous_status=previous,
                new_status=new_status,
                effective_date=effective_date,
            )
        )

    # ------------------------------------------------------------- position

    def transfer(
        self, *, position_id: UUID, unit_id: UUID, effective_date: date, now: datetime
    ) -> ServiceRecordEntry:
        """Перевод: the ONLY way the primary post/unit changes. One post in,
        one post out — see the PE001 note in the module docstring."""
        self._require_not_dismissed("transfer")
        previous_unit_id = self.current_unit_id
        previous_position_id = self.current_position_id

        self.current_position_id = position_id
        self.current_unit_id = unit_id

        entry = ServiceRecordEntry(
            id=uuid4(),
            employee_id=self.id,
            event_type=ServiceRecordEventType.TRANSFER,
            effective_date=effective_date,
            position_id=position_id,
            unit_id=unit_id,
            recorded_at=now,
        )
        self._append_service_record(entry)
        self.raise_event(
            EmployeeTransferred(
                employee_id=self.id,
                previous_unit_id=previous_unit_id,
                new_unit_id=unit_id,
                previous_position_id=previous_position_id,
                new_position_id=position_id,
                effective_date=effective_date,
            )
        )
        return entry

    def change_rank(self, *, rank: str, effective_date: date, now: datetime) -> ServiceRecordEntry:
        self._require_not_dismissed("change rank of")
        self.rank = rank
        entry = ServiceRecordEntry(
            id=uuid4(),
            employee_id=self.id,
            event_type=ServiceRecordEventType.RANK_CHANGE,
            effective_date=effective_date,
            rank=rank,
            recorded_at=now,
        )
        self._append_service_record(entry)
        return entry

    # ----------------------------------------------------------- secondment

    def add_secondary_assignment(
        self,
        *,
        position_id: UUID,
        unit_id: UUID,
        valid_from: date,
        valid_to: date | None = None,
    ) -> SecondaryAssignment:
        """PE002 — see the module docstring for what this can and cannot
        check across the `TimeAccounting` boundary."""
        self._require_not_dismissed("second")

        if position_id == self.current_position_id:
            raise SecondPrimaryPositionError(
                f"employee {self.id} already holds position {position_id} as their primary "
                f"post — a secondment to the same position would be a second primary one"
            )
        if self.employment_status in _UNAVAILABLE_FOR_SECONDMENT:
            raise SecondmentWhileUnavailableError(
                f"employee {self.id} is {self.employment_status} and cannot take on an "
                f"additional post"
            )

        candidate = SecondaryAssignment(
            id=uuid4(),
            employee_id=self.id,
            position_id=position_id,
            unit_id=unit_id,
            valid_from=valid_from,
            valid_to=valid_to,
        )
        for existing in self.secondary_assignments:
            if existing.overlaps(candidate):
                raise OverlappingSecondaryAssignmentError(
                    f"employee {self.id}: secondment [{valid_from}, {valid_to}) overlaps "
                    f"existing secondment {existing.id} "
                    f"[{existing.valid_from}, {existing.valid_to})"
                )

        self.secondary_assignments.append(candidate)
        return candidate

    def _close_open_secondments(self, as_of: date) -> None:
        """A dismissed employee cannot still be seconded to a post. Open
        secondments are closed at the dismissal date rather than deleted —
        they happened, and the record of them survives the dismissal."""
        for assignment in self.secondary_assignments:
            if assignment.valid_to is None and assignment.valid_from < as_of:
                assignment.valid_to = as_of

    # --------------------------------------------------------------- record

    def add_service_record_entry(
        self,
        *,
        event_type: ServiceRecordEventType,
        effective_date: date,
        position_id: UUID | None = None,
        unit_id: UUID | None = None,
        rank: str | None = None,
        now: datetime,
    ) -> ServiceRecordEntry:
        """PE009 — the general append used by
        `POST /personnel/employees/{employeeId}/service-record-entries`.

        Dispatches to the specific domain method where one exists, so that
        posting a `transfer` through the generic endpoint moves the
        employee's actual current post rather than merely narrating that it
        moved. Recording history and changing state are one act, not two
        that a caller could perform half of.
        """
        if event_type == ServiceRecordEventType.TRANSFER and unit_id is not None:
            return self.transfer(
                position_id=position_id or self.current_position_id,
                unit_id=unit_id,
                effective_date=effective_date,
                now=now,
            )
        if event_type == ServiceRecordEventType.RANK_CHANGE and rank is not None:
            return self.change_rank(rank=rank, effective_date=effective_date, now=now)

        self._require_not_dismissed("append service record for")
        entry = ServiceRecordEntry(
            id=uuid4(),
            employee_id=self.id,
            event_type=event_type,
            effective_date=effective_date,
            position_id=position_id,
            unit_id=unit_id,
            rank=rank,
            recorded_at=now,
        )
        self._append_service_record(entry)
        return entry

    def _append_service_record(self, entry: ServiceRecordEntry) -> None:
        if entry.effective_date < self.hired_at:
            raise ServiceRecordBackdatedError(
                f"service record entry effective {entry.effective_date} precedes "
                f"hired_at {self.hired_at} for employee {self.id}"
            )
        self.service_record.append(entry)

    def _require_not_dismissed(self, action: str) -> None:
        if self.is_dismissed:
            raise EmployeeDismissedError(
                f"employee {self.id} was dismissed on {self.dismissed_at} — cannot {action} them"
            )
