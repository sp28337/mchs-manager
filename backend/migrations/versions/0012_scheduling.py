"""0012_scheduling

DB013: схема scheduling + duty_schedule/planned_shift (EXCLUDE).

DDL перенесён из PostgreSQL_Logical_Model_FPS.md разд. 4 дословно — это
проектный артефакт, а миграция его буквальное применение.

--- Два замечания, которые стоит держать в голове ----------------------

**1. EXCLUDE по `employee_id` ГЛОБАЛЬНЫЙ, а не внутри одного графика.**
Так в логической модели, и это правильно: инвариант 5.1.1 («у сотрудника
не может быть двух пересекающихся смен») физический, а не
организационный — человек не может нести две смены одновременно
независимо от того, в какие графики они записаны. Побочно это закрывает
и пересечение через границу двух соседних периодов, которое инвариантом
внутри одного агрегата не выражается (Domain Model 5.1.2 отправляет эту
проверку в доменный сервис — но только потому, что о минимальном ОТДЫХЕ
БД судить не может; о пересечении — может).

**2. ОТКРЫТОЕ ПРОТИВОРЕЧИЕ: пересмотр графика (SD009) в текущую схему не
укладывается.** Здесь оно не решается — SD009 имеет приоритет P2 и в этой
миграции не реализуется, — но зафиксировать его нужно, потому что
натыкается на него тот, кто будет делать пересмотр:

* `openapi.yaml` `POST /scheduling/duty-schedules/{id}/revise` отвечает
  `201 Новая версия графика создана`, а Domain Model 5.1.3 требует
  «новую версию с указанием причины и ссылкой на предыдущую»;
* но `uq_duty_schedule_unit_period UNIQUE (unit_id, period_start,
  period_end)` запрещает вторую строку на ту же пару «подразделение +
  период», то есть запрещает саму новую версию;
* и `excl_planned_shift_no_overlap` глобален, поэтому смены новой версии
  пересекались бы со сменами старой и были бы отклонены — даже если бы
  первую проблему решили.

Иначе говоря, «пересмотр» в этой схеме возможен только как правка на
месте, что прямо противоречит и openapi, и Domain Model. Решать это
придётся структурно: `revision_no` в ключе уникальности плюс
денормализованный признак актуальности на `planned_shift`, чтобы EXCLUDE
стал частичным (`WHERE NOT superseded`) — тогда смены пересмотренной
версии сохраняются как история, но перестают конфликтовать. Это отдельная
миграция и отдельное решение, а не то, что стоит вводить впрок, поэтому
схема ниже оставлена ровно такой, как в логической модели.

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-05
"""

from __future__ import annotations

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS scheduling")

    op.execute("""
        CREATE TYPE scheduling.accounting_period_type AS ENUM ('month', 'quarter', 'year')
    """)
    op.execute("""
        CREATE TYPE scheduling.schedule_status AS ENUM ('draft', 'approved', 'closed')
    """)
    op.execute("""
        CREATE TYPE scheduling.duty_type AS ENUM (
            'five_day_week', 'shift', 'twenty_four_hour_duty'
        )
    """)

    op.execute("""
        CREATE TABLE scheduling.duty_schedule (
            id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            -- Ссылка по id на personnel.unit, БЕЗ внешнего ключа: межсхемных
            -- FK в модели нет (разд. 10), и именно их отсутствие делает
            -- границы модулей проверяемыми на уровне БД.
            unit_id             uuid NOT NULL,
            period_type         scheduling.accounting_period_type NOT NULL,
            period_start        date NOT NULL,
            period_end          date NOT NULL,
            status              scheduling.schedule_status NOT NULL DEFAULT 'draft',
            approval_order_ref  text,
            created_at          timestamptz NOT NULL DEFAULT now(),

            CONSTRAINT uq_duty_schedule_unit_period UNIQUE (unit_id, period_start, period_end),
            CONSTRAINT ck_duty_schedule_period CHECK (period_end > period_start),
            -- Утверждение без приказа-основания невозможно: SRS разд. 8 п.11
            -- («без документа-основания») и openapi ApproveScheduleRequest,
            -- где approvalOrderRef обязателен.
            CONSTRAINT ck_duty_schedule_approved_has_order CHECK (
                status <> 'approved' OR approval_order_ref IS NOT NULL
            )
        )
    """)

    op.execute("""
        CREATE TABLE scheduling.planned_shift (
            id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            duty_schedule_id  uuid NOT NULL REFERENCES scheduling.duty_schedule(id),
            employee_id       uuid NOT NULL,
            time_range        tstzrange NOT NULL,
            duty_type         scheduling.duty_type NOT NULL,

            -- Domain Model инвариант 5.1.1. Глобальный по сотруднику —
            -- см. замечание 1 в докстринге модуля.
            CONSTRAINT excl_planned_shift_no_overlap EXCLUDE USING gist (
                employee_id WITH =,
                time_range WITH &&
            ),
            -- VO TimeInterval: «начало строго раньше конца» (Domain Model
            -- разд. 5.1). Пустой или вывернутый диапазон tstzrange
            -- принимает молча, поэтому проверяется явно.
            CONSTRAINT ck_planned_shift_range_not_empty CHECK (NOT isempty(time_range))
        )
    """)

    op.execute("""
        CREATE INDEX ix_planned_shift_schedule
            ON scheduling.planned_shift (duty_schedule_id)
    """)
    op.execute("""
        CREATE INDEX ix_planned_shift_employee
            ON scheduling.planned_shift (employee_id)
    """)
    op.execute("""
        CREATE INDEX ix_duty_schedule_unit_period
            ON scheduling.duty_schedule (unit_id, period_start, period_end)
    """)

    # Transactional Outbox для этого модуля (миграция 0010 завела такие же
    # таблицы для трёх модулей, существовавших на тот момент).
    op.execute("""
        CREATE TABLE scheduling.outbox_message (
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

            CONSTRAINT uq_outbox_event_id UNIQUE (event_id),
            CONSTRAINT ck_outbox_attempts_non_negative CHECK (attempts >= 0)
        )
    """)
    op.execute("""
        CREATE INDEX ix_scheduling_outbox_unpublished
            ON scheduling.outbox_message (occurred_at)
            WHERE published_at IS NULL
    """)
    op.execute("""
        CREATE INDEX ix_scheduling_outbox_aggregate
            ON scheduling.outbox_message (aggregate_type, aggregate_id, occurred_at)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS scheduling.outbox_message")
    op.execute("DROP TABLE IF EXISTS scheduling.planned_shift")
    op.execute("DROP TABLE IF EXISTS scheduling.duty_schedule")
    op.execute("DROP TYPE IF EXISTS scheduling.duty_type")
    op.execute("DROP TYPE IF EXISTS scheduling.schedule_status")
    op.execute("DROP TYPE IF EXISTS scheduling.accounting_period_type")
    op.execute("DROP SCHEMA IF EXISTS scheduling CASCADE")
