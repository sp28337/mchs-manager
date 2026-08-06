"""0020_service_record_legal_base

Правовая база службы становится историческим фактом.

--- Что было не так ----------------------------------------------------

`legal_base` (`fps_service` / `labor_code`) лежал только на
`personnel.employee`, то есть был значением НА СЕГОДНЯ. Алгоритм А шаг 4
требует обратного дословно: «записать `legal_base` как атрибут расчёта
(не как атрибут сотрудника целиком) — сотрудник может сменить статус в
течение службы, поэтому `legal_base` определяется на дату конкретного
учётного периода».

Цена расхождения не абстрактная. ФЗ-141 и ТК РФ дают разные нормы: у
аттестованного состава служебное время (ст. 54-55 ФЗ-141), у гражданского
персонала рабочее (ст. 91, 99, 104, 152, 153 ТК РФ). Пересчёт периода,
когда человек был вольнонаёмным, по нормам ФЗ-141 — это применение к нему
закона, который на него тогда не распространялся.

--- Почему в летописи службы, а не отдельной таблицей ------------------

Переход из гражданского персонала в аттестованный состав — кадровое
событие, оформляемое приказом, и `service_record_entry` (миграция 0008)
ровно для таких событий и заведена: append-only летопись с
`effective_date` и типом события. Отдельная таблица «история правовой
базы» была бы второй летописью тех же приказов, и первое же расхождение
между ними никто бы не заметил.

Колонка `NULL`-имая по той же причине, что `position_id` и `unit_id`:
запись `rank_change` правовую базу не меняет, и требовать её заполнения
значило бы заставлять кадровика повторять неизменившийся факт при каждом
присвоении звания — с неизбежной опечаткой однажды.

--- Существующие записи ------------------------------------------------

Заполняются из `employee.legal_base` для записей типа `assignment`, то
есть для приёма на службу. Это единственное честное предположение:
правовая база, действующая сейчас, действовала с момента приёма, если
записей о её изменении нет. Для `transfer`/`rank_change`/`dismissal`
колонка остаётся `NULL` — они правовую базу не устанавливали, и
задним числом объявлять обратное нельзя.

Revision ID: 0020
Revises: 0019
Create Date: 2026-08-06
"""

from __future__ import annotations

from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE personnel.service_record_entry
            ADD COLUMN legal_base personnel.legal_base
    """)

    # Летопись append-only, и её триггер (миграция 0008) запрещает UPDATE.
    # Отключается ровно на время заполнения: это не изменение истории, а
    # перенос уже существующего факта из карточки сотрудника в запись о
    # приёме на службу, где ему и место.
    op.execute("""
        ALTER TABLE personnel.service_record_entry DISABLE TRIGGER USER
    """)
    op.execute("""
        UPDATE personnel.service_record_entry AS sre
           SET legal_base = e.legal_base
          FROM personnel.employee AS e
         WHERE e.id = sre.employee_id
           AND sre.event_type = 'assignment'
    """)
    op.execute("""
        ALTER TABLE personnel.service_record_entry ENABLE TRIGGER USER
    """)

    op.execute("""
        CREATE INDEX ix_service_record_legal_base
            ON personnel.service_record_entry (employee_id, effective_date DESC)
            WHERE legal_base IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS personnel.ix_service_record_legal_base")
    op.execute("""
        ALTER TABLE personnel.service_record_entry DROP COLUMN IF EXISTS legal_base
    """)
