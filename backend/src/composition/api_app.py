"""Composition Root — Api role (Backend_Architecture разд. 7.3, 8).

Only this file is allowed to know about every module at once. Currently
empty of module routers (none exist yet) — this is the F012 foundation
step: a FastAPI app that boots and answers a health-check, run via:

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

from src.composition.settings import get_settings


class AppState(TypedDict):
    """Placeholder for resources created once at startup and shared across
    requests (DB engine, Redis pool, EventBus). Populated in di.py once the
    first module's Infrastructure exists — kept empty and typed here so the
    lifespan contract is visible from day one."""


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[AppState]:
    settings = get_settings()
    # Real startup work (create_async_engine, Redis pool, EventBus wiring)
    # is added in composition/di.py as each module comes online — this
    # placeholder documents the shape without inventing infra that doesn't
    # exist yet (no module's Infrastructure/Write is implemented).
    _ = settings  # noqa: F841 — will be consumed once di.py exists
    yield {}


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


# app.include_router(...) calls are added here one per module, in the same
# order/prefix as openapi.yaml's `paths` (Backend_Architecture разд. 8),
# e.g.:
#   from src.modules.legal_rules.api.router import router as legal_rules_router
#   app.include_router(legal_rules_router, prefix="/api/v1/legal-rules", tags=["LegalRules"])
