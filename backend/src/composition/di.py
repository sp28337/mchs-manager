"""Composition/di.py — the "единственное место, компилирующее зависимость
от ВСЕХ модулей сразу" (Architecture разд. 8). Currently only wires up
what `legal_rules`'s API needs (a DB engine + per-request session) — this
file grows one module at a time, never invents infra a module doesn't
need yet.

FastAPI dependency-with-yield pattern verified against Context7
(/websites/fastapi_tiangolo, "Database Session Dependency with Yield").
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from src.composition.settings import get_settings
from src.modules.legal_rules.infrastructure.write.orm_mapping import start_mappers

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def init_infrastructure() -> None:
    """Called once from `api_app.lifespan` at process startup — but also,
    in practice, once per `TestClient` instantiated in a test session,
    since each triggers its own lifespan startup/shutdown.

    `start_mappers()` is called unconditionally on every call — it is
    idempotent at its own source now (orm_mapping.py tracks whether
    mapping already happened, since multiple call sites across the
    process — this function AND every integration test module — may
    legitimately call it independently). Engine creation is guarded
    separately: the engine is fine to dispose and recreate across
    multiple `TestClient` startup/shutdown cycles within the same
    process, unlike the one-time mapping.
    """
    global _engine, _session_factory
    start_mappers()
    if _engine is None:
        _engine = create_async_engine(
            get_settings().database_dsn, pool_size=get_settings().database_pool_size
        )
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False)


async def dispose_infrastructure() -> None:
    """Called from `api_app.lifespan` at shutdown."""
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one `AsyncSession` per request. Raises
    `RuntimeError` rather than silently creating an ad-hoc engine if
    called before `init_infrastructure()` — a missing lifespan wiring is a
    startup bug, not something to paper over with an implicit fallback."""
    if _session_factory is None:
        raise RuntimeError(
            "Infrastructure not initialized — call init_infrastructure() at startup first"
        )
    async with _session_factory() as session:
        yield session
