"""0005_legal_rules_rule_description

Fixes a real gap found while building the Rule aggregate's ORM mapping
(LR004): `openapi.yaml` `CreateRuleRequest`/`Rule` schemas include an
optional `description` field, but `PostgreSQL_Logical_Model_FPS.md` разд.
1.4's `legal_rules.rule` table has no such column. Additive, non-breaking:
adds a nullable `text` column matching the openapi field
(`maxLength: 2000` is enforced at the API/Pydantic boundary, not the DB).

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-20
"""

from __future__ import annotations

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE legal_rules.rule ADD COLUMN description text")


def downgrade() -> None:
    op.execute("ALTER TABLE legal_rules.rule DROP COLUMN IF EXISTS description")
