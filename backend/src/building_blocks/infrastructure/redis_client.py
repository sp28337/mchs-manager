"""Process-wide Redis client.

Same reasoning as `db.py`: Redis serves several unrelated purposes across
modules (Backend_Architecture разд. 4 — reference-data cache, CQRS
projection cache, `Idempotency-Key` store, rate limiting), so the client
itself is shared infrastructure while each USE of it stays inside the
module that needs it. `legal_rules`' `RuleVersionCache` is built on top of
this client in that module's own `api/dependencies.py`; this file knows
nothing about rules.

One `Redis` instance per process, shared across requests — the client is
connection-pooled internally and safe to share.

redis-py asyncio API verified against Context7 (/redis/redis-py):
`Redis.from_url()`, `.aclose()`.
"""

from __future__ import annotations

from redis.asyncio import Redis

_redis: Redis | None = None


def init_redis(*, url: str) -> None:
    """Idempotent, for the same reason as `db.init_engine`."""
    global _redis
    if _redis is None:
        _redis = Redis.from_url(url)


async def dispose_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
    _redis = None


def get_redis() -> Redis:
    if _redis is None:
        raise RuntimeError(
            "Infrastructure not initialized — call init_infrastructure() at startup first"
        )
    return _redis
