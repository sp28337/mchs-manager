"""0013_scheduling_revision

Разрешает противоречие, зафиксированное в докстринге миграции 0012:
пересмотр графика (SD009) в исходную схему не укладывался.

--- Что требовали документы, и почему это не сходилось ------------------

* `openapi.yaml` `POST /scheduling/duty-schedules/{id}/revise` → `201
  Новая версия графика создана`;
* Domain Model 5.1.3 → «новую версию с указанием причины и ссылкой на
  предыдущую»;
* но `uq_duty_schedule_unit_period UNIQUE (unit_id, period_start,
  period_end)` запрещал вторую строку на ту же пару, то есть запрещал
  саму новую версию;
* а `excl_planned_shift_no_overlap`, будучи глобальным и безусловным,
  отклонил бы смены новой версии как пересекающиеся со сменами старой.

--- Как решено (по закону и по существу дела) ---------------------------

График дежурств утверждается приказом (ФЗ-141 ст. 55; SRS БП-1 п. 3).
Отсюда всё остальное следует само:

1. **Изменить утверждённый график можно только новым приказом.** Значит
   пересмотр — это НОВАЯ версия, а не правка на месте. Правка на месте
   означала бы, что документ, по которому люди уже несли службу, задним
   числом стал другим, — прямо против требования аудируемости
   (SRS разд. 10 п. 1) и против «история никогда не перезаписывается»
   (Domain Model разд. 13).

2. **Старая версия не удаляется, а закрывается.** Статус `closed` для
   этого уже есть в enum'е с самого начала (миграция 0012) — до сих пор
   он просто не использовался. Смены закрытой версии остаются как
   история: это записи о том, кто и когда должен был нести службу по
   действовавшему на тот момент приказу.

3. **«Одна действующая версия на подразделение+период» сохраняется** —
   но теперь как частичный уникальный индекс `WHERE status <> 'closed'`.
   Инвариант тот же, что и был; изменилось лишь то, что он перестал
   считать историю конкурентом настоящему.

4. **EXCLUDE становится частичным** — `WHERE NOT superseded`. Физический
   инвариант «человек не несёт две смены одновременно» относится к
   действующим сменам; смена из отменённой версии графика не является
   несомой вообще, и конфликтовать ей не с чем.

5. **EXCLUDE делается `DEFERRABLE INITIALLY IMMEDIATE`.** Пересмотр в
   одной транзакции помечает старые смены `superseded` и вставляет новые;
   порядок, в котором ORM выполнит UPDATE и INSERT, не гарантирован, и
   при немедленной проверке вставка могла бы упасть на ещё не помеченной
   старой смене. `INITIALLY IMMEDIATE` оставлен намеренно: обычная
   вставка пересекающейся смены должна падать сразу, на своём операторе,
   чтобы обработчик отдал 409 с внятным телом. Откладывает проверку до
   коммита только пересмотр — явным `SET CONSTRAINTS ... DEFERRED` в
   своей транзакции.

--- Что осталось за пределами этой миграции ----------------------------

Триггер, помечающий смены `superseded` при закрытии графика, добавлен как
защита в глубину: агрегат делает то же самое, но ошибка в домене иначе
оставила бы БД в состоянии «график закрыт, а его смены всё ещё занимают
время сотрудника».

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-05
"""

