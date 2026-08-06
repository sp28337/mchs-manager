"""CO010/CO011 — потребитель `TimesheetApproved` и построитель прогноза.

--- Почему дело заводится событием, а не вызовом --------------------

Architecture Д6 требует, чтобы цепочка `TimeAccounting → Compensation →
RestBalance` была прослеживаемой последовательностью событий, а не тремя
независимыми действиями. Прямой вызов `time_accounting → compensation`
нарушил бы и это, и границу модулей: `time_accounting` не должен знать,
что компенсация вообще существует.

Табельщик, утвердивший табель, никакого дела о компенсации не заводит —
оно появляется само, потому что появился факт. Это и есть смысл
инварианта 7.1.1 «компенсация не может опережать факт», прочитанного с
другой стороны: она не может и ОТСТАВАТЬ от него по чьему-то недосмотру.

--- Идемпотентность -------------------------------------------------

Доставка at-least-once (см. `event_stream`), поэтому обработчик обязан
переживать повтор. Здесь два рубежа: обработчик сам проверяет наличие
дела на период (и молча пропускает событие), а на случай гонки двух
воркеров стоит `uq_compensation_case_timesheet`.

Дубликат не считается ошибкой и подтверждается как успех: иначе
сообщение возвращалось бы в pending-лист вечно.
"""

from __future__ import annotations

import json
import logging
import socket
from datetime import date
from uuid import UUID

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.building_blocks.infrastructure.event_stream import (
    acknowledge,
    ensure_group,
    group_name,
    read_new,
)
from src.modules.compensation.application.commands.create_compensation_case.command import (
    CreateCompensationCaseCommand,
)
from src.modules.compensation.application.commands.create_compensation_case.handler import (
    CreateCompensationCaseHandler,
)
from src.modules.compensation.application.services.compensation_allocation import (
    CompensationAllocationService,
)
from src.modules.compensation.domain.errors import (
    CaseAlreadyExistsError,
    NothingToCompensateError,
    TimesheetNotApprovedError,
)
from src.modules.compensation.infrastructure.adapters import (
    LegalRulesCompensationRule,
    PersonnelEmployeeUnit,
    TimeAccountingApprovedPeriod,
)
from src.modules.compensation.infrastructure.repositories import CompensationCaseRepository

logger = logging.getLogger(__name__)

TIMESHEET_AGGREGATE = "Timesheet"
TIMESHEET_APPROVED = "TimesheetApproved"
MODULE = "compensation"

# Предохранитель от бесконечного тика — см. `consume_timesheet_approved_once`.
MAX_BATCHES_PER_TICK = 200


def _consumer_name() -> str:
    """Имя потребителя внутри группы — имя хоста воркера.

    Redis Streams использует его для pending-листа: сообщения, взятые
    упавшим воркером, остаются числиться за ним, и их можно затребовать
    (`XCLAIM`) с другого. Случайное имя на запуск сделало бы такие
    сообщения безымянными и потому невосстановимыми.
    """
    return socket.gethostname()


async def consume_timesheet_approved_once(
    session_factory: async_sessionmaker[AsyncSession],
    redis: Redis,
    *,
    batch_size: int = 50,
) -> int:
    """Один проход потребителя. Возвращает число обработанных событий.

    Зависимости явные — по той же причине, что у релея: пул соединений
    привязан к event loop, а воркер создаёт свой на каждую задачу.
    """
    group = group_name(MODULE, TIMESHEET_AGGREGATE)
    await ensure_group(redis, aggregate_type=TIMESHEET_AGGREGATE, group=group)

    handled = 0
    # Читаем ДО ИСЧЕРПАНИЯ, а не одну пачку.
    #
    # Поток агрегата несёт все его события, а `TimesheetApproved` среди
    # них — меньшинство: на каждое утверждение приходится по событию на
    # каждую зарегистрированную смену. Одна пачка в 50 сообщений при
    # накопившемся отставании состояла бы из чужих событий целиком, и
    # разбор отставания в тысячу сообщений растянулся бы на минуты при
    # тике в 10 секунд — то есть компенсация появлялась бы с задержкой,
    # растущей вместе с нагрузкой.
    #
    # Ограничение сверху всё же есть: тик не должен длиться вечно, иначе
    # задача Celery перестанет завершаться.
    for _ in range(MAX_BATCHES_PER_TICK):
        messages = await read_new(
            redis,
            aggregate_type=TIMESHEET_AGGREGATE,
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
        if fields.get("event_type") != TIMESHEET_APPROVED:
            # Поток агрегата несёт все его события; чужие подтверждаются
            # сразу, иначе они копились бы в pending-листе этой группы.
            await acknowledge(
                redis, aggregate_type=TIMESHEET_AGGREGATE, group=group, message_id=message_id
            )
            continue

        payload = json.loads(fields["payload"])
        try:
            await _create_case(session_factory, payload)
        except Exception as exc:  # noqa: BLE001 — сообщение остаётся неподтверждённым
            logger.warning(
                "compensation: не удалось обработать %s (%s): %s",
                TIMESHEET_APPROVED,
                message_id,
                exc,
            )
            continue

        await acknowledge(
            redis, aggregate_type=TIMESHEET_AGGREGATE, group=group, message_id=message_id
        )
        handled += 1

    return handled


async def _create_case(
    session_factory: async_sessionmaker[AsyncSession], payload: dict[str, str]
) -> None:
    async with session_factory() as session:
        rules = LegalRulesCompensationRule(session)
        handler = CreateCompensationCaseHandler(
            session,
            CompensationCaseRepository(session),
            TimeAccountingApprovedPeriod(session),
            CompensationAllocationService(
                lambda as_of, scope: rules.rule_for(as_of=as_of, scope=scope)
            ),
            PersonnelEmployeeUnit(session),
        )
        try:
            case = await handler.handle(
                CreateCompensationCaseCommand(
                    employee_id=UUID(payload["employee_id"]),
                    period_start=date.fromisoformat(payload["period_start"]),
                    period_end=date.fromisoformat(payload["period_end"]),
                )
            )
        except CaseAlreadyExistsError:
            # Повтор доставки или гонка двух воркеров — не ошибка.
            return
        except NothingToCompensateError:
            # Приказ № 410 пп. 13-14: у этого сотрудника компенсируемых
            # часов нет по закону. Событие обработано — повторять его
            # бессмысленно, следующая доставка дала бы тот же ответ.
            logger.info(
                "compensation: за период сотрудника %s компенсировать нечего (Приказ 410)",
                payload.get("employee_id"),
            )
            return
        except TimesheetNotApprovedError:
            # Табель успели переоткрыть между публикацией события и его
            # разбором. Дело не заводится, и это верно: компенсация не
            # может опережать факт, а факт перестал быть окончательным.
            # Новое утверждение породит новое событие.
            logger.info(
                "compensation: табель %s переоткрыт до разбора события, дело не заведено",
                payload.get("timesheet_id"),
            )
            return

        logger.info(
            "compensation: по событию %s заведено дело %s (%s строк)",
            TIMESHEET_APPROVED,
            case.id,
            len(case.lines),
        )
