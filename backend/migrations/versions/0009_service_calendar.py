"""0009_service_calendar

DB012: схема service_calendar + calendar_year/calendar_day.

The производственный календарь is the input every norm calculation reads
(Calculation_Engine Алгоритм Б, шаги 5-7: `working_days_count` and
`pre_holiday_days_count` over the accounting period) and the basis of two
of the three classification algorithms (Алгоритм Д — holiday hours,
Алгоритм Е — weekend hours). It is therefore reference data whose
correctness is load-bearing for money, which is why the constraints below
are stricter than a lookup table would normally warrant.

Three DB-level guarantees, each mirroring a domain invariant:

1. **Every day belongs to its own year** (Domain Model разд. 4.1 инвариант
   1). A plain `CHECK` cannot express this — it would have to read the
   parent row. The composite foreign key does: `calendar_year` carries a
   redundant-looking `UNIQUE (id, year)`, `calendar_day` carries the
   `year` alongside `calendar_year_id` and references that pair, and a
   local `CHECK` ties `year` to the date itself. The three together make
   "a 2027 date filed under the 2026 calendar" unrepresentable rather than
   merely rejected by application code.

2. **No duplicate dates** — `UNIQUE (calendar_year_id, day)`. The other
   half of инвариант 1 ("без пропусков и дублей"); the "no gaps" half is
   checked at publication time by the aggregate, since a year under
   construction is legitimately incomplete.

3. **A published year is frozen** (инвариант 2). Enforced by a trigger
   rather than by application code alone, for the same reason as
   `service_record_entry`'s append-only trigger (migration 0008): the
   application connects as the table owner, and published calendars are
   what historical recalculation (Алгоритм М) reads to reproduce a past
   result. A calendar that changed under a finalized period would make
   every recalculation over it silently wrong.

KNOWN GAP: Domain Model разд. 4.1 инвариант 2 says a correction after
publication "создаёт новую версию календаря года с собственной историей,
старые расчёты продолжают ссылаться на версию, действовавшую на момент
расчёта". That versioning is NOT implemented here: `openapi.yaml`'s
`CalendarYear` schema is `{id, year, published}` with no version field,
and `UNIQUE (year)` below actively prevents a second row for the same
year. What is implemented is the first half — publication freezes the
year. Correcting a published calendar currently requires an explicit
migration/manual intervention rather than a supported operation. Adding
versioning is a contract change (a new field and a new endpoint), so it
is flagged here rather than invented unilaterally.

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-05
"""

from __future__ import annotations

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS service_calendar")

    op.execute("""
        CREATE TYPE service_calendar.day_type AS ENUM (
            'working', 'weekend', 'holiday', 'pre_holiday'
        )
    """)

    op.execute("""
        CREATE TABLE service_calendar.calendar_year (
            id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            year          integer NOT NULL,
            published     boolean NOT NULL DEFAULT false,
            published_at  timestamptz,
            created_at    timestamptz NOT NULL DEFAULT now(),

            CONSTRAINT uq_calendar_year UNIQUE (year),
            -- Referenced by calendar_day's composite FK; see guarantee (1).
            CONSTRAINT uq_calendar_year_id_year UNIQUE (id, year),
            CONSTRAINT ck_calendar_year_range CHECK (year BETWEEN 2000 AND 2100),
            CONSTRAINT ck_calendar_year_published CHECK (
                (published AND published_at IS NOT NULL) OR
                (NOT published AND published_at IS NULL)
            )
        )
    """)

    op.execute("""
        CREATE TABLE service_calendar.calendar_day (
            id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            calendar_year_id  uuid NOT NULL,
            year              integer NOT NULL,
            day               date NOT NULL,
            day_type          service_calendar.day_type NOT NULL,

            CONSTRAINT fk_calendar_day_year
                FOREIGN KEY (calendar_year_id, year)
                REFERENCES service_calendar.calendar_year (id, year)
                ON DELETE CASCADE,
            CONSTRAINT ck_calendar_day_in_year CHECK (EXTRACT(YEAR FROM day)::integer = year),
            CONSTRAINT uq_calendar_day UNIQUE (calendar_year_id, day)
        )
    """)
    # Алгоритмы Б/Д/Е all read by DATE RANGE, and an accounting period
    # (quarter, year) routinely spans a year boundary — so the hot lookup
    # is on `day`, not on `calendar_year_id`.
    op.execute("CREATE INDEX ix_calendar_day_day ON service_calendar.calendar_day (day)")
    op.execute("""
        CREATE INDEX ix_calendar_day_type ON service_calendar.calendar_day (day, day_type)
    """)

    op.execute("""
        CREATE OR REPLACE FUNCTION service_calendar.fn_calendar_day_frozen_after_publish()
        RETURNS trigger AS $$
        DECLARE
            target_year_id uuid;
            is_published   boolean;
        BEGIN
            target_year_id := COALESCE(NEW.calendar_year_id, OLD.calendar_year_id);
            SELECT published INTO is_published
                FROM service_calendar.calendar_year WHERE id = target_year_id;

            IF is_published THEN
                RAISE EXCEPTION
                    'calendar year % is published and immutable: % is not permitted',
                    target_year_id, TG_OP
                    USING ERRCODE = 'restrict_violation';
            END IF;
            RETURN COALESCE(NEW, OLD);
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER trg_calendar_day_frozen_after_publish
            BEFORE INSERT OR UPDATE OR DELETE ON service_calendar.calendar_day
            FOR EACH ROW EXECUTE FUNCTION service_calendar.fn_calendar_day_frozen_after_publish()
    """)

    # Publication is one-way: a published year may not be un-published,
    # which would re-open every day under it to editing and defeat the
    # trigger above.
    op.execute("""
        CREATE OR REPLACE FUNCTION service_calendar.fn_calendar_year_publish_is_one_way()
        RETURNS trigger AS $$
        BEGIN
            IF OLD.published AND NOT NEW.published THEN
                RAISE EXCEPTION 'calendar year % cannot be un-published', OLD.year
                    USING ERRCODE = 'restrict_violation';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER trg_calendar_year_publish_is_one_way
            BEFORE UPDATE ON service_calendar.calendar_year
            FOR EACH ROW EXECUTE FUNCTION service_calendar.fn_calendar_year_publish_is_one_way()
    """)


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_calendar_year_publish_is_one_way "
        "ON service_calendar.calendar_year"
    )
    op.execute(
        "DROP TRIGGER IF EXISTS trg_calendar_day_frozen_after_publish "
        "ON service_calendar.calendar_day"
    )
    op.execute("DROP TABLE IF EXISTS service_calendar.calendar_day")
    op.execute("DROP TABLE IF EXISTS service_calendar.calendar_year")
    op.execute("DROP FUNCTION IF EXISTS service_calendar.fn_calendar_day_frozen_after_publish()")
    op.execute("DROP FUNCTION IF EXISTS service_calendar.fn_calendar_year_publish_is_one_way()")
    op.execute("DROP TYPE IF EXISTS service_calendar.day_type")
    op.execute("DROP SCHEMA IF EXISTS service_calendar CASCADE")
