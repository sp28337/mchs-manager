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
from src.modules.compensation.api.router import router as compensation_router
from src.modules.leave_management.api.router import router as leave_management_router
from src.modules.legal_rules.api.router import router as legal_rules_router
from src.modules.personnel.api.router import router as personnel_router
from src.modules.rest_balance.api.router import router as rest_balance_router
from src.modules.scheduling.api.router import router as scheduling_router
from src.modules.service_calendar.api.router import router as service_calendar_router
from src.modules.time_accounting.api.router import router as time_accounting_router


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


# One include_router() per module, same prefix/tag as openapi.yaml's
# `paths` (Backend_Architecture разд. 8). `legal_rules` is first because
# it's the only module with no incoming dependencies (Architecture разд.
# 4.2 п.4) and so the first one implemented end-to-end.
app.include_router(legal_rules_router, prefix="/api/v1/legal-rules", tags=["LegalRules"])
# `personnel` next: a Generic subdomain (Architecture разд. 4) that every
# Core module references by employee id, so it has to exist before
# `TimeAccounting`/`Scheduling` can be built against it.
app.include_router(personnel_router, prefix="/api/v1/personnel", tags=["Personnel"])
# `service_calendar`: the other Generic subdomain, and the reference data
# every norm calculation reads (Алгоритм Б шаги 5-7).
app.include_router(
    service_calendar_router, prefix="/api/v1/service-calendar", tags=["ServiceCalendar"]
)
# `scheduling` — первый модуль, потребляющий чужие Contracts
# (`personnel` и `legal_rules`), и поставщик PlannedShift для
# будущего TimeAccounting.
app.include_router(scheduling_router, prefix="/api/v1/scheduling", tags=["Scheduling"])
app.include_router(
    time_accounting_router, prefix="/api/v1/time-accounting", tags=["TimeAccounting"]
)
app.include_router(compensation_router, prefix="/api/v1/compensation", tags=["Compensation"])
app.include_router(rest_balance_router, prefix="/api/v1/rest-balance", tags=["RestBalance"])
app.include_router(leave_management_router, prefix="/api/v1/leave", tags=["LeaveManagement"])
