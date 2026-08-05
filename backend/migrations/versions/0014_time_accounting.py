"""0014_time_accounting

DB014: схема time_accounting + timesheet/overtime_order/service_time_event.

DDL взят из PostgreSQL_Logical_Model_FPS.md разд. 5.1-5.4. Три места
пришлось решать, а не переносить, — ниже каждое с обоснованием.

--- 1. Инвариант 6.1.6 («≤ 24 ч на сотрудника за сутки») ---------------

Логическая модель предписывает реализовать его `DEFERRABLE INITIALLY
DEFERRED` constraint-триггером, выполняющим `SUM()` в конце транзакции,
потому что «агрегация по нескольким строкам не выражается декларативным
CHECK/EXCLUDE».

Здесь он реализован иначе — глобальным частичным `EXCLUDE` по
`(employee_id, time_range) WHERE event_type = 'actual_shift'`. Причина не
в удобстве, а в том, что так инвариант получается СИЛЬНЕЕ и при этом
перестаёт зависеть от выбора часового пояса:

*Утверждение.* Если фактические смены одного сотрудника попарно не
пересекаются, то сумма их часов, приходящихся на любые календарные сутки,
не превышает 24 ч — в любом часовом поясе.

*Доказательство.* Пересечения непересекающихся интервалов с одним и тем
же суточным окном сами попарно не пересекаются и целиком лежат внутри
окна длиной 24 ч, значит их суммарная длительность ≤ 24 ч. ∎

Обратное тоже верно в практически важную сторону: превысить 24 ч за сутки
можно ТОЛЬКО пересечением (две непересекающиеся смены внутри одних суток
дают в сумме максимум 24 ч). То есть «сумма > 24 ч» и «есть пересечение» —
это один и тот же класс ошибок ввода, а `EXCLUDE` ловит его точнее: две
пересекающиеся пятичасовые смены `SUM() ≤ 24` пропустил бы, а он нет.

Что это даёт сверх удобства:

* **Не нужно изобретать часовой пояс.** `SUM()` по суткам обязан знать,
  где кончается «сутки», а ФПС работает в 11 часовых поясах и ни один
  документ проекта пояс отсчёта не называет. Любая константа здесь была
  бы выдумкой, влияющей на вердикт. `EXCLUDE` от неё свободен.
* **Нет гонки.** Constraint-триггер с `EXISTS` подвержен write skew: две
  параллельные транзакции, каждая вставляющая пересекающую смену, друг
  друга не видят и обе коммитятся. `EXCLUDE` — индексное ограничение,
  для него это невозможно.

Почему `EXCLUDE` именно ГЛОБАЛЬНЫЙ, а не внутри табеля: внутри одного
табеля инвариант 6.1.1 уже запрещает любые пересечения, поэтому там 6.1.6
выполняется автоматически и проверять нечего. Содержание у 6.1.6
появляется ровно на стыке ДВУХ табелей одного сотрудника (суточное
дежурство с 31-го на 1-е), куда `excl_service_time_event_no_overlap`
(он по `timesheet_id`) не дотягивается. Ровно та же логика, что у
глобального EXCLUDE в `scheduling.planned_shift`.

Ограничение частичное (`WHERE event_type = 'actual_shift'`), потому что
инвариант 6.1.6 говорит именно об `ActualShiftRecord`. Расширять его на
болезнь и отстранение было бы отдельным утверждением, которого в модели
нет: у него могут быть законные исключения (больничный, открытый в день
последней смены), и вводить его впрок значит запретить то, о чём никто не
просил.

--- 2. Денормализованный `employee_id` и почему он не разъедется -------

Глобальный `EXCLUDE` по сотруднику требует `employee_id` в самой строке
события, а логическая модель держит его только в `timesheet`.

Копия защищена составным внешним ключом `(timesheet_id, employee_id) →
timesheet(id, employee_id)` — тем же приёмом, что `(calendar_year_id,
year)` в миграции 0009. Рассинхронизация невозможна структурно, а не по
дисциплине: чтобы значения разошлись, пришлось бы сначала изменить
`timesheet.employee_id`, что запрещено триггером неизменяемости ниже.

--- 3. ДВА ПРОТИВОРЕЧИЯ ЛОГИЧЕСКОЙ МОДЕЛИ САМОЙ СЕБЕ --------------------

**(а) `planned_shift_id uuid REFERENCES scheduling.planned_shift(id)`**
(разд. 5.4) прямо нарушает разд. 10 той же модели: «между схемами
сознательно не ставятся FOREIGN KEY там, где это пересекало бы границу
bounded context». `scheduling` и `time_accounting` — разные контексты, и
эта ссылка ничем не отличается от `planned_shift.employee_id`, у которой
FK намеренно нет.

Решено в пользу разд. 10 — правила, а не опечатки в примере: колонка
остаётся, `REFERENCES` снимается. Цена (никем не гарантированное
существование смены) ровно та, которую разд. 10 называет платой и
относит на Application-слой.

**(б) `period_type scheduling.accounting_period_type`** (разд. 5.2) —
то же самое в мягкой форме: не строка ссылается на строку, но схема
зависит от типа чужой схемы. Заявленная выгода разд. 10 («миграции одной
схемы не блокируются структурой другой») при этом теряется целиком.

Решено так же: `time_accounting` заводит собственный
`accounting_period_type` с тем же составом значений. Это не дублирование
по недосмотру — тот же приём, что уже применён к `scheduling.duty_type`
и `personnel.regime_type`: общий язык, физически раздельные типы.

Revision ID: 0014
Revises: 0013
Create Date: 2026-08-05
"""

