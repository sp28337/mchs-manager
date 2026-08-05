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

from src.composition.di import dispose_infrastructure, init_infrastructure
from src.modules.legal_rules.api.router import router as legal_rules_router
from src.modules.personnel.api.router import router as personnel_router


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
