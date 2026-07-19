"""0004_legal_rules_conflict_policy

DB006: таблицы conflict_resolution_policy(+version).

Source of truth: PostgreSQL_Logical_Model_FPS.md, разд. 1.6. Same EXCLUDE
pattern as rule_version, but without a `scope` dimension (Domain Model
разд. 2.3: a single precedence list is not scoped by position/service
category — только по периоду действия).

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-19
"""

from __future__ import annotations

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE legal_rules.conflict_resolution_policy (
            id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            code  text NOT NULL,

            CONSTRAINT uq_policy_code UNIQUE (code)
        )
    """)

    op.execute("""
        CREATE TABLE legal_rules.conflict_resolution_policy_version (
            id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            policy_id          uuid NOT NULL REFERENCES legal_rules.conflict_resolution_policy(id),
            version_no         integer NOT NULL,
            precedence_list    jsonb NOT NULL,
            valid_from         date NOT NULL,
            valid_to           date,
            status             legal_rules.rule_status NOT NULL DEFAULT 'draft',

            CONSTRAINT uq_policy_version_no UNIQUE (policy_id, version_no),
            CONSTRAINT ck_policy_precedence_is_array
                CHECK (jsonb_typeof(precedence_list) = 'array'),
            CONSTRAINT excl_policy_version_no_overlap EXCLUDE USING gist (
                policy_id WITH =,
                daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[)') WITH &&
            ) WHERE (status <> 'draft')
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS legal_rules.conflict_resolution_policy_version")
    op.execute("DROP TABLE IF EXISTS legal_rules.conflict_resolution_policy")
