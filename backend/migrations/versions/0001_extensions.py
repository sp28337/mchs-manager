"""0001_extensions

DB001: расширения btree_gist, ltree, pgcrypto — PostgreSQL_Logical_Model_FPS.md, разд. 0.

Revision ID: 0001
Revises:
Create Date: 2026-07-19
"""

from __future__ import annotations

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    op.execute("CREATE EXTENSION IF NOT EXISTS ltree")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")


def downgrade() -> None:
    # Extensions are left in place on downgrade: other schemas created by
    # later migrations may still depend on them, and DROP EXTENSION here
    # would be a destructive, order-sensitive operation with no real
    # benefit for a local rollback. Drop manually if truly needed.
    pass
