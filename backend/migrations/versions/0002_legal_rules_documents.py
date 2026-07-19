"""0002_legal_rules_documents

DB002: схема legal_rules + enum-типы
DB003: normative_document + ограничения уникальности/валидности
DB004: document_node (иерархия глава/статья/пункт) + индексы

Source of truth: PostgreSQL_Logical_Model_FPS.md, разд. 1.1-1.3 (DDL copied
verbatim — the doc's SQL is the design artifact, this migration is its
literal application, not a reinterpretation).

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-19
"""

from __future__ import annotations

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS legal_rules")

    op.execute("""
        CREATE TYPE legal_rules.document_type AS ENUM (
            'federal_law', 'government_decree', 'departmental_order'
        )
    """)
    op.execute("""
        CREATE TYPE legal_rules.document_node_type AS ENUM (
            'chapter', 'article', 'paragraph'
        )
    """)
    op.execute("""
        CREATE TYPE legal_rules.rule_category AS ENUM (
            'norm_calculation',
            'night_hours_classification',
            'holiday_hours_classification',
            'overtime_classification',
            'compensation_coefficient',
            'leave_entitlement',
            'minimum_rest_period'
        )
    """)
    op.execute("CREATE TYPE legal_rules.rule_status AS ENUM ('draft', 'published', 'superseded')")

    op.execute("""
        CREATE TABLE legal_rules.normative_document (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            doc_type        legal_rules.document_type NOT NULL,
            reg_number      text NOT NULL,
            adopted_date    date NOT NULL,
            title           text NOT NULL,
            valid_from      date NOT NULL,
            valid_to        date,
            created_at      timestamptz NOT NULL DEFAULT now(),

            CONSTRAINT uq_document_identity UNIQUE (doc_type, reg_number, adopted_date),
            CONSTRAINT ck_document_validity CHECK (valid_to IS NULL OR valid_to > valid_from)
        )
    """)

    op.execute("""
        CREATE TABLE legal_rules.document_node (
            id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            document_id       uuid NOT NULL REFERENCES legal_rules.normative_document(id),
            parent_node_id    uuid REFERENCES legal_rules.document_node(id),
            node_type         legal_rules.document_node_type NOT NULL,
            ordinal_number    text NOT NULL,
            title             text,
            text_content      text,

            CONSTRAINT uq_document_node_position
                UNIQUE (document_id, parent_node_id, node_type, ordinal_number)
        )
    """)
    op.execute("CREATE INDEX ix_document_node_document ON legal_rules.document_node (document_id)")
    op.execute("CREATE INDEX ix_document_node_parent ON legal_rules.document_node (parent_node_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS legal_rules.document_node")
    op.execute("DROP TABLE IF EXISTS legal_rules.normative_document")
    op.execute("DROP TYPE IF EXISTS legal_rules.rule_status")
    op.execute("DROP TYPE IF EXISTS legal_rules.rule_category")
    op.execute("DROP TYPE IF EXISTS legal_rules.document_node_type")
    op.execute("DROP TYPE IF EXISTS legal_rules.document_type")
    op.execute("DROP SCHEMA IF EXISTS legal_rules CASCADE")
