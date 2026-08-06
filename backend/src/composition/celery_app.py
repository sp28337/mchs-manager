"""Composition Root — Worker role (Backend_Architecture разд. 7.1, 8).

Второй способ запустить систему, рядом с `api_app`:

    celery -A src.composition.celery_app:celery worker -Q default
    celery -A src.composition.celery_app:celery beat

--- Что делает воркер и почему это не может делать API ----------------

Релей outbox (F013) обязан работать НЕПРЕРЫВНО и независимо от того,
приходят ли запросы: событие, записанное последним HTTP-вызовом рабочего
дня, должно уйти потребителю, даже если следующий запрос будет завтра.
Привязать релей к обработке запросов значило бы поставить доставку
события в зависимость от постороннего трафика.

--- Почему задачи синхронные, а внутри `asyncio.run` ------------------

Celery 5 остаётся синхронным исполнителем, а весь доступ к БД в проекте
асинхронный (SQLAlchemy 2 async + asyncpg). Мост — `asyncio.run` внутри
задачи: он создаёт собственный event loop на вызов, что для задачи,
выполняющейся раз в несколько секунд, дешевле, чем поддерживать общий
loop между задачами и разбираться с его состоянием после исключения.

Движок и Redis при этом переинициализируются на каждый вызов
(`init_infrastructure` идемпотентен, но loop новый), поэтому воркер держит
собственные пулы соединений — те же, что API, использовать нельзя: они
привязаны к чужому event loop.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Coroutine
from typing import Any

from celery import Celery
from celery.schedules import crontab

from src.building_blocks.infrastructure.db import get_session_factory
from src.building_blocks.infrastructure.redis_client import get_redis
from src.composition.di import init_infrastructure
from src.composition.settings import get_settings

settings = get_settings()

celery = Celery(
    "fps_timekeeping",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)
celery.conf.update(
    task_default_queue=settings.celery_task_default_queue,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    # Подтверждение ПОСЛЕ выполнения: если воркер упадёт посреди релея,
    # задача вернётся в очередь. Повторная публикация безопасна (релей
    # at-least-once по построению), а потерянный проход означал бы
    # задержку доставки до следующего тика.
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    beat_schedule={
        "relay-outbox-every-10-seconds": {
            "task": "outbox.relay_all",
            # 10 секунд — не «как можно чаще»: DoD TA027 говорит о
            # «секундах», а более частый опрос пустой очереди тратит
            # соединения к БД ради нулевого выигрыша. Задержка доставки
            # события компенсации в пределах десятка секунд ни на одно
            # требование не влияет.
            "schedule": 10.0,
        },
        "consume-timesheet-approved-every-10-seconds": {
            "task": "compensation.consume_timesheet_approved",
            "schedule": 10.0,
        },
        "consume-compensation-lines-every-10-seconds": {
            "task": "rest_balance.consume_compensation_lines",
            "schedule": 10.0,
        },
        "refresh-current-balance-every-minute": {
            "task": "rest_balance.refresh_current_balance",
            # RB012. Минута, а не десять секунд: остаток меняется
            # движениями, а движения — редкое событие в масштабе рабочего
            # дня. Число, отставшее на минуту, честнее числа, ради
            # свежести которого база занята пересчётом постоянно. Точный
            # ответ на дату всё равно считается по журналу, а не отсюда.
            "schedule": 60.0,
        },
        "rebuild-regional-forecast-daily": {
            "task": "compensation.rebuild_regional_forecast",
            # Раз в сутки ночью (CO014): прогноз — управленческий отчёт,
            # он не обязан быть свежим до минуты, а перестроение проходит
            # по всем подразделениям сразу.
            "schedule": crontab(hour=2, minute=30),
        },
    },
)

def run_async[T](coro_factory: Callable[[], Coroutine[Any, Any, T]]) -> T:
    """Мост между синхронным Celery и асинхронным доступом к данным.

    Фабрика, а не готовая корутина: корутина, созданная до
    `asyncio.run`, была бы привязана к чужому (уже закрытому) loop'у.
    """
    return asyncio.run(coro_factory())


def register_tasks() -> None:
    """Импортирует модули с задачами.

    Отдельной функцией и в конце файла — чтобы задачи могли импортировать
    `celery` отсюда, не создавая цикла импортов. Вызывается при загрузке
    воркера (`celery -A ...` импортирует этот модуль целиком).
    """
    from src.building_blocks.infrastructure import outbox_tasks  # noqa: F401
    from src.modules.compensation.infrastructure import tasks as compensation_tasks  # noqa: F401
    from src.modules.rest_balance.infrastructure import tasks as rest_balance_tasks  # noqa: F401


register_tasks()


# ------------------------------------------------------------- задачи
#
# Объявлены здесь, а не в модулях, по той же причине, по которой здесь
# объявлены роутеры: это единственный файл, которому позволено знать обо
# всех модулях сразу (Backend_Architecture разд. 7.3). Сама РАБОТА живёт
# в модулях — здесь только регистрация и мост из синхронного Celery в
# асинхронный код.


@celery.task(name="outbox.relay_all")
def relay_all() -> int:
    """F013. Переносит события всех модулей из outbox в поток."""
    from src.building_blocks.infrastructure.outbox_tasks import relay_all_once

    def _run() -> Coroutine[Any, Any, int]:
        init_infrastructure()
        return relay_all_once(get_session_factory(), get_redis())

    return run_async(_run)


@celery.task(name="compensation.consume_timesheet_approved")
def consume_timesheet_approved() -> int:
    """CO010/CO011. Заводит дело о компенсации по утверждённому табелю."""
    from src.modules.compensation.infrastructure.tasks import (
        consume_timesheet_approved_once,
    )

    def _run() -> Coroutine[Any, Any, int]:
        init_infrastructure()
        return consume_timesheet_approved_once(get_session_factory(), get_redis())

    return run_async(_run)


@celery.task(name="compensation.rebuild_regional_forecast")
def rebuild_regional_forecast() -> int:
    """CO014. Перестраивает проекцию регионального прогноза."""
    from src.modules.compensation.infrastructure.forecast import rebuild_forecast

    def _run() -> Coroutine[Any, Any, int]:
        init_infrastructure()
        return rebuild_forecast(get_session_factory())

    return run_async(_run)


@celery.task(name="rest_balance.consume_compensation_lines")
def consume_compensation_lines() -> int:
    """RB004. Начисляет ДДО по строкам компенсации с формой отдыха."""
    from src.modules.rest_balance.infrastructure.tasks import (
        consume_compensation_lines_once,
    )

    def _run() -> Coroutine[Any, Any, int]:
        init_infrastructure()
        return consume_compensation_lines_once(get_session_factory(), get_redis())

    return run_async(_run)


@celery.task(name="rest_balance.refresh_current_balance")
def refresh_current_balance() -> None:
    """RB012. Пересчитывает материализованный остаток ДДО."""
    from src.modules.rest_balance.infrastructure.current_balance import (
        refresh_current_balance as refresh,
    )

    def _run() -> Coroutine[Any, Any, None]:
        init_infrastructure()
        return refresh(get_session_factory())

    return run_async(_run)
