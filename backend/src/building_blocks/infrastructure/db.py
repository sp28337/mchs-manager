"""Process-wide async engine + the per-request `AsyncSession` dependency.

**Why this is in `building_blocks` and not in `composition/di.py`.** It
started in `di.py`, and every module's router imported `get_session` from
there. That looks harmless — one shared provider — but it inverts the
dependency the architecture is built on: `Composition` is "единственное
место, знающее обо ВСЕХ модулях" (Architecture разд. 5), so a module that
imports `Composition` transitively imports *every other module*.
`.importlinter`'s `independence-of-modules` contract caught it the moment
a second module existed, as a concrete path:

    personnel.api.router -> composition.di -> legal_rules.infrastructure...

Nothing was wrong with `personnel`; the shared provider was in the wrong
package. `building_blocks` is the package every module may import and
which may import no module (contract 3), which is exactly what a provider
used by all of them needs to be.

The engine is module-level state rather than something threaded through
FastAPI's `app.state`: Celery workers (Backend_Architecture разд. 7.3)
run the same code with no FastAPI app at all, and they need the same
engine.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def init_engine(*, dsn: str, pool_size: int) -> None:
    """Idempotent: re-initializing an already-initialized engine is a no-op.

    Called from the Composition Root at startup — which in a test session
    happens once per `TestClient`, since each triggers its own lifespan.
    """
    global _engine, _session_factory
    if _engine is not None:
        return
    _engine = create_async_engine(dsn, pool_size=pool_size)
    _session_factory = async_sessionmaker(_engine, expire_on_commit=False)


async def dispose_engine() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one `AsyncSession` per request.

    Raises rather than lazily creating an ad-hoc engine if called before
    `init_engine()` — a missing lifespan wiring is a startup bug, not
    something to paper over with an implicit fallback.

    Dependency-with-yield pattern verified against Context7
    (/websites/fastapi_tiangolo, "Database Session Dependency with Yield").
    """
    if _session_factory is None:
        raise RuntimeError(
            "Infrastructure not initialized — call init_infrastructure() at startup first"
        )
    async with _session_factory() as session:
        yield session
