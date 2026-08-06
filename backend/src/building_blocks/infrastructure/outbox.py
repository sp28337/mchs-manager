"""Transactional Outbox — Architecture разд. 9.2.

    Timesheet.Approve()
       │ (одна транзакция)
       ├─ изменение состояния Timesheet
       └─ запись в Outbox: TimesheetApproved

Это единственный механизм, которым в модели вообще может появиться
начисление ДДО: Domain Model инвариант 8.1.2 — «начисление ДДО не может
возникнуть из воздуха, вне процесса компенсации», а Architecture Д6
требует, чтобы цепочка `TimeAccounting → Compensation → RestBalance` была
прослеживаемой последовательностью событий, а не тремя независимыми
действиями. Прямой вызов начисления запрещён; остаётся событие, а событие
обязано быть записано атомарно с фактом, который его породил — иначе
возможен коммит состояния без события (компенсация без начисления) или
событие без состояния (начисление без основания).

--- ЗАМЕЧАНИЕ К БЭКЛОГУ ------------------------------------------------

В `Implementation_Backlog_FPS.xlsx` нет задачи на таблицу
`outbox_message`. Фаза 1 (DB001-DB020) её не создаёт, при этом TA006
требует «сохранение агрегата и запись в outbox_message в одной
транзакции», а фазы 8-10 (Compensation, RestBalance, LeaveManagement)
целиком стоят на событийной цепочке. Пробел закрыт здесь; при обновлении
бэклога это отдельная задача фазы 1, а не часть TA006.

--- Почему таблица в схеме КАЖДОГО модуля, а не одна общая -------------

Backend_Architecture разд. 0: «Таблица `outbox_message` в схеме модуля,
запись в одной транзакции с агрегатом через ту же `AsyncSession`».

Одна общая таблица потребовала бы, чтобы модуль писал в чужую схему, —
ровно то межсхемное обращение, отсутствие которого делает границы модулей
проверяемыми на уровне БД (PostgreSQL_Logical_Model разд. 10). Плюс
практическое: релей «горячего» модуля (`time_accounting`) не должен
конкурировать за строки с релеем справочного (`legal_rules`), который
публикует событие раз в месяц.

Цена — по таблице на схему; форма у всех одна и создаётся одной функцией
(`build_outbox_table`), так что расходятся они только если кто-то этого
специально захочет.
"""

from __future__ import annotations

