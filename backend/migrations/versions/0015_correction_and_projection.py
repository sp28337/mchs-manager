"""0015_correction_and_projection

DB015: correction_entry + hours_breakdown_projection.

DDL из PostgreSQL_Logical_Model_FPS.md разд. 5.5-5.6. Две вещи добавлены
сверх модели, и обе — не украшения, а колонки, которые алгоритмы обязаны
куда-то записать.

--- 1. correction_entry действительно append-only ----------------------

Логическая модель разд. 11 предлагает добиваться неизменяемости истории
через `REVOKE UPDATE, DELETE ... FROM app_role`. Здесь, как и в миграции
0008 для `personnel.service_record_entry`, это сделано триггером: в
текущей конфигурации приложение подключается владельцем таблиц, а
владельцу `REVOKE` не мешает — правило выглядело бы соблюдённым, не
будучи им. Триггер срабатывает независимо от роли.

Смысл таблицы требует именно этого: `CorrectionEntry` фиксирует, что
ранее внесённая запись была ошибочной, и сама переписыванию не подлежит —
иначе исправление исправления стёрло бы след первого (Domain Model
разд. 13).

--- 2. Чего не хватало проекции ----------------------------------------

`hours_breakdown_projection` разд. 5.6 не имеет колонок под три величины,
которые алгоритмы предписывают в неё записать. Это не спор с моделью, а
её недосказанность: писать некуда, а писать велено.

* **`weekend_hours`** — Алгоритм Ж шаг 5 выдаёт три итоговые величины
  (`night_hours`, `holiday_hours`, `weekend_hours`), и весь Алгоритм Е
  посвящён вычислению третьей. Без колонки работа Алгоритма Е пропадала
  бы в момент сохранения, а компенсация за работу в выходной (ТК РФ
  ст. 153, ФЗ-141 ст. 55) не имела бы источника.

* **`underworked_explained_hours`** — Алгоритм З шаг 7 дословно: «суммарный
  `underworked_hours` **с разбивкой на explained/unexplained** записывается
  в проекцию `hours_breakdown_projection`». Разбивка юридически
  существенна: недоработка, покрытая больничным, не влечёт последствий для
  сотрудника (инвариант 6.1.3), а необъяснённая — сигнал к проверке.
  Схлопнуть их в одно число значит потерять именно то различие, ради
  которого инвариант написан.

* **`used_conflict_policy_version_id`** — Алгоритм Ж шаг 6: «записать в
  результат также `used_conflict_policy_version_id` (провенанс, аналогично
  Алгоритму Б)». В модели есть только `computed_from_rule_version_id`, то
  есть провенанс нормы, но не провенанс разрешения конфликта категорий. А
  именно порядок приоритетов решает, к какой категории отнесён спорный
  час, — без ссылки на версию политики результат невоспроизводим, что
  прямо ломает инвариант 6.1.5 («повторный расчёт обязан дать идентичный
  результат»).

* **`computed_from_legal_base`** — обещание, зафиксированное в контракте
  `personnel.get_employee_snapshot`: `legal_base` в карточке сотрудника —
  значение НА СЕГОДНЯ, а Алгоритм А шаг 4 требует определять правовую базу
  на дату учётного периода и «записать как атрибут расчёта, не как атрибут
  сотрудника целиком». Без этой колонки пересчёт марта 2024 после перехода
  сотрудника из аттестованного состава в гражданский тихо дал бы другое
  число — без ошибки и без следа.

  Тип — `text`, а не `personnel.legal_base`: это записанное значение
  прошлого, а не живая ссылка на чужой тип (разд. 10, см. также п. 3
  докстринга миграции 0014).

Все добавленные числовые колонки — `NOT NULL DEFAULT 0`, как и остальные
в этой таблице: проекция строится целиком одним расчётом, «неизвестно» в
ней не бывает.

Revision ID: 0015
Revises: 0014
Create Date: 2026-08-05
"""

