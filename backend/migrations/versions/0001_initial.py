"""0001_initial

Начальная схема приложения сверки табеля.

--- Почему цепочка миграций начата заново --------------------------------

Прежние двадцать две миграции описывали ведомственную систему учёта:
подразделения с ltree-иерархией, графики дежурств, дела о компенсации,
баланс суток отдыха, версии нормативных правил. От этой системы
приложение отказалось целиком, и хранить историю схем, которых больше
нет, значило бы заставлять каждого нового разработчика проходить через
двадцать две миграции ради двух таблиц.

История не потеряна: она в git. Данных в бою не было.

--- Что осталось --------------------------------------------------------

`service_calendar` — производственный календарь. Он не вспомогательный
справочник, а вход расчёта: норма периода считается по числу рабочих и
предпраздничных дней (ст. 104, 95 ТК РФ), и без него сверять нечего.
Схема перенесена без изменений вместе с её ограничениями и триггерами.

`shift_accounting` — профиль пожарного, его отсутствия и сохранённые
данные выданного табеля.

Revision ID: 0001
Revises:
Create Date: 2026-08-07
"""

from __future__ import annotations

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    # ---------------------------------------------- производственный календарь
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

    # --------------------------------------------------- учёт смен пожарного

    op.execute("CREATE SCHEMA IF NOT EXISTS shift_accounting")

    op.execute("""
        CREATE TYPE shift_accounting.employment_kind AS ENUM ('attested', 'civilian')
    """)
    op.execute("CREATE TYPE shift_accounting.gender AS ENUM ('male', 'female')")
    op.execute("""
        CREATE TYPE shift_accounting.working_conditions AS ENUM (
            'normal', 'harmful_or_dangerous'
        )
    """)
    op.execute("""
        CREATE TYPE shift_accounting.absence_kind AS ENUM (
            'annual_leave', 'sick_leave', 'study_leave',
            'unpaid_leave', 'business_trip', 'other_excused'
        )
    """)

    # Профиль — всё, что нужно, чтобы построить график и вывести норму.
    # Больше ничего: ни фамилии, ни табельного номера, ни подразделения.
    # Это личный инструмент, и данные, которые ему не нужны для расчёта,
    # он не собирает.
    op.execute("""
        CREATE TABLE shift_accounting.profile (
            id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            display_name        varchar(200) NOT NULL,
            employment_kind     shift_accounting.employment_kind NOT NULL,
            gender              shift_accounting.gender NOT NULL,
            working_conditions  shift_accounting.working_conditions NOT NULL
                                    DEFAULT 'normal',
            rural_locality      boolean NOT NULL DEFAULT false,
            guard_number        smallint NOT NULL,
            first_shift_date    date NOT NULL,
            accounting_year     integer NOT NULL,
            created_at          timestamptz NOT NULL DEFAULT now(),
            updated_at          timestamptz NOT NULL DEFAULT now(),

            CONSTRAINT ck_profile_guard CHECK (guard_number BETWEEN 1 AND 4),
            CONSTRAINT ck_profile_year CHECK (accounting_year BETWEEN 2000 AND 2100),
            -- Первая смена караула лежит в первых четырёх сутках года:
            -- цикл «сутки через трое» четырёхдневный, и пятое января —
            -- это уже вторая смена какого-то из караулов, а не первая.
            CONSTRAINT ck_profile_first_shift CHECK (
                EXTRACT(YEAR FROM first_shift_date)::integer = accounting_year
                AND EXTRACT(DOY FROM first_shift_date)::integer BETWEEN 1 AND 4
            )
        )
    """)

    # Отсутствия. Границы ВКЛЮЧИТЕЛЬНЫЕ — так их пишут в приказе об
    # отпуске и в больничном листе; полуинтервал здесь дал бы ошибку на
    # сутки ровно там, где сутки и есть предмет спора.
    op.execute("""
        CREATE TABLE shift_accounting.absence (
            id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            profile_id   uuid NOT NULL REFERENCES shift_accounting.profile (id)
                             ON DELETE CASCADE,
            kind         shift_accounting.absence_kind NOT NULL,
            starts_on    date NOT NULL,
            ends_on      date NOT NULL,
            note         varchar(500),
            created_at   timestamptz NOT NULL DEFAULT now(),

            CONSTRAINT ck_absence_order CHECK (ends_on >= starts_on)
        )
    """)
    # Пересекающиеся отсутствия запрещены: смена, попавшая и в отпуск, и
    # в больничный, была бы исключена из нормы дважды — то есть норма
    # уменьшилась бы на 48 часов за одни сутки.
    op.execute("""
        ALTER TABLE shift_accounting.absence
            ADD CONSTRAINT excl_absence_no_overlap
            EXCLUDE USING gist (
                profile_id WITH =,
                daterange(starts_on, ends_on, '[]') WITH &&
            )
    """)
    op.execute("""
        CREATE INDEX ix_absence_profile_period
            ON shift_accounting.absence (profile_id, starts_on)
    """)

    # Числа из выданного табеля — то, с чем сверяемся. Хранятся, чтобы
    # спор можно было продолжить завтра, а не вводить всё заново.
    op.execute("""
        CREATE TABLE shift_accounting.reported_timesheet (
            id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            profile_id     uuid NOT NULL REFERENCES shift_accounting.profile (id)
                               ON DELETE CASCADE,
            period_start   date NOT NULL,
            period_end     date NOT NULL,
            norm_hours     numeric(8,2),
            actual_hours   numeric(8,2),
            overtime_hours numeric(8,2),
            recorded_at    timestamptz NOT NULL DEFAULT now(),

            CONSTRAINT ck_reported_period CHECK (period_end > period_start),
            CONSTRAINT uq_reported_period UNIQUE (profile_id, period_start, period_end),
            CONSTRAINT ck_reported_non_negative CHECK (
                COALESCE(norm_hours, 0) >= 0
                AND COALESCE(actual_hours, 0) >= 0
                AND COALESCE(overtime_hours, 0) >= 0
            )
        )
    """)


def downgrade() -> None:
    op.execute("DROP SCHEMA IF EXISTS shift_accounting CASCADE")
    op.execute("DROP SCHEMA IF EXISTS service_calendar CASCADE")
