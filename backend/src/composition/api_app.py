"""Composition Root — Api role (Backend_Architecture разд. 7.3, 8).

Only this file is allowed to know about every module at once.

    uvicorn src.composition.api_app:app --reload

Lifespan pattern verified against FastAPI docs (Context7,
/fastapi/fastapi): @asynccontextmanager is the current recommended way to
manage startup/shutdown resources, superseding the old @app.on_event().
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TypedDict

from fastapi import FastAPI

from src.building_blocks.application.problem_handlers import install_problem_handlers
from src.composition.di import dispose_infrastructure, init_infrastructure
from src.modules.service_calendar.api.router import router as service_calendar_router
from src.modules.shift_accounting.api.router import router as shift_accounting_router


class AppState(TypedDict):
    """Placeholder for resources created once at startup and shared across
    requests. `di.py` currently owns the DB engine/session-factory as
    module-level state rather than something threaded through this dict —
    kept empty and typed here so the lifespan contract stays visible."""


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[AppState]:
    init_infrastructure()
    yield {}
    await dispose_infrastructure()


app = FastAPI(
    title="FPS Service Time Accounting API",
    version="1.0.0",
    lifespan=lifespan,
)

# Единый конверт ошибок RFC 7807 для всех модулей (API_Conventions разд. 3).
# Ставится здесь, а не в модулях: разд. 3 требует одинакового поведения от
# всего API, а обработчики исключений — свойство приложения, а не роутера.
install_problem_handlers(app)


@app.get("/health", tags=["_internal"])
async def health() -> dict[str, str]:
    """Liveness/readiness probe. Deliberately dependency-free for now —
    once composition/di.py wires a DB engine, this should also verify
    connectivity (`SELECT 1`) rather than just process liveness."""
    return {"status": "ok"}


# Два модуля, и порядок отражает зависимость.
#
# `service_calendar` — производственный календарь: он не справочник, а
# вход расчёта. Норма периода считается по числу рабочих и
# предпраздничных дней (ст. 104, 95 ТК РФ), и без него сверять нечего.
#
# `shift_accounting` — профиль пожарного, его отсутствия, расчёт периода
# и сверка с выданным табелем. Читает календарь, календарь о нём не
# знает.
app.include_router(
    service_calendar_router, prefix="/api/v1/service-calendar", tags=["ServiceCalendar"]
)
app.include_router(
    shift_accounting_router, prefix="/api/v1/shift-accounting", tags=["ShiftAccounting"]
)
