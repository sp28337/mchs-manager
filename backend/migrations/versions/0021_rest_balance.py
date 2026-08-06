"""0021_rest_balance

DB017 — схема `rest_balance`: журнал движений и материализованный остаток.

PostgreSQL_Logical_Model разд. 7.

--- Почему остаток — представление, а не колонка ------------------------

Domain Model разд. 8.1: «баланс — накопительный регистр». Хранимая
колонка `balance_days` была бы вторым источником истины о том же факте, и
первое же расхождение с журналом пришлось бы разбирать вручную, не зная,
какая из двух цифр верна. Здесь верна ровно одна вещь — история движений;
остаток из неё выводится.

--- Инвариант 8.1.1 проверяется по журналу, а не по представлению -------

Материализованное представление отстаёт по определению: между двумя
`REFRESH` оно показывает вчерашний остаток. Списание, свёренное с ним,
могло бы увести баланс в минус — и увело бы ровно в тот день, когда
сотрудник подал два рапорта подряд.

Поэтому триггер `BEFORE INSERT` считает остаток по самой таблице
`balance_movement`, а не по `current_balance`. Логическая модель
оговаривает это дословно: «через сам журнал движений, не через
материализованное представление, чтобы избежать гонки при конкурентных
списаниях».

Гонка на этом не заканчивается: две транзакции, читающие журнал
одновременно, увидят один и тот же остаток. Поэтому триггер берёт
`pg_advisory_xact_lock` по `employee_id` — движения одного сотрудника
сериализуются между собой, движения разных не мешают друг другу.

--- Сторно: `reverses_movement_id`, а не `reversed_by_movement_id` -----

Логическая модель называет колонку `reversed_by_movement_id` и кладёт её
на ИСПРАВЛЯЕМУЮ строку: «эта запись сторнирована вот той». Такая связь
требует `UPDATE` исходной строки — то есть ровно того, что тот же раздел
запрещает (`REVOKE UPDATE, DELETE ON rest_balance.balance_movement`), а
DoD RB006 формулирует как «исходная не изменяется».

Связь перевёрнута: колонка лежит на СТОРНИРУЮЩЕЙ строке и указывает на
исправляемую. Сведения те же, `UPDATE` не нужен. Тот же приём, что
`corrects_case_id` в `compensation` (миграция 0017), и то же имя по
смыслу.

`reversal_reason` рядом — инвариант 8.1.3 требует сторно «с указанием
причины»: движение, отменённое без объяснения, для служебной проверки
неотличимо от ошибки оператора.

--- Начисление обязано иметь основание ---------------------------------

Инвариант 8.1.2: `accrual` без `compensation_line_id` невозможен —
начисление ДДО не может возникнуть вне процесса компенсации. Проверяется
`CHECK`, а не приложением: это утверждение о данных, и оно должно быть
верно для строк, вставленных мимо приложения тоже.

FK на `compensation.compensation_line` — межсхемный, и он здесь уместен:
разд. 10 запрещает модулю ЧИТАТЬ чужие таблицы, а не ссылаться на них
ключом. Ссылка гарантирует, что основание существует; содержимое строки
`rest_balance` всё равно получает событием.

Revision ID: 0021
Revises: 0020
Create Date: 2026-08-06
"""

from __future__ import annotations

