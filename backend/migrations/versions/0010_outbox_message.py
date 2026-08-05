"""0010_outbox_message

Transactional Outbox (Architecture разд. 9.2) — по таблице в схеме
каждого модуля, который публикует доменные события.

ЗАМЕЧАНИЕ К БЭКЛОГУ: этой задачи в `Implementation_Backlog_FPS.xlsx` нет.
Фаза 1 (DB001-DB020) таблицу не создаёт, при этом TA006 требует «запись в
outbox_message в одной транзакции с агрегатом», а фазы 8-10 целиком стоят
на событийной цепочке `TimeAccounting → Compensation → RestBalance`
(драйвер Д6). См. `building_blocks/infrastructure/outbox.py`.

Схема таблицы одинакова везде и описывается в коде одной функцией
(`build_outbox_table`), поэтому DDL ниже генерируется циклом, а не
копируется трижды: расхождение форм — это то, что здесь может сломаться
незаметно.

Модули, получающие таблицу сейчас, — те, чьи агрегаты уже поднимают
события: `legal_rules` (RuleVersionPublished,
ConflictResolutionPolicyPublished), `personnel` (EmployeeRegistered,
EmploymentStatusChanged, EmployeeTransferred), `service_calendar`
(CalendarYearPublished). Остальные добавят свою таблицу вместе со своей
схемой.

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-05
"""

from __future__ import annotations

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

_SCHEMAS = ("legal_rules", "personnel", "service_calendar")


def upgrade() -> None:
    for schema in _SCHEMAS:
        op.execute(f"""
            CREATE TABLE {schema}.outbox_message (
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

                -- Одно доменное событие — не более одной строки. event_id
                -- рождается вместе с событием (DomainEvent.event_id), а не
                -- при записи, поэтому повторная постановка того же события
                -- отсекается здесь, а не проверкой в коде.
                CONSTRAINT uq_outbox_event_id UNIQUE (event_id),

                CONSTRAINT ck_outbox_attempts_non_negative CHECK (attempts >= 0)
            )
        """)

        # Единственный горячий запрос релея: «самые старые неопубликованные».
        # Частичный индекс — потому что опубликованные строки копятся вечно
        # (это журнал, а не очередь: удалять их значит терять основание,
        # ради которого outbox и заведён), и просматривать их незачем.
        op.execute(f"""
            CREATE INDEX ix_{schema}_outbox_unpublished
                ON {schema}.outbox_message (occurred_at)
                WHERE published_at IS NULL
        """)

        # Для аудита и разбора инцидентов: «что происходило с этим агрегатом».
        op.execute(f"""
            CREATE INDEX ix_{schema}_outbox_aggregate
                ON {schema}.outbox_message (aggregate_type, aggregate_id, occurred_at)
        """)


def downgrade() -> None:
    for schema in _SCHEMAS:
        op.execute(f"DROP TABLE IF EXISTS {schema}.outbox_message")
