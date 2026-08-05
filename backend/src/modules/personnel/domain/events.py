"""Domain events for PersonnelAndOrganization (Domain_Model_DDD разд. 11).

`PersonnelAndOrganization` is a Generic subdomain (Architecture разд. 4) —
nothing downstream computes anything from these events today. They are
raised anyway because the fact that an employee was dismissed or moved
between units is precisely what `TimeAccounting`/`Scheduling` will need to
react to (close the open timesheet, drop future planned shifts), and an
aggregate that never announces its state changes cannot be subscribed to
later without changing the aggregate itself.

Like `legal_rules`', these are buffered by `AggregateRoot.raise_event()`
and, for now, drained by nothing: the Transactional Outbox
(Architecture разд. 9.2) is not migrated yet — the same honest gap
`legal_rules/infrastructure/write/rule_repository.py` documents.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from uuid import UUID

from src.building_blocks.domain.domain_event import DomainEvent
from src.modules.personnel.domain.value_objects import EmploymentStatus


@dataclass(frozen=True, kw_only=True)
class EmployeeRegistered(DomainEvent):
    employee_id: UUID
    personnel_number: str
    unit_id: UUID
    position_id: UUID


@dataclass(frozen=True, kw_only=True)
class EmploymentStatusChanged(DomainEvent):
    employee_id: UUID
    previous_status: EmploymentStatus
    new_status: EmploymentStatus
    effective_date: date


@dataclass(frozen=True, kw_only=True)
class EmployeeTransferred(DomainEvent):
    """Основная должность и/или подразделение сотрудника изменились."""

    employee_id: UUID
    previous_unit_id: UUID
    new_unit_id: UUID
    previous_position_id: UUID
    new_position_id: UUID
    effective_date: date