from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS rest_balance")

    op.execute("""
        CREATE TYPE rest_balance.movement_type AS ENUM ('accrual', 'consumption')
    """)

    op.execute("""
        CREATE TABLE rest_balance.balance_movement (
            id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            employee_id           uuid NOT NULL REFERENCES personnel.employee(id),
            movement_type         rest_balance.movement_type NOT NULL,
            amount_days           numeric(6,2) NOT NULL,
            movement_date         date NOT NULL,
            compensation_line_id  uuid REFERENCES compensation.compensation_line(id),
            leave_grant_id        uuid,
            reverses_movement_id  uuid REFERENCES rest_balance.balance_movement(id),
            reversal_reason       text,
            created_at            timestamptz NOT NULL DEFAULT now(),

            CONSTRAINT ck_balance_movement_amount_positive CHECK (amount_days > 0),

            -- Инвариант 8.1.2.
            CONSTRAINT ck_balance_accrual_requires_source CHECK (
                movement_type <> 'accrual' OR compensation_line_id IS NOT NULL
            ),

            -- Инвариант 8.1.3: причина обязательна ровно у сторно и
            -- бессмысленна у обычного движения.
            CONSTRAINT ck_balance_reversal_has_reason CHECK (
                (reverses_movement_id IS NULL AND reversal_reason IS NULL)
                OR (reverses_movement_id IS NOT NULL
                    AND reversal_reason IS NOT NULL
                    AND length(btrim(reversal_reason)) >= 8)
            )
        )
    """)

    op.execute("""
        CREATE INDEX ix_balance_movement_employee
            ON rest_balance.balance_movement (employee_id, movement_date)
    """)

    # Одно начисление на строку компенсации, не больше: событие
    # `CompensationLineCreated` доставляется at-least-once (Redis Streams,
    # consumer group), и повтор обязан быть безвредным. Частичный —
    # `consumption` строку компенсации не назначает.
    op.execute("""
        CREATE UNIQUE INDEX uq_balance_accrual_per_compensation_line
            ON rest_balance.balance_movement (compensation_line_id)
            WHERE movement_type = 'accrual' AND reverses_movement_id IS NULL
    """)

    # Сторнировать движение можно один раз: второе сторно того же
    # движения вернуло бы сотруднику сутки, которых у него не было.
    op.execute("""
        CREATE UNIQUE INDEX uq_balance_movement_reversed_once
            ON rest_balance.balance_movement (reverses_movement_id)
            WHERE reverses_movement_id IS NOT NULL
    """)

    op.execute("""
        CREATE MATERIALIZED VIEW rest_balance.current_balance AS
        SELECT
            employee_id,
            SUM(
                CASE WHEN movement_type = 'accrual' THEN amount_days ELSE -amount_days END
            ) AS balance_days
        FROM rest_balance.balance_movement
        GROUP BY employee_id
    """)

    # UNIQUE, а не просто INDEX: без уникального индекса PostgreSQL
    # отказывает в `REFRESH MATERIALIZED VIEW CONCURRENTLY`, то есть
    # каждый пересчёт блокировал бы чтение остатка.
    op.execute("""
        CREATE UNIQUE INDEX ix_current_balance_employee
            ON rest_balance.current_balance (employee_id)
    """)

    op.execute("""
        CREATE OR REPLACE FUNCTION rest_balance.fn_balance_stays_non_negative()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            current_balance numeric(8,2);
        BEGIN
            IF NEW.movement_type <> 'consumption' THEN
                RETURN NEW;
            END IF;

            -- Движения одного сотрудника сериализуются: без этого две
            -- транзакции прочитали бы один и тот же остаток и обе прошли
            -- бы проверку. Блокировка транзакционная — снимается сама.
            PERFORM pg_advisory_xact_lock(hashtextextended(NEW.employee_id::text, 0));

            SELECT COALESCE(SUM(
                CASE WHEN movement_type = 'accrual' THEN amount_days ELSE -amount_days END
            ), 0)
              INTO current_balance
              FROM rest_balance.balance_movement
             WHERE employee_id = NEW.employee_id;

            IF current_balance - NEW.amount_days < 0 THEN
                RAISE EXCEPTION
                    'списание % сут. превышает остаток % сут. у сотрудника % '
                    '(Domain Model инвариант 8.1.1)',
                    NEW.amount_days, current_balance, NEW.employee_id
                    USING ERRCODE = 'check_violation';
            END IF;

            RETURN NEW;
        END;
        $$
    """)

    op.execute("""
        CREATE TRIGGER trg_balance_stays_non_negative
            BEFORE INSERT ON rest_balance.balance_movement
            FOR EACH ROW EXECUTE FUNCTION rest_balance.fn_balance_stays_non_negative()
    """)

    # Append-only. Сторно — новая строка, а не правка старой.
    op.execute("""
        CREATE OR REPLACE FUNCTION rest_balance.fn_balance_movement_append_only()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION
                'движение баланса ДДО неизменяемо (Domain Model инвариант 8.1.3): '
                'ошибочное движение сторнируется обратной записью с указанием причины, '
                'а не правкой существующей'
                USING ERRCODE = 'restrict_violation';
        END;
        $$
    """)

    op.execute("""
        CREATE TRIGGER trg_balance_movement_append_only
            BEFORE UPDATE OR DELETE ON rest_balance.balance_movement
            FOR EACH ROW EXECUTE FUNCTION rest_balance.fn_balance_movement_append_only()
    """)

    op.execute("""
        CREATE TABLE rest_balance.outbox_message (
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

            CONSTRAINT uq_rest_balance_outbox_event_id UNIQUE (event_id),
            CONSTRAINT ck_rest_balance_outbox_attempts_non_negative CHECK (attempts >= 0)
        )
    """)
    op.execute("""
        CREATE INDEX ix_rest_balance_outbox_unpublished
            ON rest_balance.outbox_message (occurred_at)
            WHERE published_at IS NULL
    """)
    op.execute("""
        CREATE INDEX ix_rest_balance_outbox_aggregate
            ON rest_balance.outbox_message (aggregate_type, aggregate_id, occurred_at)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS rest_balance.outbox_message")
    op.execute("""
        DROP TRIGGER IF EXISTS trg_balance_movement_append_only
            ON rest_balance.balance_movement
    """)
    op.execute("DROP FUNCTION IF EXISTS rest_balance.fn_balance_movement_append_only()")
    op.execute("""
        DROP TRIGGER IF EXISTS trg_balance_stays_non_negative
            ON rest_balance.balance_movement
    """)
    op.execute("DROP FUNCTION IF EXISTS rest_balance.fn_balance_stays_non_negative()")
    op.execute("DROP MATERIALIZED VIEW IF EXISTS rest_balance.current_balance")
    op.execute("DROP TABLE IF EXISTS rest_balance.balance_movement")
    op.execute("DROP TYPE IF EXISTS rest_balance.movement_type")
    op.execute("DROP SCHEMA IF EXISTS rest_balance CASCADE")