from __future__ import annotations

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS time_accounting")

    op.execute("""
        CREATE TYPE time_accounting.timesheet_status AS ENUM (
            'open', 'pending_approval', 'approved', 'reopened'
        )
    """)
    op.execute("""
        CREATE TYPE time_accounting.service_time_event_type AS ENUM (
            'actual_shift', 'sickness', 'suspension', 'overtime_attraction', 'business_trip'
        )
    """)
    # Собственный тип, а не scheduling.accounting_period_type — см. п. 3(б).
    op.execute("""
        CREATE TYPE time_accounting.accounting_period_type AS ENUM ('month', 'quarter', 'year')
    """)

    op.execute("""
        CREATE TABLE time_accounting.timesheet (
            id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            -- Ссылка по id на personnel.employee, без FK (разд. 10).
            employee_id   uuid NOT NULL,
            period_type   time_accounting.accounting_period_type NOT NULL,
            period_start  date NOT NULL,
            period_end    date NOT NULL,
            status        time_accounting.timesheet_status NOT NULL DEFAULT 'open',
            created_at    timestamptz NOT NULL DEFAULT now(),

            CONSTRAINT uq_timesheet_employee_period UNIQUE (employee_id, period_start, period_end),
            CONSTRAINT ck_timesheet_period CHECK (period_end > period_start),
            -- Цель составного внешнего ключа из service_time_event (п. 2).
            -- Сам по себе избыточен: id уже первичный ключ.
            CONSTRAINT uq_timesheet_id_employee UNIQUE (id, employee_id)
        )
    """)

    op.execute("""
        CREATE TABLE time_accounting.overtime_order (
            id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            order_number  text NOT NULL,
            issued_date   date NOT NULL,
            -- Ссылка на personnel.employee, без FK (разд. 10).
            issued_by     uuid NOT NULL,
            reason        text NOT NULL,

            CONSTRAINT uq_overtime_order_number UNIQUE (order_number),
            CONSTRAINT ck_overtime_order_number_not_blank CHECK (btrim(order_number) <> ''),
            CONSTRAINT ck_overtime_order_reason_not_blank CHECK (btrim(reason) <> '')
        )
    """)

    op.execute("""
        CREATE TABLE time_accounting.service_time_event (
            id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            timesheet_id        uuid NOT NULL REFERENCES time_accounting.timesheet(id),
            -- Копия timesheet.employee_id, удерживаемая составным FK (п. 2).
            employee_id         uuid NOT NULL,
            event_type          time_accounting.service_time_event_type NOT NULL,
            time_range          tstzrange NOT NULL,
            -- Ссылка на scheduling.planned_shift БЕЗ FK — см. п. 3(а).
            planned_shift_id    uuid,
            overtime_order_id   uuid REFERENCES time_accounting.overtime_order(id),
            business_trip_place text,

            CONSTRAINT fk_service_time_event_timesheet_employee
                FOREIGN KEY (timesheet_id, employee_id)
                REFERENCES time_accounting.timesheet (id, employee_id),

            -- Domain Model инвариант 6.1.1: события одного табеля не
            -- пересекаются. Один момент времени не бывает одновременно и
            -- болезнью, и сменой; «смена, прерванная болезнью» моделируется
            -- разбиением на два непересекающихся события, а не наложением.
            CONSTRAINT excl_service_time_event_no_overlap EXCLUDE USING gist (
                timesheet_id WITH =,
                time_range WITH &&
            ),

            -- Domain Model инвариант 6.1.6, реализованный через непересечение
            -- (см. п. 1 докстринга). Частичный: только фактические смены.
            CONSTRAINT excl_actual_shift_employee_no_overlap EXCLUDE USING gist (
                employee_id WITH =,
                time_range WITH &&
            ) WHERE (event_type = 'actual_shift'),

            -- Domain Model инвариант 6.1.2: не бывает сверхнормативного
            -- времени без документа-основания (SRS разд. 8).
            CONSTRAINT ck_overtime_requires_order CHECK (
                event_type <> 'overtime_attraction' OR overtime_order_id IS NOT NULL
            ),
            CONSTRAINT ck_business_trip_has_place CHECK (
                event_type <> 'business_trip' OR business_trip_place IS NOT NULL
            ),
            -- Приказ на привлечение сверх нормы не имеет смысла на событии
            -- другого типа: он обосновывает именно привлечение.
            CONSTRAINT ck_order_only_on_overtime CHECK (
                overtime_order_id IS NULL OR event_type = 'overtime_attraction'
            ),
            -- Пустой или вывернутый tstzrange PostgreSQL принимает молча,
            -- а VO TimeInterval требует «начало строго раньше конца».
            CONSTRAINT ck_service_time_event_range_not_empty CHECK (NOT isempty(time_range))
        )
    """)

    op.execute("""
        CREATE INDEX ix_service_time_event_timesheet
            ON time_accounting.service_time_event (timesheet_id)
    """)
    op.execute("""
        CREATE INDEX ix_service_time_event_order
            ON time_accounting.service_time_event (overtime_order_id)
    """)

    # ------------------------------------------------ инвариант 6.1.4
    # «Timesheet в статусе Approved неизменяем: любое дальнейшее изменение
    # возможно только через явный перевод в Reopened».
    #
    # Логическая модель разд. 5.2 просит именно BEFORE UPDATE-триггер, и
    # здесь он к месту: правило про ПЕРЕХОДЫ, а CHECK видит только новую
    # строку и о том, откуда она пришла, судить не может.
    op.execute("""
        CREATE FUNCTION time_accounting.fn_timesheet_immutability()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            -- Личность табеля и его период не меняются никогда: это ключ
            -- агрегата, а не атрибут. Смена периода задним числом означала
            -- бы, что утверждённый табель молча стал табелем другого месяца.
            IF NEW.employee_id  IS DISTINCT FROM OLD.employee_id
            OR NEW.period_start IS DISTINCT FROM OLD.period_start
            OR NEW.period_end   IS DISTINCT FROM OLD.period_end
            OR NEW.period_type  IS DISTINCT FROM OLD.period_type THEN
                RAISE EXCEPTION
                    'timesheet %: employee_id и период неизменяемы после создания', OLD.id
                    USING ERRCODE = 'restrict_violation';
            END IF;

            IF OLD.status = 'approved' AND NEW.status IS DISTINCT FROM 'approved' THEN
                IF NEW.status <> 'reopened' THEN
                    RAISE EXCEPTION
                        'timesheet %: из approved можно перейти только в reopened, '
                        'запрошен переход в % (Domain Model инвариант 6.1.4)',
                        OLD.id, NEW.status
                        USING ERRCODE = 'restrict_violation';
                END IF;
            END IF;

            RETURN NEW;
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER trg_timesheet_immutability
            BEFORE UPDATE ON time_accounting.timesheet
            FOR EACH ROW
            EXECUTE FUNCTION time_accounting.fn_timesheet_immutability()
    """)

    # Утверждённый табель не принимает новые факты. Проверка на строке
    # события, а не на табеле: изменение состава — это INSERT/UPDATE/DELETE
    # в service_time_event, куда триггер табеля не заглядывает.
    op.execute("""
        CREATE FUNCTION time_accounting.fn_service_time_event_requires_open_timesheet()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            v_status time_accounting.timesheet_status;
            v_sheet  uuid;
        BEGIN
            v_sheet := COALESCE(NEW.timesheet_id, OLD.timesheet_id);
            SELECT status INTO v_status
              FROM time_accounting.timesheet
             WHERE id = v_sheet;

            IF v_status = 'approved' THEN
                RAISE EXCEPTION
                    'timesheet % утверждён: состав фактов неизменяем, требуется '
                    'переоткрытие (Domain Model инвариант 6.1.4)', v_sheet
                    USING ERRCODE = 'restrict_violation';
            END IF;

            RETURN COALESCE(NEW, OLD);
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER trg_service_time_event_requires_open_timesheet
            BEFORE INSERT OR UPDATE OR DELETE ON time_accounting.service_time_event
            FOR EACH ROW
            EXECUTE FUNCTION time_accounting.fn_service_time_event_requires_open_timesheet()
    """)

    # Transactional Outbox модуля (миграция 0010 — для трёх модулей,
    # существовавших на тот момент; 0012 — для scheduling).
    op.execute("""
        CREATE TABLE time_accounting.outbox_message (
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
        CREATE INDEX ix_time_accounting_outbox_unpublished
            ON time_accounting.outbox_message (occurred_at)
            WHERE published_at IS NULL
    """)
    op.execute("""
        CREATE INDEX ix_time_accounting_outbox_aggregate
            ON time_accounting.outbox_message (aggregate_type, aggregate_id, occurred_at)
    """)


def downgrade() -> None:
    op.execute("""
        DROP TRIGGER IF EXISTS trg_service_time_event_requires_open_timesheet
            ON time_accounting.service_time_event
    """)
    op.execute("""
        DROP FUNCTION IF EXISTS time_accounting.fn_service_time_event_requires_open_timesheet()
    """)
    op.execute("""
        DROP TRIGGER IF EXISTS trg_timesheet_immutability ON time_accounting.timesheet
    """)
    op.execute("DROP FUNCTION IF EXISTS time_accounting.fn_timesheet_immutability()")
    op.execute("DROP TABLE IF EXISTS time_accounting.outbox_message")
    op.execute("DROP TABLE IF EXISTS time_accounting.service_time_event")
    op.execute("DROP TABLE IF EXISTS time_accounting.overtime_order")
    op.execute("DROP TABLE IF EXISTS time_accounting.timesheet")
    op.execute("DROP TYPE IF EXISTS time_accounting.accounting_period_type")
    op.execute("DROP TYPE IF EXISTS time_accounting.service_time_event_type")
    op.execute("DROP TYPE IF EXISTS time_accounting.timesheet_status")
    op.execute("DROP SCHEMA IF EXISTS time_accounting CASCADE")