from __future__ import annotations

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE scheduling.duty_schedule
            ADD COLUMN revision_no          integer NOT NULL DEFAULT 1,
            ADD COLUMN previous_schedule_id uuid REFERENCES scheduling.duty_schedule(id),
            ADD COLUMN revision_reason      text
    """)

    op.execute("""
        ALTER TABLE scheduling.duty_schedule
            ADD CONSTRAINT ck_duty_schedule_revision_positive CHECK (revision_no >= 1),
            -- Первая версия ни на что не ссылается и не нуждается в причине;
            -- каждая последующая обязана иметь и то, и другое (Domain Model
            -- 5.1.3: «с указанием причины и ссылкой на предыдущую»).
            ADD CONSTRAINT ck_duty_schedule_revision_lineage CHECK (
                (revision_no = 1 AND previous_schedule_id IS NULL AND revision_reason IS NULL)
                OR
                (revision_no > 1 AND previous_schedule_id IS NOT NULL
                 AND revision_reason IS NOT NULL)
            ),
            ADD CONSTRAINT ck_duty_schedule_not_own_predecessor CHECK (
                previous_schedule_id IS NULL OR previous_schedule_id <> id
            )
    """)

    # «Одна ДЕЙСТВУЮЩАЯ версия на подразделение+период»: тот же инвариант,
    # что и был, но перестающий считать историю конкурентом.
    op.execute("""
        ALTER TABLE scheduling.duty_schedule
            DROP CONSTRAINT uq_duty_schedule_unit_period
    """)
    op.execute("""
        CREATE UNIQUE INDEX uq_duty_schedule_unit_period_active
            ON scheduling.duty_schedule (unit_id, period_start, period_end)
            WHERE status <> 'closed'
    """)

    op.execute("""
        ALTER TABLE scheduling.planned_shift
            ADD COLUMN superseded boolean NOT NULL DEFAULT false
    """)
    op.execute("""
        ALTER TABLE scheduling.planned_shift
            DROP CONSTRAINT excl_planned_shift_no_overlap
    """)
    op.execute("""
        ALTER TABLE scheduling.planned_shift
            ADD CONSTRAINT excl_planned_shift_no_overlap EXCLUDE USING gist (
                employee_id WITH =,
                time_range WITH &&
            ) WHERE (NOT superseded)
            DEFERRABLE INITIALLY IMMEDIATE
    """)
    op.execute("""
        CREATE INDEX ix_planned_shift_active
            ON scheduling.planned_shift (employee_id, duty_schedule_id)
            WHERE NOT superseded
    """)

    # Защита в глубину: закрытый график не может оставить свои смены
    # действующими. Агрегат делает то же самое; триггер держит инвариант,
    # если что-то пройдёт мимо домена.
    op.execute("""
        CREATE OR REPLACE FUNCTION scheduling.fn_supersede_shifts_of_closed_schedule()
        RETURNS trigger AS $$
        BEGIN
            IF NEW.status = 'closed' AND OLD.status <> 'closed' THEN
                UPDATE scheduling.planned_shift
                    SET superseded = true
                    WHERE duty_schedule_id = NEW.id AND NOT superseded;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER trg_supersede_shifts_of_closed_schedule
            AFTER UPDATE OF status ON scheduling.duty_schedule
            FOR EACH ROW EXECUTE FUNCTION scheduling.fn_supersede_shifts_of_closed_schedule()
    """)


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_supersede_shifts_of_closed_schedule "
        "ON scheduling.duty_schedule"
    )
    op.execute("DROP FUNCTION IF EXISTS scheduling.fn_supersede_shifts_of_closed_schedule()")
    op.execute("DROP INDEX IF EXISTS scheduling.ix_planned_shift_active")
    op.execute(
        "ALTER TABLE scheduling.planned_shift DROP CONSTRAINT excl_planned_shift_no_overlap"
    )
    op.execute("""
        ALTER TABLE scheduling.planned_shift
            ADD CONSTRAINT excl_planned_shift_no_overlap EXCLUDE USING gist (
                employee_id WITH =,
                time_range WITH &&
            )
    """)
    op.execute("ALTER TABLE scheduling.planned_shift DROP COLUMN superseded")
    op.execute("DROP INDEX IF EXISTS scheduling.uq_duty_schedule_unit_period_active")
    op.execute("""
        ALTER TABLE scheduling.duty_schedule
            ADD CONSTRAINT uq_duty_schedule_unit_period UNIQUE (unit_id, period_start, period_end)
    """)
    op.execute("""
        ALTER TABLE scheduling.duty_schedule
            DROP CONSTRAINT ck_duty_schedule_not_own_predecessor,
            DROP CONSTRAINT ck_duty_schedule_revision_lineage,
            DROP CONSTRAINT ck_duty_schedule_revision_positive
    """)
    op.execute("""
        ALTER TABLE scheduling.duty_schedule
            DROP COLUMN revision_reason,
            DROP COLUMN previous_schedule_id,
            DROP COLUMN revision_no
    """)
