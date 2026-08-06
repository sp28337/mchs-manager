"""RB004 — потребитель `CompensationLineCreated`.

Замыкает цепочку Architecture Д6: `TimeAccounting → Compensation →
RestBalance`. Сутки отдыха начисляются потому, что появилась строка
компенсации, а не потому, что кто-то нажал кнопку, — это и есть
инвариант 8.1.2, прочитанный как процесс.

--- Что фильтруется ----------------------------------------------------

DoD задачи: «начисление создаётся только для строк с
`additional_rest_time`». Денежная компенсация — предмет расчёта денежного
довольствия (Приказ МЧС России от 27.06.2024 № 539), а не баланса ДДО, и
начислять по ней сутки значило бы компенсировать один и тот же час
дважды — ровно то, что запрещает п. 109 того же приказа.

Решение принимается по схеме события (`compensation.contracts`), а не
разбором сырого JSON: между публикацией и потреблением стоит Redis, то
есть граница, на которой типы теряются.

--- Идемпотентность ----------------------------------------------------

Доставка at-least-once. Три рубежа, и каждый нужен:

1. агрегат возвращает существующее движение по той же строке компенсации;
2. частичный уникальный индекс `uq_balance_accrual_per_compensation_line`
   ловит гонку двух воркеров;
3. событие, обработка которого отказала, НЕ подтверждается и вернётся.

Дубликат при этом успех, а не ошибка: иначе сообщение возвращалось бы в
pending-лист вечно.
"""

from __future__ import annotations

import json
import logging
import socket

from pydantic import ValidationError
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.building_blocks.infrastructure.event_stream import (
    acknowledge,
    ensure_group,
    group_name,
    read_new,
)
from src.building_blocks.infrastructure.outbox import OutboxWriter
from src.modules.compensation.contracts.compensation_line_created import (
    AGGREGATE_TYPE as COMPENSATION_AGGREGATE,
)
from src.modules.compensation.contracts.compensation_line_created import (
    EVENT_TYPE as COMPENSATION_LINE_CREATED,
)
from src.modules.compensation.contracts.compensation_line_created import (
    CompensationLineCreatedPayload,
)
from src.modules.rest_balance.application.commands.accrue_rest_days.command import (
    AccrueRestDaysCommand,
)
from src.modules.rest_balance.application.commands.accrue_rest_days.handler import (
    AccrueRestDaysHandler,
)
from src.modules.rest_balance.infrastructure.adapters import LegalRulesRestDayLength
from src.modules.rest_balance.infrastructure.orm_mapping import outbox_message_table
from src.modules.rest_balance.infrastructure.repositories import RestDaysBalanceRepository

logger = logging.getLogger(__name__)

MODULE = "rest_balance"
MAX_BATCHES_PER_TICK = 200


def _consumer_name() -> str:
    return socket.gethostname()


async def consume_compensation_lines_once(
    session_factory: async_sessionmaker[AsyncSession],
    redis: Redis,
    *,
    batch_size: int = 50,
) -> int:
    """Один проход потребителя. Возвращает число начисленных движений."""
    group = group_name(MODULE, COMPENSATION_AGGREGATE)
    await ensure_group(redis, aggregate_type=COMPENSATION_AGGREGATE, group=group)

    handled = 0
    # До исчерпания, а не одну пачку: поток агрегата несёт и
    # `CompensationCaseFinalized`, и строку на каждую категорию часов, так
    # что при накопившемся отставании пачка из 50 сообщений могла бы
    # целиком состоять из чужих событий.
    for _ in range(MAX_BATCHES_PER_TICK):
        messages = await read_new(
            redis,
            aggregate_type=COMPENSATION_AGGREGATE,
            group=group,
            consumer=_consumer_name(),
            count=batch_size,
        )
        if not messages:
            break
        handled += await _handle_batch(session_factory, redis, group, messages)

    return handled


async def _handle_batch(
    session_factory: async_sessionmaker[AsyncSession],
    redis: Redis,
    group: str,
    messages: list[tuple[str, dict[str, str]]],
) -> int:
    handled = 0
    for message_id, fields in messages:
        if fields.get("event_type") != COMPENSATION_LINE_CREATED:
            await acknowledge(
                redis,
                aggregate_type=COMPENSATION_AGGREGATE,
                group=group,
                message_id=message_id,
            )
            continue

        try:
            payload = CompensationLineCreatedPayload.model_validate(
                json.loads(fields["payload"])
            )
        except (ValidationError, ValueError) as exc:
            # Событие не соответствует опубликованной схеме. Повтор его не
            # исправит, поэтому оно подтверждается — но громко: молчаливое
            # проглатывание превратило бы рассогласование контракта в
            # потерю начисления, которую никто не заметит.
            logger.error(
                "rest_balance: событие %s (%s) не соответствует схеме контракта: %s",
                COMPENSATION_LINE_CREATED,
                message_id,
                exc,
            )
            await acknowledge(
                redis,
                aggregate_type=COMPENSATION_AGGREGATE,
                group=group,
                message_id=message_id,
            )
            continue

        if not payload.is_rest_time:
            # Денежная строка — предмет расчёта денежного довольствия.
            await acknowledge(
                redis,
                aggregate_type=COMPENSATION_AGGREGATE,
                group=group,
                message_id=message_id,
            )
            continue

        try:
            await _accrue(session_factory, payload)
        except Exception as exc:  # noqa: BLE001 — сообщение остаётся неподтверждённым
            logger.warning(
                "rest_balance: не удалось начислить по строке %s: %s",
                payload.line_id,
                exc,
            )
            continue

        await acknowledge(
            redis, aggregate_type=COMPENSATION_AGGREGATE, group=group, message_id=message_id
        )
        handled += 1

    return handled


async def _accrue(
    session_factory: async_sessionmaker[AsyncSession],
    payload: CompensationLineCreatedPayload,
) -> None:
    async with session_factory() as session:
        # Коэффициент читается из ТОЙ ЖЕ версии правила, на которую
        # сослалась компенсация: провенанс начисления и норма, по которой
        # оно посчитано, обязаны быть одним документом (см. докстринг
        # `adapters`).
        rest_day = LegalRulesRestDayLength(
            session, version_id=payload.legal_basis_rule_version_id
        )
        handler = AccrueRestDaysHandler(
            session,
            RestDaysBalanceRepository(session),
            OutboxWriter(session, outbox_message_table),
            rest_day.hours_per_rest_day,
        )
        await handler.handle(
            AccrueRestDaysCommand(
                employee_id=payload.employee_id,
                compensation_line_id=payload.line_id,
                hours_amount=payload.hours_amount,
                # Дата движения — конец периода, за который начислено: сутки
                # причитаются за март, даже если событие разобрано в апреле.
                movement_date=payload.period_end,
                legal_basis_rule_version_id=payload.legal_basis_rule_version_id,
            )
        )
