"""0007_personnel_employee

DB010: таблица employee + индексы + CHECK на dismissed_at.

`Employee` is the entity every other bounded context references by id and
never owns (Domain Model разд. 1.1) — `time_accounting.timesheet`,
`scheduling.planned_shift`, `compensation.compensation_case`,
`rest_balance.balance_movement`, `leave_management.leave_grant` all carry
an `employee_id` with **no** FK to this table, by design
(PostgreSQL_Logical_Model разд. 10 / Backend_Architecture разд. 3.4: no
cross-schema foreign keys — that absence is what keeps module boundaries
enforceable at the DB level too, not only in Python).

The CHECK named by DB010's DoD is bidirectional here, not one-way: it
rejects `dismissed` without a date AND a date without `dismissed`. A
`dismissed_at` sitting on an `active` employee would be exactly the kind
of half-applied transition the `Employee` aggregate's state machine
(PE003) exists to prevent, so the DB refuses to hold it either.

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-05
"""

from __future__ import annotations

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE personnel.employee (
            id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            personnel_number            text NOT NULL,
            full_name                   text NOT NULL,
            rank                        text NOT NULL,
            legal_base                  personnel.legal_base NOT NULL,
            service_condition_category  personnel.service_condition_category
                                            NOT NULL DEFAULT 'normal',
            current_position_id         uuid NOT NULL REFERENCES personnel."position"(id),
            current_unit_id             uuid NOT NULL REFERENCES personnel.unit(id),
            hired_at                    date NOT NULL,
            employment_status           personnel.employment_status NOT NULL DEFAULT 'active',
            dismissed_at                date,
            created_at                  timestamptz NOT NULL DEFAULT now(),

            CONSTRAINT uq_employee_personnel_number UNIQUE (personnel_number),
            CONSTRAINT ck_employee_dismissed CHECK (
                (employment_status = 'dismissed' AND dismissed_at IS NOT NULL) OR
                (employment_status <> 'dismissed' AND dismissed_at IS NULL)
            ),
            CONSTRAINT ck_employee_dismissed_after_hired CHECK (
                dismissed_at IS NULL OR dismissed_at >= hired_at
            )
        )
    """)

    op.execute("CREATE INDEX ix_employee_unit ON personnel.employee (current_unit_id)")
    op.execute("CREATE INDEX ix_employee_position ON personnel.employee (current_position_id)")
    # Partial: `GET /personnel/employees?unitId=...` lists the people
    # actually serving in a unit; dismissed rows accumulate forever and
    # are never the answer to that question, so they are kept out of the
    # index rather than scanned past.
    op.execute("""
        CREATE INDEX ix_employee_unit_active ON personnel.employee (current_unit_id, full_name)
        WHERE employment_status <> 'dismissed'
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS personnel.employee")
