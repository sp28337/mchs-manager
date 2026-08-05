"""0008_personnel_service_record

DB011: таблицы service_record_entry (append-only) + secondary_assignment (EXCLUDE).

**Append-only, and how it is actually enforced.** DB011's DoD phrases the
check as "REVOKE UPDATE/DELETE проверен: UPDATE от app_role падает". A
`REVOKE` alone cannot be the primary mechanism here, for a reason worth
stating rather than working around: the application connects as the role
that OWNS these tables (see docker-compose.yml / CI `FPS_DATABASE_DSN` —
user `fps`), and an owner's implicit privileges are not removed by
`REVOKE`. A `REVOKE`-only guard would therefore be green in a
role-separated production deployment and completely absent in dev and CI —
the two environments where the append-only rule is most likely to be
broken by accident.

So the rule is enforced by a `BEFORE UPDATE OR DELETE` trigger, which no
role — owner or superuser — bypasses. That is strictly stronger than the
DoD asks for and is testable in every environment. The `REVOKE` is still
issued, as defence in depth, but only if a dedicated `fps_app` role
already exists: roles are cluster-global objects shared by every database
on the server, so provisioning one is a deployment concern, not something
a schema migration should create behind the operator's back.

The same trigger shape (a `BEFORE`-trigger raising an exception, because
`CHECK` cannot compare OLD to NEW) already guards published RuleVersions
in migration 0003 — `fn_prevent_published_rule_version_edit`. This is that
pattern applied to the second append-only table in the model
(Domain Model разд. 13: "история никогда не перезаписывается").

`secondary_assignment`'s EXCLUDE keys on `employee_id` alone, not on
`(employee_id, position_id)`: the invariant being protected is that a
person is not simultaneously seconded to two posts at once, which a
per-position key would permit (two overlapping assignments to two
different positions would each be unique on their own pair, and both
would be accepted).

Revision ID: 0008
Revises: 0007
Create Date: 2026-08-05
"""

from __future__ import annotations

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE personnel.service_record_entry (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            employee_id     uuid NOT NULL REFERENCES personnel.employee(id),
            event_type      personnel.service_record_event_type NOT NULL,
            effective_date  date NOT NULL,
            position_id     uuid REFERENCES personnel."position"(id),
            unit_id         uuid REFERENCES personnel.unit(id),
            rank            text,
            recorded_at     timestamptz NOT NULL DEFAULT now(),

            -- Each event type carries its own mandatory payload: an
            -- 'assignment' without a position, or a 'rank_change' without a
            -- rank, records that something happened without recording what.
            CONSTRAINT ck_service_record_payload CHECK (
                (event_type = 'assignment'  AND position_id IS NOT NULL) OR
                (event_type = 'transfer'    AND unit_id     IS NOT NULL) OR
                (event_type = 'rank_change' AND rank        IS NOT NULL) OR
                (event_type = 'dismissal')
            )
        )
    """)
    # (employee_id, effective_date DESC) — the service history is always
    # read newest-first for one person (`GET /personnel/employees/
    # {employeeId}/service-record-entries`).
    op.execute("""
        CREATE INDEX ix_service_record_employee
            ON personnel.service_record_entry (employee_id, effective_date DESC)
    """)

    op.execute("""
        CREATE OR REPLACE FUNCTION personnel.fn_service_record_append_only()
        RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION
                'personnel.service_record_entry is append-only: % is not permitted (id=%)',
                TG_OP, OLD.id
                USING ERRCODE = 'restrict_violation';
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER trg_service_record_append_only
            BEFORE UPDATE OR DELETE ON personnel.service_record_entry
            FOR EACH ROW EXECUTE FUNCTION personnel.fn_service_record_append_only()
    """)

    # Defence in depth — applied only where the operator has already
    # provisioned a separate application role (see module docstring).
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fps_app') THEN
                REVOKE UPDATE, DELETE ON personnel.service_record_entry FROM fps_app;
            END IF;
        END
        $$
    """)

    op.execute("""
        CREATE TABLE personnel.secondary_assignment (
            id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            employee_id  uuid NOT NULL REFERENCES personnel.employee(id),
            position_id  uuid NOT NULL REFERENCES personnel."position"(id),
            unit_id      uuid NOT NULL REFERENCES personnel.unit(id),
            valid_from   date NOT NULL,
            valid_to     date,

            CONSTRAINT ck_secondary_assignment_validity CHECK (
                valid_to IS NULL OR valid_to > valid_from
            ),

            CONSTRAINT excl_secondary_assignment_no_overlap EXCLUDE USING gist (
                employee_id WITH =,
                daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[)') WITH &&
            )
        )
    """)
    op.execute("""
        CREATE INDEX ix_secondary_assignment_employee
            ON personnel.secondary_assignment (employee_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS personnel.secondary_assignment")
    op.execute("DROP TRIGGER IF EXISTS trg_service_record_append_only "
               "ON personnel.service_record_entry")
    op.execute("DROP TABLE IF EXISTS personnel.service_record_entry")
    op.execute("DROP FUNCTION IF EXISTS personnel.fn_service_record_append_only()")
