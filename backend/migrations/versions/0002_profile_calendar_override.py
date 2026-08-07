"""0002_profile_calendar_override

Личный календарь года поверх общего.

--- Зачем нужен ---------------------------------------------------------

Общий производственный календарь в `service_calendar` — уставная основа
по ст. 112 ТК РФ. Чего в нём нет и быть не может: переносов выходных,
которые Правительство устанавливает отдельным постановлением на каждый
год. Пока постановление не внесено, годовая норма завышена — и человек,
у которого перед глазами настоящий производственный календарь, ничем не
может помочь себе сам.

Эта таблица даёт ему такую возможность: отметить свои нерабочие дни на
учётный год. Переопределение ЛИЧНОЕ, а не общее, и это существенно —
человек правит свой расчёт, а не чужие.

--- Почему переопределение, а не копия календаря ------------------------

Хранится только то, что человек изменил. Копия всех 365 дней у каждого
профиля означала бы, что исправление ошибки в общем календаре не дойдёт
ни до кого: у всех лежат замороженные снимки. При переопределении общий
календарь остаётся основой, а личных строк ровно столько, сколько
расхождений.

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-07
"""

from __future__ import annotations

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE shift_accounting.calendar_override (
            profile_id  uuid NOT NULL REFERENCES shift_accounting.profile (id)
                            ON DELETE CASCADE,
            day         date NOT NULL,
            day_type    service_calendar.day_type NOT NULL,

            CONSTRAINT pk_calendar_override PRIMARY KEY (profile_id, day)
        )
    """)
    # Расчёт всегда читает переопределения ПЕРИОДОМ, а первичный ключ
    # начинается с профиля — по нему диапазонный поиск не идёт.
    op.execute("""
        CREATE INDEX ix_calendar_override_period
            ON shift_accounting.calendar_override (profile_id, day)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shift_accounting.calendar_override")
