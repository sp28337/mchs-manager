"""F013 — релей Transactional Outbox.

Переносит записи `outbox_message` модуля в поток событий и помечает их
опубликованными. Одна функция на все модули: форма таблицы у всех
одинаковая (`build_outbox_table`), различается только схема.

--- Порядок операций и почему он именно такой -------------------------

    прочитать (FOR UPDATE SKIP LOCKED)
      -> опубликовать в поток
        -> пометить published_at
          -> COMMIT

Публикация ДО пометки. Обратный порядок дал бы окно, в котором сообщение
помечено опубликованным, но в поток не попало, — и событие потерялось бы
навсегда. Здесь окно тоже есть (падение между `XADD` и `COMMIT`), но
последствие другое: сообщение опубликуется повторно, и отвергнет дубликат
потребитель, который к этому готов (`uq_compensation_case_timesheet`).

Из двух несовершенных вариантов выбран тот, где ошибка исправима.

--- Почему пометка одной транзакцией с чтением ------------------------

`FOR UPDATE SKIP LOCKED` держит строки заблокированными до конца
транзакции. Пока она открыта, второй экземпляр релея эти строки не
увидит и не опубликует повторно — то есть блокировка выполняет здесь ту
же роль, что и в очередях: гарантирует, что пачку разбирает ровно один
воркер.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from redis.asyncio import Redis
from sqlalchemy import Table
from sqlalchemy.ext.asyncio import AsyncSession

from src.building_blocks.infrastructure.event_stream import publish
from src.building_blocks.infrastructure.outbox import OutboxReader

logger = logging.getLogger(__name__)


async def relay_once(
    session: AsyncSession, redis: Redis, table: Table, *, batch_size: int = 100
) -> int:
    """Один проход релея. Возвращает число опубликованных сообщений."""
    reader = OutboxReader(session, table)
    messages = await reader.fetch_unpublished(limit=batch_size)
    if not messages:
        return 0

    published: list[UUID] = []
    for message in messages:
        try:
            await publish(
                redis,
                aggregate_type=str(message["aggregate_type"]),
                event_id=str(message["event_id"]),
                event_type=str(message["event_type"]),
                payload=_payload(message),
            )
        except Exception as exc:  # noqa: BLE001 — сбой брокера не должен ронять пачку
            # Сообщение остаётся неопубликованным и будет взято следующим
            # проходом. Выбросить его нельзя: это основание, без которого
            # начисление становится «из воздуха» (инвариант 8.1.2).
            await reader.mark_failed(UUID(str(message["id"])), str(exc))
            logger.warning(
                "outbox relay: не удалось опубликовать %s (%s): %s",
                message["event_type"],
                message["id"],
                exc,
            )
            continue
        published.append(UUID(str(message["id"])))

    await reader.mark_published(published)
    await session.commit()
    return len(published)


def _payload(message: dict[str, Any]) -> dict[str, Any]:
    """К телу события добавляются идентификаторы агрегата и момент.

    Потребитель иначе не знает, к чему событие относится: `payload`
    содержит только поля самого события, а `aggregate_id` и `occurred_at`
    вынесены в колонки таблицы (см. `event_payload`). Собирать их обратно
    здесь правильнее, чем дублировать в `payload` при записи, — там они
    завели бы два места, которые могут разойтись.
    """
    payload = dict(message["payload"])
    payload["aggregate_id"] = str(message["aggregate_id"])
    occurred_at = message["occurred_at"]
    payload["occurred_at"] = (
        occurred_at.isoformat() if hasattr(occurred_at, "isoformat") else str(occurred_at)
    )
    return payload
