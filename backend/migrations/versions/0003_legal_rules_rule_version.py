"""0003_legal_rules_rule_version

DB005: таблицы rule + rule_version c EXCLUDE-ограничением.

Source of truth: PostgreSQL_Logical_Model_FPS.md, разд. 1.4-1.5. This is
the central table of the whole model (Domain Model инвариант 2.2.1: ровно
одна действующая RuleVersion на дату для (rule_id, scope)).

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-19
"""

from __future__ import annotations

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE legal_rules.rule (
            id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            code          text NOT NULL,
            category      legal_rules.rule_category NOT NULL,
            display_name  text NOT NULL,

            CONSTRAINT uq_rule_code UNIQUE (code)
        )
    """)

    op.execute("""
        CREATE TABLE legal_rules.rule_version (
            id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            rule_id                uuid NOT NULL REFERENCES legal_rules.rule(id),
            version_no             integer NOT NULL,
            scope                  jsonb NOT NULL,
            scope_key              text GENERATED ALWAYS AS (scope::text) STORED,
            legal_basis_node_id    uuid NOT NULL REFERENCES legal_rules.document_node(id),
            formula_definition     jsonb NOT NULL,
            valid_from             date NOT NULL,
            valid_to               date,
            status                 legal_rules.rule_status NOT NULL DEFAULT 'draft',
            published_at           timestamptz,
            published_by           uuid,

            CONSTRAINT uq_rule_version_no UNIQUE (rule_id, version_no),
            CONSTRAINT ck_rule_version_validity CHECK (valid_to IS NULL OR valid_to > valid_from),
            CONSTRAINT ck_rule_version_published CHECK (
                (status = 'draft' AND published_at IS NULL) OR
                (status IN ('published','superseded') AND published_at IS NOT NULL)
            ),

            CONSTRAINT excl_rule_version_no_overlap EXCLUDE USING gist (
                rule_id WITH =,
                scope_key WITH =,
                daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[)') WITH &&
            ) WHERE (status <> 'draft')
        )
    """)

    op.execute("CREATE INDEX ix_rule_version_rule ON legal_rules.rule_version (rule_id)")
    op.execute(
        "CREATE INDEX ix_rule_version_legalbasis ON legal_rules.rule_version (legal_basis_node_id)"
    )
    op.execute(
        "CREATE INDEX ix_rule_version_scope_gin ON legal_rules.rule_version USING gin (scope)"
    )

    # Domain Model инвариант 2.2.2: RuleVersion immutable after publication.
    # Not expressible as a CHECK (can't compare OLD vs NEW there) — enforced
    # by a BEFORE UPDATE trigger, per Backend_Architecture разд. 5 note.
    op.execute("""
        CREATE OR REPLACE FUNCTION legal_rules.fn_prevent_published_rule_version_edit()
        RETURNS trigger AS $$
        BEGIN
            IF OLD.status IN ('published', 'superseded') THEN
                IF NEW.status = 'superseded' AND OLD.status = 'published' THEN
                    IF NEW.scope IS DISTINCT FROM OLD.scope
                       OR NEW.formula_definition IS DISTINCT FROM OLD.formula_definition
                       OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
                       OR NEW.rule_id IS DISTINCT FROM OLD.rule_id THEN
                        RAISE EXCEPTION
                            'rule_version % is published/superseded and immutable except for status/valid_to',
                            OLD.id;
                    END IF;
                    RETURN NEW;
                ELSIF NEW.* IS DISTINCT FROM OLD.* THEN
                    RAISE EXCEPTION
                        'rule_version % is published/superseded and immutable', OLD.id;
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER trg_prevent_published_rule_version_edit
        BEFORE UPDATE ON legal_rules.rule_version
        FOR EACH ROW
        EXECUTE FUNCTION legal_rules.fn_prevent_published_rule_version_edit()
    """)


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_prevent_published_rule_version_edit ON legal_rules.rule_version"
    )
    op.execute("DROP FUNCTION IF EXISTS legal_rules.fn_prevent_published_rule_version_edit()")
    op.execute("DROP TABLE IF EXISTS legal_rules.rule_version")
    op.execute("DROP TABLE IF EXISTS legal_rules.rule")
