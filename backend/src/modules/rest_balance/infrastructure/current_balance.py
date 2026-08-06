"""RB003/RB012 — пересчёт материализованного остатка.

--- CONCURRENTLY, и почему это не украшение ---------------------------

Обычный `REFRESH MATERIALIZED VIEW` берёт `ACCESS EXCLUSIVE` на
представление: на время пересчёта чтение остатка блокируется целиком.
Экран сотрудника в этот момент не «подождёт» — он повиснет, и тем
дольше, чем больше в системе движений.

`CONCURRENTLY` пересчитывает в стороне и подменяет содержимое, оставляя
чтение доступным. Он требует уникального индекса, и он создан в миграции
0021 именно ради этого.

--- Первый пересчёт ----------------------------------------------------

`CONCURRENTLY` невозможен, пока представление ни разу не заполнялось
(`ERRCODE 55000`, «materialized view has not been populated»). При
создании миграцией оно заполняется сразу, но на пустой базе после
`downgrade`/`upgrade` состояние может отличаться, поэтому первый отказ
переводится в обычный `REFRESH`, а не наружу: пересчитать остаток важнее,
чем сделать это без блокировки, а блокировать пустое представление
нечего.

--- Периодичность ------------------------------------------------------

Тик заведён в `celery_app` рядом с релеем и потребителями. Частый
пересчёт не нужен и вреден: остаток меняется движениями, а движения —
редкое событие в масштабе рабочего дня. Число, отставшее на минуту,
честнее числа, ради свежести которого база занята пересчётом постоянно.
"""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

logger = logging.getLogger(__name__)

_NOT_POPULATED = "55000"


async def refresh_current_balance(session_factory: async_sessionmaker[AsyncSession]) -> None:
    """Пересчитать `rest_balance.current_balance`.

    Зависимость явная — по той же причине, что у релея и потребителей:
    пул соединений привязан к event loop, а воркер создаёт свой на каждую
    задачу.
    """
    async with session_factory() as session:
        try:
            await session.execute(
                text("REFRESH MATERIALIZED VIEW CONCURRENTLY rest_balance.current_balance")
            )
            await session.commit()
            return
        except DBAPIError as exc:
            await session.rollback()
            if getattr(getattr(exc, "orig", None), "sqlstate", None) != _NOT_POPULATED:
                raise
            logger.info(
                "rest_balance: current_balance ещё не заполнено — обычный REFRESH"
            )

    async with session_factory() as session:
        await session.execute(text("REFRESH MATERIALIZED VIEW rest_balance.current_balance"))
        await session.commit()
