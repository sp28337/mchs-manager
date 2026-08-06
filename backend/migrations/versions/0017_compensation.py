"""0017_compensation

DB016: схема compensation + compensation_case/compensation_line.

DDL из PostgreSQL_Logical_Model_FPS.md разд. 6. Три места решены, а не
перенесены.

--- 1. `rule_category` на строке компенсации — это категория ЧАСОВ ------

Логическая модель объявляет `compensation_line.rule_category
legal_rules.rule_category`. Это та же ошибка, что уже была найдена в
`precedence_list` (см. `HourCategory` в `legal_rules`): Domain Model
разд. 7.1 перечисляет содержимое поля прямо — «`RuleCategory`
(Overtime/Night/Holiday)», а Алгоритм К шаг 2 добавляет `weekend`. Ни
одно из этих значений не является `RuleCategory` (там
`holiday_hours_classification`, `compensation_coefficient` и подобные), а
про выходные у неё нет вообще ничего.

Строка компенсации отвечает на вопрос «за какие часы платим», а не «каким
правилом это установлено» — второе несёт
`legal_basis_rule_version_id`. Поэтому здесь собственный тип
`compensation.hour_category` с теми же значениями, что у
`legal_rules.HourCategory`.

Собственный, а не ссылка на чужую схему, — по той же причине, что в
миграции 0014 п. 3(б): межсхемная зависимость типов лишает смысла
заявленную разд. 10 выгоду «миграции одной схемы не блокируются
структурой другой».

--- 2. Инвариант 7.1.2 в БД непроверяем, но кое-что проверить можно -----

«Сумма часов компенсации по категории ≤ HoursBreakdown» требует данных
другого модуля, и логическая модель справедливо отправляет проверку в
Application. Но из этого не следует, что на уровне схемы делать нечего:

* `uq_compensation_line_case_category` — по одной строке на категорию в
  деле. Без него две строки `night` по 8 ч каждая прошли бы проверку
  «каждая ≤ 12 ч» по отдельности, а в сумме дали бы 16 ч из 12
  возможных. Это ровно то задвоение, ради запрета которого инвариант и
  написан, и оно выражается декларативно.
* `ck_compensation_line_hours_positive` — строка на ноль часов не
  компенсация, а шум: категория без часов просто не порождает строки
  (Алгоритм К шаг 2 — «для каждой НЕПУСТОЙ категории»).

--- 3. Неизменяемость финализированного дела (инвариант 7.1.4) ---------

Триггер, как и у табеля: правило про ПЕРЕХОДЫ, а `CHECK` видит только
новую строку. Из `finalized` не выходит ни один путь — в отличие от
табеля, у которого есть `reopened`. Так и задумано: «исправление возможно
только новым `CompensationCase`-корректировкой, ссылающейся на предыдущее
дело», поэтому добавлена колонка `corrects_case_id` — без неё
предписанный Domain Model способ исправления выразить нечем.

Состав строк финализированного дела тоже заморожен: начисление уже
произошло, и добавить строку задним числом значило бы изменить сумму,
которая где-то уже выплачена или зачтена в баланс ДДО.

Revision ID: 0017
Revises: 0016
Create Date: 2026-08-05
"""

