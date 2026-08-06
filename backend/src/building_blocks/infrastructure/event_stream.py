"""Шина интеграционных событий поверх Redis Streams.

--- Почему Redis Streams, а не pub/sub -------------------------------

Backend_Architecture разд. 4 называет Redis и брокером Celery, и шиной
событий. Из двух его механизмов подходит только один:

* **pub/sub** доставляет сообщение только тем, кто подписан ПРЯМО СЕЙЧАС.
  Перезапуск воркера `compensation` означал бы безвозвратно потерянные
  `TimesheetApproved`, то есть неначисленную компенсацию за уже
  утверждённые табели. Для системы, где инвариант 8.1.2 запрещает
  начислению «возникать из воздуха», потеря основания — та же беда, что
  начисление без основания.
* **Streams** хранят сообщения в журнале и помнят позицию каждой consumer
  group. Воркер, вернувшийся после перезапуска, дочитывает с того места,
  где остановился (DoD CO011: «consumer group читает поток без потери и
  дублирования при рестарте»).

--- Гарантия доставки ------------------------------------------------

At-least-once, и это осознанно. Ровно-однократной доставки не существует
без распределённой транзакции между Redis и PostgreSQL; вместо неё
идемпотентность на стороне потребителя: `uq_compensation_case_timesheet`
не даст завести второе дело по тому же табелю, сколько бы раз событие ни
пришло.

Дубликат при этом возможен и на стороне релея: сообщение может быть
опубликовано и не помечено (падение между `XADD` и `COMMIT`). Обратный
порядок был бы хуже — пометка без публикации теряет событие навсегда,
а лишняя публикация лишь заставит потребителя отвергнуть дубль.

--- Один поток на тип агрегата ---------------------------------------

Не один общий и не по потоку на событие. Общий сделал бы каждого
потребителя читателем всего трафика системы; поток на событие
рассыпал бы порядок между связанными фактами одного агрегата
(`CompensationLineCreated` и `CompensationCaseFinalized` обязаны прийти
в том порядке, в котором произошли).
"""

from __future__ import annotations

import json
from typing import Any

from redis.asyncio import Redis

STREAM_PREFIX = "fps.events"
# Максимальная длина потока. Не безграничная: Redis держит журнал в
# памяти, а события старше нескольких суток уже разобраны всеми
# потребителями — источником истины остаётся `outbox_message` в
# PostgreSQL, откуда поток можно перестроить целиком.
MAX_STREAM_LENGTH = 100_000


def stream_name(aggregate_type: str) -> str:
    return f"{STREAM_PREFIX}.{aggregate_type}"


def group_name(module: str, aggregate_type: str) -> str:
    """Имя consumer group включает МОДУЛЬ-потребитель.

    Иначе два модуля, читающих один поток (а именно это и произойдёт с
    `CompensationLineCreated`: его ждут `rest_balance` и построитель
    отчётов), делили бы одну позицию, и каждое сообщение доставалось бы
    ровно одному из них.
    """
    return f"{module}.{aggregate_type}"


async def publish(
    redis: Redis, *, aggregate_type: str, event_id: str, event_type: str, payload: dict[str, Any]
) -> str:
    """Кладёт событие в поток своего агрегата.

    `payload` сериализуется в JSON целиком, а не раскладывается по полям
    записи Redis: поля события у каждого типа свои, и плоская запись
    заставила бы потребителя знать схему до разбора. `event_id`, наоборот,
    вынесен отдельным полем — по нему потребитель отсекает дубликаты, не
    разбирая тело.
    """
    return str(
        await redis.xadd(
            stream_name(aggregate_type),
            {
                "event_id": event_id,
                "event_type": event_type,
                "payload": json.dumps(payload, ensure_ascii=False),
            },
            maxlen=MAX_STREAM_LENGTH,
            approximate=True,
        )
    )


async def ensure_group(redis: Redis, *, aggregate_type: str, group: str) -> None:
    """Создаёт consumer group, если её ещё нет.

    `mkstream=True` — чтобы группа создавалась и на несуществующий поток:
    потребитель обычно стартует раньше первого события, и требовать
    обратного порядка запуска значило бы сделать порядок развёртывания
    частью работоспособности системы.

    `id="0"` — читать с начала журнала, а не с конца: воркер, впервые
    поднятый после того, как события уже пошли, обязан их получить.
    """
    try:
        await redis.xgroup_create(
            name=stream_name(aggregate_type), groupname=group, id="0", mkstream=True
        )
    except Exception as exc:  # noqa: BLE001 — redis-py поднимает ResponseError
        if "BUSYGROUP" not in str(exc):
            raise


async def read_new(
    redis: Redis,
    *,
    aggregate_type: str,
    group: str,
    consumer: str,
    count: int = 50,
    block_ms: int = 0,
) -> list[tuple[str, dict[str, str]]]:
    """Новые сообщения группы. `>` означает «то, что ещё никому не
    выдавалось»."""
    response = await redis.xreadgroup(
        groupname=group,
        consumername=consumer,
        streams={stream_name(aggregate_type): ">"},
        count=count,
        block=block_ms or None,
    )
    if not response:
        return []

    messages: list[tuple[str, dict[str, str]]] = []
    for _stream, entries in response:
        for message_id, fields in entries:
            decoded = {_as_str(k): _as_str(v) for k, v in fields.items()}
            messages.append((_as_str(message_id), decoded))
    return messages


async def acknowledge(redis: Redis, *, aggregate_type: str, group: str, message_id: str) -> None:
    """Подтверждение обрабатывается ОТДЕЛЬНО от чтения и только после
    успешной обработки: неподтверждённое сообщение остаётся в pending-листе
    группы и будет выдано повторно. Подтверждать сразу после чтения значило
    бы терять события при падении потребителя — то самое, ради чего
    выбраны Streams, а не pub/sub."""
    await redis.xack(stream_name(aggregate_type), group, message_id)


def _as_str(value: Any) -> str:
    return value.decode() if isinstance(value, bytes) else str(value)