import dataclasses
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import (
    Column,
    DateTime,
    Integer,
    MetaData,
    Table,
    Text,
    func,
    insert,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.domain.aggregate_root import AggregateRoot
from src.building_blocks.domain.domain_event import DomainEvent

OUTBOX_TABLE_NAME = "outbox_message"


def build_outbox_table(metadata: MetaData) -> Table:
    """Описывает `<schema>.outbox_message` в переданной `MetaData` модуля.

    Не создаёт таблицу — её создаёт миграция; здесь только описание для
    SQLAlchemy, как и во всех `orm_mapping.py`.
    """
    return Table(
        OUTBOX_TABLE_NAME,
        metadata,
        Column("id", PgUUID(as_uuid=True), primary_key=True),
        Column("event_id", PgUUID(as_uuid=True), nullable=False, unique=True),
        Column("event_type", Text, nullable=False),
        Column("aggregate_type", Text, nullable=False),
        Column("aggregate_id", PgUUID(as_uuid=True), nullable=False),
        Column("payload", JSONB, nullable=False),
        Column("occurred_at", DateTime(timezone=True), nullable=False),
        Column("published_at", DateTime(timezone=True), nullable=True),
        Column("attempts", Integer, nullable=False),
        Column("last_error", Text, nullable=True),
        # created_at: DB DEFAULT now(), релей читает его для упорядочивания,
        # но приложение никогда не пишет.
    )


def to_jsonable(value: Any) -> Any:
    """Приводит значение доменного события к JSON-совместимому виду.

    Отдельная функция, а не `json.dumps(default=...)`, потому что
    результат кладётся в `jsonb` через SQLAlchemy, который сериализует
    сам — до него значение уже должно состоять из примитивов.

    `Enum` разворачивается в `.value`, а не в `str(enum)`: у `StrEnum`
    это одно и то же, у обычного `Enum` — нет, и разница всплыла бы
    только на первом не-`StrEnum` поле в чьём-нибудь будущем событии.
    """
    if isinstance(value, Enum):
        return to_jsonable(value.value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        # Строкой, а не `float`. Часы отсюда уходят в начисление
        # компенсации: `float(Decimal("7.20"))` даёт 7.199999999999999, и
        # подписчик, начисляющий сутки отдыха, получил бы не ту величину,
        # которую зафиксировал расчёт. `jsonb` числа хранит как `numeric`,
        # но пройти до него значение обязано без промежуточного `float`.
        return str(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple | set | frozenset):
        return [to_jsonable(v) for v in value]
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {f.name: to_jsonable(getattr(value, f.name)) for f in dataclasses.fields(value)}
    return value


def event_payload(event: DomainEvent) -> dict[str, Any]:
    """Полезная нагрузка события без служебных полей базового класса.

    `event_id` и `occurred_at` выносятся в собственные колонки: по первому
    строится уникальность (защита от повторной постановки одного события),
    по второму релей и аудит упорядочивают факты. Дублировать их ещё и
    внутри `payload` значит завести два места, которые могут разойтись.
    """
    base_fields = {f.name for f in dataclasses.fields(DomainEvent)}
    return {
        f.name: to_jsonable(getattr(event, f.name))
        for f in dataclasses.fields(event)
        if f.name not in base_fields
    }


class OutboxWriter:
    """Пишет доменные события агрегата в outbox ТОЙ ЖЕ сессией.

    Не коммитит — намеренно. Атомарность обеспечивается тем, что вызывающий
    код коммитит один раз после `enqueue()`: и изменение состояния, и
    строки outbox уходят одной транзакцией. Собственный `commit()` здесь
    разорвал бы ровно ту гарантию, ради которой существует весь механизм.
    """

    def __init__(self, session: AsyncSession, table: Table) -> None:
        self._session = session
        self._table = table

    async def enqueue(self, aggregate: AggregateRoot) -> int:
        """Сливает буфер событий агрегата в outbox. Возвращает число строк.

        `pull_pending_events()` опустошает буфер — повторный вызов на том
        же агрегате не продублирует события. Если он всё же случится
        (например, два репозитория увидят один агрегат), защитой служит
        `UNIQUE (event_id)`: `event_id` генерируется при создании события,
        а не при записи.
        """
        events = aggregate.pull_pending_events()
        if not events:
            return 0

        rows = [
            {
                "id": event.event_id,
                "event_id": event.event_id,
                "event_type": type(event).__name__,
                "aggregate_type": type(aggregate).__name__,
                "aggregate_id": aggregate.id,
                "payload": event_payload(event),
                "occurred_at": event.occurred_at,
                "attempts": 0,
            }
            for event in events
        ]
        await self._session.execute(insert(self._table), rows)
        return len(rows)


class OutboxReader:
    """Чтение и пометка сообщений — сторона релея (Celery-задача
    `relay_outbox`, Backend_Architecture разд. 7.1).

    Живёт здесь, а не в `composition/`, потому что форма таблицы одна на
    все модули: релею достаточно получить `Table` нужной схемы.
    """

    def __init__(self, session: AsyncSession, table: Table) -> None:
        self._session = session
        self._table = table

    async def fetch_unpublished(self, *, limit: int = 100) -> list[dict[str, Any]]:
        """Неопубликованные сообщения, самые старые первыми.

        `FOR UPDATE SKIP LOCKED` — чтобы несколько экземпляров релея
        (Architecture разд. 12.1: воркеры масштабируются горизонтально)
        разбирали очередь параллельно, а не блокировали друг друга и не
        публиковали одно сообщение дважды.
        """
        stmt = (
            self._table.select()
            .where(self._table.c.published_at.is_(None))
            .order_by(self._table.c.occurred_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        result = await self._session.execute(stmt)
        return [dict(row) for row in result.mappings()]

    async def mark_published(self, message_ids: list[UUID]) -> None:
        if not message_ids:
            return
        await self._session.execute(
            self._table.update()
            .where(self._table.c.id.in_(message_ids))
            .values(published_at=func.now())
        )

    async def mark_failed(self, message_id: UUID, error: str) -> None:
        """Счётчик попыток и последняя ошибка — сообщение остаётся
        неопубликованным и будет взято следующим проходом. Здесь нет
        «мёртвой очереди»: событие, которое не удалось опубликовать,
        нельзя молча выбросить, иначе теряется то самое основание, ради
        которого outbox и существует."""
        await self._session.execute(
            self._table.update()
            .where(self._table.c.id == message_id)
            .values(attempts=self._table.c.attempts + 1, last_error=error[:2000])
        )
