"""0022_leave_management

DB018 — схема `leave_management`: предоставление отпуска и отзыв из него.

PostgreSQL_Logical_Model разд. 8.

--- Инвариант 9.1.1 и почему `[)` здесь существенны --------------------

«`LeavePeriod` одного сотрудника не пересекается с периодом другого
активного отпуска — ЗА ИСКЛЮЧЕНИЕМ присоединения двух смежных отпусков в
единый непрерывный период, что не является пересечением, а стыковкой
границ».

Оговорка не абстрактная: Приказ МЧС России № 410 п. 12 прямо допускает
присоединение дополнительных дней отдыха к ежегодному отпуску, а ФЗ-141
ст. 63 — соединение частей отпуска. Основной отпуск, заканчивающийся 15
марта, и дополнительный, начинающийся 15 марта, обязаны сосуществовать.

`daterange` с границами `[)` делает это само: `[2026-03-01,2026-03-15)` и
`[2026-03-15,2026-03-20)` не пересекаются по определению оператора `&&`.
Отдельного «режима присоединения» не нужно — нужна правильная граница.

--- Почему EXCLUDE частичный ------------------------------------------

`WHERE status IN ('active','recalled')`: отменённый отпуск не занимает
календарь. Отозванный — занимает: сотрудник в нём был, и перекрыть эти
даты новым отпуском значило бы выдать их дважды. Неиспользованный остаток
оформляется НОВЫМ предоставлением (инвариант 9.1.3), а не растягиванием
старого.

--- Инвариант 9.1.2 индексом, а не сервисом ---------------------------

Отпуск по личным обстоятельствам при стаже 20+ лет (ФЗ-141 ст. 64 ч. 1
п. 2) даётся один раз за службу. Domain Model относит это к доменному
сервису, потому что проверка межагрегатная. Верно — и всё же последнее
слово за БД: сервис проверяет в своей транзакции, а два одновременных
приказа увидят одинаковое «ещё не выдавался» и оба пройдут.

`WHERE status <> 'cancelled'`: ошибочно оформленный и отменённый приказ
права не расходует — иначе опечатка кадровика лишала бы сотрудника
отпуска навсегда.

--- `recall_event` --------------------------------------------------

Отзыв из отпуска (ФЗ-141 ст. 65) фиксирует ФАКТ прерывания и делит период
на использованную и неиспользованную части. Событий может быть несколько:
сотрудника, отозванного из отпуска и вернувшегося в него, могут отозвать
снова, и каждый отзыв — отдельный приказ.

`CHECK (effective_from >= recall_date)` из логической модели: приказ об
отзыве не может прерывать отпуск раньше, чем он издан.

Обе таблицы append-only в части уже случившегося: `recall_event` не
редактируется вовсе, у `leave_grant` меняется только `status` — сам
период и тип неизменны. Ошибочное предоставление отменяется
(`cancelled`), а не переписывается.

Revision ID: 0022
Revises: 0021
Create Date: 2026-08-06
"""

from __future__ import annotations

