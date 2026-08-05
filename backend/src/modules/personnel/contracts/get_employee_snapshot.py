"""PE012 — public Contract for `personnel`.

Architecture разд. 4.2: "Модуль может импортировать только Contracts/
другого модуля". This is that surface for the one question every other
bounded context asks about a person — `TimeAccounting` needs the employee's
`legal_base`/`service_condition_category`/`regime_type` to pick the right
`RuleVersion` scope; `Scheduling` needs their unit; `Compensation` and
`LeaveManagement` need to know they are not dismissed.

`EmployeeSnapshot` is a purpose-built DTO, NOT the `Employee` aggregate,
and that is the rule rather than a stylistic choice (Architecture разд.
4.2 п.3: "Ни один Query-контракт не возвращает сам объект чужого
агрегата — только проекцию/DTO"). Three things follow from it:

* The service record and secondments are absent. They are internal
  history; nobody outside this module has business reading them, and
  shipping them would make every consumer's payload grow whenever an
  employee is transferred.
* `regime_type` is FLATTENED in from the employee's current `Position`.
  A consumer that had to fetch the position separately would need a
  second contract and would have to know that regime lives on the post
  rather than the person — an internal fact of this module's model.
* It is a snapshot "as known now", not a temporal query. Asking what an
  employee's unit was on some past date is answered from
  `service_record_entry`, and would be a different contract with a
  different signature — deliberately not smuggled in as an optional
  `as_of` parameter here.

What the boundary rule actually constrains is what a CONSUMER imports: a
consuming module depends on this file and nothing else of `personnel`.
This file, being `personnel`'s own adapter, does reach into
`personnel.infrastructure` for the table metadata to query — exactly as
`legal_rules/contracts/get_effective_rule_version.py` reaches into its own
`application` layer. The DTO above is what crosses the boundary; the
query below is on this side of it.
"""

from __future__ import annotations

from datetime import date
from typing import Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.personnel.infrastructure.orm_mapping import employee_table, position_table

__all__ = [
    "EmployeeNotFound",
    "EmployeeSnapshot",
    "GetEmployeeSnapshot",
    "get_employee_snapshot",
]


class EmployeeNotFound(Exception):
    """Raised instead of returning `None` so a consumer cannot forget to
    check. Mapped to 404 at whichever API boundary is calling."""


class EmployeeSnapshot(BaseModel):
    model_config = ConfigDict(frozen=True)

    employee_id: UUID
    personnel_number: str
    full_name: str
    unit_id: UUID
    position_id: UUID
    # Both `scope` dimensions a calculation needs (Domain Model разд. 0:
    # `Rule → Calculation → Employee`), as plain strings: the enums are
    # `personnel`'s own vocabulary, and a consumer importing them would be
    # importing this module's domain package.
    legal_base: str
    service_condition_category: str
    regime_type: str
    employment_status: str
    hired_at: date
    dismissed_at: date | None

    @property
    def is_dismissed(self) -> bool:
        return self.employment_status == "dismissed"


class GetEmployeeSnapshot(Protocol):
    async def __call__(self, *, employee_id: UUID) -> EmployeeSnapshot: ...


async def get_employee_snapshot(
    session: AsyncSession, *, employee_id: UUID
) -> EmployeeSnapshot:
    """Free-function adapter satisfying `GetEmployeeSnapshot`.

    Deliberately a single flat SELECT over `personnel.*` rather than a call
    into `EmployeeRepository`: the repository loads the whole aggregate —
    service record and secondments included, via `lazy="selectin"` — which
    is exactly what a consumer must not receive and is wasted work for a
    projection this small. The join to `position` is what supplies
    `regime_type` (see the module docstring).
    """
    row = (
        await session.execute(
            select(
                employee_table.c.id,
                employee_table.c.personnel_number,
                employee_table.c.full_name,
                employee_table.c.current_unit_id,
                employee_table.c.current_position_id,
                employee_table.c.legal_base,
                employee_table.c.service_condition_category,
                position_table.c.default_regime_type,
                employee_table.c.employment_status,
                employee_table.c.hired_at,
                employee_table.c.dismissed_at,
            )
            .select_from(
                employee_table.join(
                    position_table,
                    employee_table.c.current_position_id == position_table.c.id,
                )
            )
            .where(employee_table.c.id == employee_id)
        )
    ).one_or_none()

    if row is None:
        raise EmployeeNotFound(str(employee_id))

    return EmployeeSnapshot(
        employee_id=row.id,
        personnel_number=row.personnel_number,
        full_name=row.full_name,
        unit_id=row.current_unit_id,
        position_id=row.current_position_id,
        legal_base=row.legal_base,
        service_condition_category=row.service_condition_category,
        regime_type=row.default_regime_type,
        employment_status=row.employment_status,
        hired_at=row.hired_at,
        dismissed_at=row.dismissed_at,
    )