from __future__ import annotations

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS compensation")

    op.execute("""
        CREATE TYPE compensation.case_status AS ENUM ('draft', 'finalized')
    """)
    op.execute("""
        CREATE TYPE compensation.compensation_form AS ENUM ('monetary', 'additional_rest_time')
    """)
    # Категория ЧАСОВ, а не правила — см. п. 1 докстринга.
    op.execute("""
        CREATE TYPE compensation.hour_category AS ENUM (
            'night', 'holiday', 'weekend', 'overtime'
        )
    """)

    op.execute("""
        CREATE TABLE compensation.compensation_case (
            id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            -- Ссылки на personnel.employee и time_accounting.timesheet
            -- без FK: межсхемные (разд. 10).
            employee_id      uuid NOT NULL,
            timesheet_id     uuid NOT NULL,
            period_start     date NOT NULL,
            period_end       date NOT NULL,
            status           compensation.case_status NOT NULL DEFAULT 'draft',
            -- Инвариант 7.1.4: «исправление возможно только новым
            -- CompensationCase-корректировкой, ссылающейся на предыдущее
            -- дело». Внутрисхемный FK, поэтому настоящий.
            corrects_case_id uuid REFERENCES compensation.compensation_case(id),
            created_at       timestamptz NOT NULL DEFAULT now(),
            finalized_at     timestamptz,

            CONSTRAINT ck_compensation_case_period CHECK (period_end > period_start),
            CONSTRAINT ck_compensation_case_not_self_correcting CHECK (
                corrects_case_id IS NULL OR corrects_case_id <> id
            ),
            CONSTRAINT ck_compensation_case_finalized_has_time CHECK (
                (status = 'finalized') = (finalized_at IS NOT NULL)
            )
        )
    """)

    # Уникальность пары «сотрудник + период» и уникальность табеля —
    # ЧАСТИЧНЫЕ, `WHERE corrects_case_id IS NULL`.
    #
    # Логическая модель объявляет их полными, но это делает невозможным
    # то самое исправление, которого требует инвариант 7.1.4: дело-
    # корректировка относится к тому же сотруднику, периоду и табелю, что
    # исправляемое. Полный уникальный индекс запретил бы его существование
    # — ровно как `uq_duty_schedule_unit_period` запрещал пересмотр
    # графика, пока миграция 0013 не сделала его частичным.
    op.execute("""
        CREATE UNIQUE INDEX uq_compensation_case_employee_period
            ON compensation.compensation_case (employee_id, period_start, period_end)
            WHERE corrects_case_id IS NULL
    """)
    op.execute("""
        CREATE UNIQUE INDEX uq_compensation_case_timesheet
            ON compensation.compensation_case (timesheet_id)
            WHERE corrects_case_id IS NULL
    """)
    op.execute("""
        CREATE INDEX ix_compensation_case_employee
            ON compensation.compensation_case (employee_id, period_start DESC)
    """)

    op.execute("""
        CREATE TABLE compensation.compensation_line (
            id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            case_id                     uuid NOT NULL
                                             REFERENCES compensation.compensation_case(id),
            hour_category               compensation.hour_category NOT NULL,
            hours_amount                numeric(8,2) NOT NULL,
            compensation_form           compensation.compensation_form NOT NULL,
            -- Ссылка на legal_rules.rule_version, без FK (разд. 10).
            -- NOT NULL: строка компенсации без правового основания — это
            -- начисление «из воздуха» (Алгоритм К шаг 9, провенанс).
            legal_basis_rule_version_id uuid NOT NULL,
            employee_election_at        timestamptz,

            CONSTRAINT ck_compensation_line_hours_positive CHECK (hours_amount > 0),
            -- См. п. 2 докстринга: не даёт задвоить категорию внутри дела.
            CONSTRAINT uq_compensation_line_case_category UNIQUE (case_id, hour_category)
        )
    """)
    op.execute("""
        CREATE INDEX ix_compensation_line_case
            ON compensation.compensation_line (case_id)
    """)

    # ------------------------------------------------ инвариант 7.1.4
    op.execute("""
        CREATE FUNCTION compensation.fn_case_immutability()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF OLD.status = 'finalized' THEN
                RAISE EXCEPTION
                    'compensation_case %: дело финализировано и неизменяемо; исправление '
                    'оформляется новым делом-корректировкой (Domain Model инвариант 7.1.4)',
                    OLD.id
                    USING ERRCODE = 'restrict_violation';
            END IF;

            IF NEW.employee_id  IS DISTINCT FROM OLD.employee_id
            OR NEW.timesheet_id IS DISTINCT FROM OLD.timesheet_id
            OR NEW.period_start IS DISTINCT FROM OLD.period_start
            OR NEW.period_end   IS DISTINCT FROM OLD.period_end THEN
                RAISE EXCEPTION
                    'compensation_case %: сотрудник, табель и период неизменяемы', OLD.id
                    USING ERRCODE = 'restrict_violation';
            END IF;

            RETURN NEW;
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER trg_compensation_case_immutability
            BEFORE UPDATE ON compensation.compensation_case
            FOR EACH ROW
            EXECUTE FUNCTION compensation.fn_case_immutability()
    """)

    op.execute("""
        CREATE FUNCTION compensation.fn_line_requires_draft_case()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            v_status compensation.case_status;
            v_case   uuid;
        BEGIN
            v_case := COALESCE(NEW.case_id, OLD.case_id);
            SELECT status INTO v_status
              FROM compensation.compensation_case
             WHERE id = v_case;

            IF v_status = 'finalized' THEN
                RAISE EXCEPTION
                    'compensation_case %: состав строк финализированного дела неизменяем; '
                    'начисление уже произошло', v_case
                    USING ERRCODE = 'restrict_violation';
            END IF;

            RETURN COALESCE(NEW, OLD);
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER trg_compensation_line_requires_draft_case
            BEFORE INSERT OR UPDATE OR DELETE ON compensation.compensation_line
            FOR EACH ROW
            EXECUTE FUNCTION compensation.fn_line_requires_draft_case()
    """)

    op.execute("""
        CREATE TABLE compensation.outbox_message (
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
        CREATE INDEX ix_compensation_outbox_unpublished
            ON compensation.outbox_message (occurred_at)
            WHERE published_at IS NULL
    """)
    op.execute("""
        CREATE INDEX ix_compensation_outbox_aggregate
            ON compensation.outbox_message (aggregate_type, aggregate_id, occurred_at)
    """)


def downgrade() -> None:
    op.execute("""
        DROP TRIGGER IF EXISTS trg_compensation_line_requires_draft_case
            ON compensation.compensation_line
    """)
    op.execute("DROP FUNCTION IF EXISTS compensation.fn_line_requires_draft_case()")
    op.execute("""
        DROP TRIGGER IF EXISTS trg_compensation_case_immutability
            ON compensation.compensation_case
    """)
    op.execute("DROP FUNCTION IF EXISTS compensation.fn_case_immutability()")
    op.execute("DROP TABLE IF EXISTS compensation.outbox_message")
    op.execute("DROP TABLE IF EXISTS compensation.compensation_line")
    op.execute("DROP TABLE IF EXISTS compensation.compensation_case")
    op.execute("DROP TYPE IF EXISTS compensation.hour_category")
    op.execute("DROP TYPE IF EXISTS compensation.compensation_form")
    op.execute("DROP TYPE IF EXISTS compensation.case_status")
    op.execute("DROP SCHEMA IF EXISTS compensation CASCADE")