from __future__ import annotations

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE time_accounting.correction_entry (
            id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            timesheet_id      uuid NOT NULL REFERENCES time_accounting.timesheet(id),
            original_event_id uuid NOT NULL REFERENCES time_accounting.service_time_event(id),
            reason            text NOT NULL,
            created_at        timestamptz NOT NULL DEFAULT now(),
            -- Ссылка на personnel.employee, без FK (разд. 10).
            created_by        uuid NOT NULL,

            -- openapi CreateCorrectionEntryRequest: reason minLength 10.
            -- «Ошибка» без объяснения не является объяснением.
            CONSTRAINT ck_correction_entry_reason_length CHECK (length(btrim(reason)) >= 10)
        )
    """)
    op.execute("""
        CREATE INDEX ix_correction_entry_timesheet
            ON time_accounting.correction_entry (timesheet_id)
    """)
    op.execute("""
        CREATE INDEX ix_correction_entry_original_event
            ON time_accounting.correction_entry (original_event_id)
    """)

    op.execute("""
        CREATE FUNCTION time_accounting.fn_correction_entry_append_only()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION
                'correction_entry: append-only, % запрещён (Domain Model разд. 13)', TG_OP
                USING ERRCODE = 'restrict_violation';
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER trg_correction_entry_append_only
            BEFORE UPDATE OR DELETE ON time_accounting.correction_entry
            FOR EACH ROW
            EXECUTE FUNCTION time_accounting.fn_correction_entry_append_only()
    """)

    op.execute("""
        CREATE TABLE time_accounting.hours_breakdown_projection (
            timesheet_id                 uuid PRIMARY KEY
                                              REFERENCES time_accounting.timesheet(id),
            employee_id                  uuid NOT NULL,
            period_start                 date NOT NULL,
            period_end                   date NOT NULL,
            norm_hours                   numeric(8,2) NOT NULL,
            actual_hours                 numeric(8,2) NOT NULL,
            night_hours                  numeric(8,2) NOT NULL DEFAULT 0,
            holiday_hours                numeric(8,2) NOT NULL DEFAULT 0,
            weekend_hours                numeric(8,2) NOT NULL DEFAULT 0,
            overtime_hours               numeric(8,2) NOT NULL DEFAULT 0,
            underworked_hours            numeric(8,2) NOT NULL DEFAULT 0,
            underworked_explained_hours  numeric(8,2) NOT NULL DEFAULT 0,
            -- Провенанс. Ссылки на legal_rules без FK (разд. 10).
            computed_from_rule_version_id     uuid NOT NULL,
            used_conflict_policy_version_id   uuid,
            computed_from_legal_base          text NOT NULL,
            computed_at                       timestamptz NOT NULL DEFAULT now(),

            -- Отработанное время не бывает отрицательным ни в одной
            -- категории; отрицательное значение здесь означало бы ошибку
            -- расчёта, а не факт.
            CONSTRAINT ck_hours_breakdown_non_negative CHECK (
                norm_hours >= 0 AND actual_hours >= 0 AND night_hours >= 0
                AND holiday_hours >= 0 AND weekend_hours >= 0 AND overtime_hours >= 0
                AND underworked_hours >= 0 AND underworked_explained_hours >= 0
            ),
            -- Алгоритм З шаг 5: объяснённая часть — часть недоработки, а не
            -- слагаемое рядом с ней.
            CONSTRAINT ck_hours_breakdown_explained_within_shortfall CHECK (
                underworked_explained_hours <= underworked_hours
            ),
            -- Алгоритм З шаги 2-3: переработка и недоработка — разные знаки
            -- одной разности, одновременно ненулевыми быть не могут.
            CONSTRAINT ck_hours_breakdown_overtime_xor_shortfall CHECK (
                overtime_hours = 0 OR underworked_hours = 0
            )
        )
    """)

    # Основной паттерн доступа всей системы: «сотрудник смотрит свою сводку
    # за период» (логическая модель разд. 5.6).
    op.execute("""
        CREATE INDEX ix_hours_breakdown_employee_period
            ON time_accounting.hours_breakdown_projection (employee_id, period_start DESC)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS time_accounting.hours_breakdown_projection")
    op.execute("""
        DROP TRIGGER IF EXISTS trg_correction_entry_append_only
            ON time_accounting.correction_entry
    """)
    op.execute("DROP FUNCTION IF EXISTS time_accounting.fn_correction_entry_append_only()")
    op.execute("DROP TABLE IF EXISTS time_accounting.correction_entry")
