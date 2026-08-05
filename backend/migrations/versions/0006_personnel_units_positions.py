"""0006_personnel_units_positions

DB007: схема personnel + enum-типы
DB008: таблица unit (ltree hierarchy_path) + gist-индекс
DB009: таблица position

Source of truth: PostgreSQL_Logical_Model_FPS.md, разд. 2 (personnel), read
through the DTO shapes `openapi.yaml` actually exchanges
(`CreateUnitRequest`/`Unit`, `CreatePositionRequest`/`Position`,
`CreateEmployeeRequest`/`Employee`).

TWO deliberate deviations from the backlog's literal DoD, both flagged
rather than silently made:

1. DB007's DoD says "\\dT показывает 4 enum-типа". Six are created here.
   Four are the ones named by the DoD and by `openapi.yaml`'s Personnel
   section (`employment_status`, `regime_type`, `position_category`,
   `service_condition_category`); the other two — `legal_base` and
   `service_record_event_type` — are equally enum-shaped fields of the
   very same DTOs (`CreateEmployeeRequest.legalBase`,
   `CreateServiceRecordEntryRequest.eventType`). Storing those two as
   free `text` purely to make a count match would put a constraint the
   contract states in one place (openapi) and nowhere in the DB.

2. `position` is a `col_name_keyword` in PostgreSQL (the `POSITION(...)`
   function). Schema-qualification alone is not always enough, so the
   table is created — and referenced everywhere afterwards — as
   `personnel."position"`, double-quoted. The domain class is plain
   `Position` (Backend_Architecture разд. 3.1); only the DDL/mapping
   carries the quoting.

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-05
"""

from __future__ import annotations

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS personnel")

    op.execute("""
        CREATE TYPE personnel.employment_status AS ENUM (
            'active', 'on_leave', 'sick', 'suspended', 'dismissed'
        )
    """)
    op.execute("""
        CREATE TYPE personnel.regime_type AS ENUM (
            'five_day_week', 'shift_schedule', 'twenty_four_hour_duty', 'unstandardized'
        )
    """)
    op.execute("""
        CREATE TYPE personnel.position_category AS ENUM (
            'operational', 'administrative', 'pedagogical', 'hazardous_technical'
        )
    """)
    op.execute("""
        CREATE TYPE personnel.service_condition_category AS ENUM (
            'normal', 'hazardous_or_dangerous', 'pedagogical'
        )
    """)
    # See deviation (1) in the module docstring.
    op.execute("CREATE TYPE personnel.legal_base AS ENUM ('fps_service', 'labor_code')")
    op.execute("""
        CREATE TYPE personnel.service_record_event_type AS ENUM (
            'assignment', 'transfer', 'rank_change', 'dismissal'
        )
    """)

    # `hierarchy_path` is `ltree`, not a self-join walked at query time:
    # the whole point of the org tree here is "все подразделения под этим
    # региональным центром" (Frontend_Architecture разд. 2:
    # `/personnel/units` — "дерево, ltree"; Architecture разд. 12.2 names
    # UnitId/регион as the natural partitioning key). `parent_unit_id` is
    # kept alongside it as the authoritative single-step edge — the ltree
    # column is a denormalized materialized path derived from it, so the
    # CHECK below ties the two together: a root has exactly one label, a
    # child has more.
    op.execute("""
        CREATE TABLE personnel.unit (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            code            text NOT NULL,
            name            text NOT NULL,
            parent_unit_id  uuid REFERENCES personnel.unit(id),
            hierarchy_path  ltree NOT NULL,
            created_at      timestamptz NOT NULL DEFAULT now(),

            CONSTRAINT uq_unit_code UNIQUE (code),
            CONSTRAINT ck_unit_root_path CHECK (
                (parent_unit_id IS NULL AND nlevel(hierarchy_path) = 1) OR
                (parent_unit_id IS NOT NULL AND nlevel(hierarchy_path) > 1)
            )
        )
    """)
    # GiST is what makes the ltree ancestor/descendant operators (`@>`,
    # `<@`, `~`) index-backed — DB008's DoD ("запрос по ltree-иерархии
    # использует gist-индекс (EXPLAIN)") is about exactly this index.
    op.execute("CREATE INDEX ix_unit_hierarchy_gist ON personnel.unit USING gist (hierarchy_path)")
    op.execute("CREATE INDEX ix_unit_parent ON personnel.unit (parent_unit_id)")

    op.execute("""
        CREATE TABLE personnel."position" (
            id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            code                 text NOT NULL,
            title                text NOT NULL,
            category             personnel.position_category NOT NULL,
            default_regime_type  personnel.regime_type NOT NULL,

            CONSTRAINT uq_position_code UNIQUE (code)
        )
    """)


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS personnel."position"')
    op.execute("DROP TABLE IF EXISTS personnel.unit")
    op.execute("DROP TYPE IF EXISTS personnel.service_record_event_type")
    op.execute("DROP TYPE IF EXISTS personnel.legal_base")
    op.execute("DROP TYPE IF EXISTS personnel.service_condition_category")
    op.execute("DROP TYPE IF EXISTS personnel.position_category")
    op.execute("DROP TYPE IF EXISTS personnel.regime_type")
    op.execute("DROP TYPE IF EXISTS personnel.employment_status")
    op.execute("DROP SCHEMA IF EXISTS personnel CASCADE")