from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS leave_management")

    op.execute("""
        CREATE TYPE leave_management.leave_type AS ENUM (
            'basic',
            'additional',
            'personal_circumstances_20y',
            'maternity',
            'child_care',
            'educational'
        )
    """)
    op.execute("""
        CREATE TYPE leave_management.leave_status AS ENUM (
            'active', 'recalled', 'completed', 'cancelled'
        )
    """)

    op.execute("""
        CREATE TABLE leave_management.leave_grant (
            id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            employee_id  uuid NOT NULL REFERENCES personnel.employee(id),
            leave_type   leave_management.leave_type NOT NULL,
            leave_period daterange NOT NULL,
            entitlement_basis_rule_version_id uuid NOT NULL,
            -- ADDITIVE к логической модели: продолжительность, на которую
            -- было право, и стаж, из которого она выведена. ФЗ-141 ст. 58
            -- ч. 3 ставит длительность в зависимость от выслуги, поэтому
            -- пересчёт задним числом дал бы другое число дней — а
            -- объяснить расхождение было бы нечем.
            entitled_days   integer NOT NULL,
            seniority_years integer,
            status       leave_management.leave_status NOT NULL DEFAULT 'active',
            -- Сутки ДДО, присоединённые к отпуску (Приказ № 410 п. 12).
            -- Ноль — не «не присоединяли», а «присоединили ноль»: разницы
            -- между ними нет, и заводить NULL ради неё незачем.
            attached_rest_days numeric(6,2) NOT NULL DEFAULT 0,
            created_at   timestamptz NOT NULL DEFAULT now(),

            CONSTRAINT ck_leave_period_not_empty CHECK (NOT isempty(leave_period)),
            CONSTRAINT ck_leave_period_bounds CHECK (
                lower_inc(leave_period) AND NOT upper_inc(leave_period)
            ),
            CONSTRAINT ck_attached_rest_days_non_negative CHECK (attached_rest_days >= 0),
            CONSTRAINT ck_entitled_days_positive CHECK (entitled_days > 0),

            CONSTRAINT excl_leave_period_no_overlap EXCLUDE USING gist (
                employee_id WITH =,
                leave_period WITH &&
            ) WHERE (status IN ('active', 'recalled'))
        )
    """)

    op.execute("""
        CREATE UNIQUE INDEX uq_leave_personal_circumstances_once
            ON leave_management.leave_grant (employee_id)
            WHERE leave_type = 'personal_circumstances_20y' AND status <> 'cancelled'
    """)

    op.execute("""
        CREATE INDEX ix_leave_grant_employee
            ON leave_management.leave_grant (employee_id, lower(leave_period) DESC)
    """)

    op.execute("""
        CREATE TABLE leave_management.recall_event (
            id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            leave_grant_id uuid NOT NULL
                REFERENCES leave_management.leave_grant(id),
            recall_date    date NOT NULL,
            effective_from date NOT NULL,
            created_at     timestamptz NOT NULL DEFAULT now(),

            CONSTRAINT ck_recall_effective_after_recall CHECK (
                effective_from >= recall_date
            )
        )
    """)
    op.execute("""
        CREATE INDEX ix_recall_event_grant
            ON leave_management.recall_event (leave_grant_id)
    """)

    # Отзыв — свершившийся факт: приказ издан, сотрудник вызван из
    # отпуска. Правка задним числом означала бы, что прерывания не было.
    op.execute("""
        CREATE OR REPLACE FUNCTION leave_management.fn_recall_event_append_only()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION
                'запись об отзыве из отпуска неизменяема: отзыв — свершившийся '
                'факт (ФЗ-141 ст. 65), и правка задним числом означала бы, что '
                'прерывания не было'
                USING ERRCODE = 'restrict_violation';
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER trg_recall_event_append_only
            BEFORE UPDATE OR DELETE ON leave_management.recall_event
            FOR EACH ROW EXECUTE FUNCTION leave_management.fn_recall_event_append_only()
    """)

    # У предоставления меняется только статус и число присоединённых
    # суток. Период и тип — содержание приказа, и переписать их значило
    # бы подменить приказ, а не исправить ошибку.
    op.execute("""
        CREATE OR REPLACE FUNCTION leave_management.fn_leave_grant_immutability()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF NEW.employee_id <> OLD.employee_id
               OR NEW.leave_type <> OLD.leave_type
               OR NEW.leave_period <> OLD.leave_period THEN
                RAISE EXCEPTION
                    'сотрудник, тип и период отпуска неизменяемы: ошибочное '
                    'предоставление отменяется (status = cancelled) и оформляется '
                    'заново, а не переписывается'
                    USING ERRCODE = 'restrict_violation';
            END IF;
            RETURN NEW;
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER trg_leave_grant_immutability
            BEFORE UPDATE ON leave_management.leave_grant
            FOR EACH ROW EXECUTE FUNCTION leave_management.fn_leave_grant_immutability()
    """)

    op.execute("""
        CREATE TABLE leave_management.outbox_message (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            event_id        uuid NOT NULL,
            event_type      text NOT NULL,
            aggregate_type  text NOT NULL,
            aggregate_id    uuid NOT NULL,
            payload         jsonb NOT NULL,
            occurred_at     timestamptz NOT NULL,
            created_at      timestamptz NOT NULL DEFAULT now(),
            published_at    timestamptz,
            attempts        integer NOT NULL DEFAULT 0,
            last_error      text,

            CONSTRAINT uq_leave_outbox_event_id UNIQUE (event_id),
            CONSTRAINT ck_leave_outbox_attempts_non_negative CHECK (attempts >= 0)
        )
    """)
    op.execute("""
        CREATE INDEX ix_leave_outbox_unpublished
            ON leave_management.outbox_message (occurred_at)
            WHERE published_at IS NULL
    """)
    op.execute("""
        CREATE INDEX ix_leave_outbox_aggregate
            ON leave_management.outbox_message (aggregate_type, aggregate_id, occurred_at)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS leave_management.outbox_message")
    op.execute("""
        DROP TRIGGER IF EXISTS trg_leave_grant_immutability
            ON leave_management.leave_grant
    """)
    op.execute("DROP FUNCTION IF EXISTS leave_management.fn_leave_grant_immutability()")
    op.execute("""
        DROP TRIGGER IF EXISTS trg_recall_event_append_only
            ON leave_management.recall_event
    """)
    op.execute("DROP FUNCTION IF EXISTS leave_management.fn_recall_event_append_only()")
    op.execute("DROP TABLE IF EXISTS leave_management.recall_event")
    op.execute("DROP TABLE IF EXISTS leave_management.leave_grant")
    op.execute("DROP TYPE IF EXISTS leave_management.leave_status")
    op.execute("DROP TYPE IF EXISTS leave_management.leave_type")
    op.execute("DROP SCHEMA IF EXISTS leave_management CASCADE")
