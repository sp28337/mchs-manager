"""0016_unit_time_zone

Часовой пояс отсчёта календарных суток — как свойство ПОДРАЗДЕЛЕНИЯ.

--- Зачем вообще понадобился пояс --------------------------------------

Расчёт служебного времени всё время переводит моменты в календарные даты
и обратно, и без пояса эта операция не определена:

* Алгоритм Г строит ночное окно `[d−1 22:00, d 06:00)` — это стенные
  часы, а не момент UTC;
* Алгоритмы Д и Е спрашивают `day_type` календарной даты, на которую
  «приходится» интервал факта;
* Алгоритм Б считает рабочие и предпраздничные дни периода.

До этой миграции пояс был константой `Europe/Moscow` в роутере
`time_accounting` с пометкой «ОТКРЫТЫЙ ВОПРОС». Для инварианта 6.1.6
константа была безвредна (там вердикт от пояса не зависит — см. п. 1
докстринга миграции 0014), но для классификации часов она означала бы,
что ночные и праздничные часы во Владивостоке считаются по московским
суткам. Это прямые деньги: ночные и праздничные часы компенсируются
(ФЗ-141 ст. 55, ТК РФ ст. 153).

--- Почему на подразделении -------------------------------------------

ТК РФ ст. 96 определяет ночное время как «с 22 до 6 часов» — то есть по
местному времени места работы, а не по времени столицы. Место службы
сотрудника — его подразделение, поэтому пояс принадлежит `unit`.

Рассмотренные и отвергнутые варианты:

* **Глобальная настройка приложения.** Отвергнута по существу: ФПС
  работает в 11 часовых поясах, и единая настройка гарантированно неверна
  для большинства подразделений.
* **Пояс на сотруднике.** Отвергнут: пояс — свойство места, а не
  человека. При переводе сотрудника в другой регион его пояс меняется
  вместе с подразделением сам собой, и дублировать это на карточке
  значило бы завести второй источник истины, который рано или поздно
  разойдётся с первым.
* **Вычислять из адреса/региона.** Отвергнут: справочника адресов в
  модели нет, а заводить его ради одного поля — несоразмерно.

--- Про значение по умолчанию ------------------------------------------

`DEFAULT 'Europe/Moscow'` нужен, чтобы миграция прошла на существующих
строках, и он же честный: центральный аппарат и большая часть
подразделений действительно в московском поясе. Для остальных значение
вводится явно — это данные, как и всё остальное в этой системе.

Проверка того, что пояс существует, идёт против `pg_timezone_names` —
представления самой PostgreSQL, то есть против той же базы IANA, которой
пользуется `AT TIME ZONE`. `CHECK` подзапросы не допускает, поэтому
проверка сделана триггером; альтернатива (`text` без проверки) означала
бы, что опечатка `Europe/Moscov` доживёт до расчёта и там превратится в
ошибку времени выполнения посреди утверждения табеля.

--- Провенанс расчёта --------------------------------------------------

`hours_breakdown_projection` получает `computed_in_time_zone` по той же
причине, что и `computed_from_legal_base` (миграция 0015): инвариант
6.1.5 требует, чтобы повторный расчёт тех же входных данных давал
идентичный результат. Пояс — такой же вход расчёта, как правовая база;
если подразделение когда-нибудь переедет (или пояс просто поправят,
исправляя ошибку ввода), пересчёт прошлого периода без записанного пояса
тихо дал бы другие ночные часы.

Revision ID: 0016
Revises: 0015
Create Date: 2026-08-05
"""

from __future__ import annotations

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE personnel.unit
            ADD COLUMN time_zone text NOT NULL DEFAULT 'Europe/Moscow'
    """)

    op.execute("""
        CREATE FUNCTION personnel.fn_unit_time_zone_is_known()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_timezone_names WHERE name = NEW.time_zone
            ) THEN
                RAISE EXCEPTION
                    'unit %: часовой пояс % не известен PostgreSQL; ожидается имя IANA, '
                    'например Europe/Moscow или Asia/Vladivostok', NEW.id, NEW.time_zone
                    USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER trg_unit_time_zone_is_known
            BEFORE INSERT OR UPDATE OF time_zone ON personnel.unit
            FOR EACH ROW
            EXECUTE FUNCTION personnel.fn_unit_time_zone_is_known()
    """)

    op.execute("""
        ALTER TABLE time_accounting.hours_breakdown_projection
            ADD COLUMN computed_in_time_zone text NOT NULL DEFAULT 'Europe/Moscow'
    """)
    # DEFAULT снимается сразу после добавления: он нужен был только для
    # существующих строк. Расчёт обязан назвать пояс явно — молчаливое
    # умолчание в провенансе означало бы «пояс неизвестен», записанное как
    # будто он известен.
    op.execute("""
        ALTER TABLE time_accounting.hours_breakdown_projection
            ALTER COLUMN computed_in_time_zone DROP DEFAULT
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE time_accounting.hours_breakdown_projection
            DROP COLUMN IF EXISTS computed_in_time_zone
    """)
    op.execute("DROP TRIGGER IF EXISTS trg_unit_time_zone_is_known ON personnel.unit")
    op.execute("DROP FUNCTION IF EXISTS personnel.fn_unit_time_zone_is_known()")
    op.execute("ALTER TABLE personnel.unit DROP COLUMN IF EXISTS time_zone")
