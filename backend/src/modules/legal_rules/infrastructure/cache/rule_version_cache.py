"""`RuleVersionCache` — Redis cache-aside wrapper for `GetEffectiveRuleVersion`
(Backend_Architecture_FastAPI_Stack_FPS.md разд. 4: "Кэш справочных
данных | legal_rules (GetEffectiveRuleVersion)... Инвалидация по событию
(RuleVersionPublished)... а не только по TTL — устаревшие данные
недопустимы даже кратковременно").

HONEST GAP: event-based invalidation is NOT wired — there is no
EventBus/Outbox yet (`rule_repository.py` flags the same gap: `Rule.
pull_pending_events()` exists but nothing drains it into an event bus).
This is therefore an interim **TTL-only** cache-aside, not what the
architecture doc actually asks for. It is safe in the sense that a stale
hit is bounded by `ttl_seconds` and never returns the wrong rule/scope —
but a `RuleVersionPublished` event happening today will not be reflected
until the TTL expires, which the architecture doc explicitly says is
"недопустимо" for this data. Flagged here rather than silently accepted;
replacing this with real invalidation is the next step once
Transactional Outbox exists.

redis-py asyncio API verified against Context7 (/redis/redis-py):
`Redis.from_url()`, `.get()`/`.set(..., ex=seconds)`, `.aclose()`.
"""

from __future__ import annotations

import json
from datetime import date
from uuid import UUID

from pydantic import TypeAdapter
from redis.asyncio import Redis

from src.rule_engine.interpreter.version_resolver import ResolvedRuleVersion
from src.rule_engine.schemas.action import Action

_actions_adapter: TypeAdapter[list[Action]] = TypeAdapter(list[Action])


def _cache_key(*, rule_code: str, scope: dict[str, str], as_of: date) -> str:
    # Scope keys sorted for a stable cache key regardless of dict
    # insertion order — same canonicalization concern as `Scope.from_dict`
    # (legal_rules/domain/value_objects.py); not reused directly here to
    # avoid this Redis-facing module needing to know about that VO's shape.
    scope_part = json.dumps(scope, sort_keys=True, separators=(",", ":"))
    return f"legal_rules:effective_rule_version:{rule_code}:{scope_part}:{as_of.isoformat()}"


class RuleVersionCache:
    """Cache-aside, not read-through: callers call `get()`, and on a miss
    are responsible for calling `set()` themselves with the freshly
    resolved value (matches how `version_resolver.resolve_effective_version`
    is actually invoked — see `GetEffectiveRuleVersionHandler`)."""

    def __init__(self, redis: Redis, *, ttl_seconds: int = 300) -> None:
        self._redis = redis
        self._ttl_seconds = ttl_seconds

    async def get(
        self, *, rule_code: str, scope: dict[str, str], as_of: date
    ) -> ResolvedRuleVersion | None:
        raw = await self._redis.get(_cache_key(rule_code=rule_code, scope=scope, as_of=as_of))
        if raw is None:
            return None
        data = json.loads(raw)
        return ResolvedRuleVersion(
            id=UUID(data["id"]),
            rule_id=UUID(data["rule_id"]),
            version_no=data["version_no"],
            valid_from=date.fromisoformat(data["valid_from"]),
            valid_to=date.fromisoformat(data["valid_to"]) if data["valid_to"] is not None else None,
            actions=_actions_adapter.validate_python(data["actions"]),
        )

    async def set(
        self, *, rule_code: str, scope: dict[str, str], as_of: date, value: ResolvedRuleVersion
    ) -> None:
        payload = json.dumps(
            {
                "id": str(value.id),
                "rule_id": str(value.rule_id),
                "version_no": value.version_no,
                "valid_from": value.valid_from.isoformat(),
                "valid_to": value.valid_to.isoformat() if value.valid_to is not None else None,
                "actions": [action.model_dump(mode="json") for action in value.actions],
            }
        )
        await self._redis.set(
            _cache_key(rule_code=rule_code, scope=scope, as_of=as_of), payload, ex=self._ttl_seconds
        )
