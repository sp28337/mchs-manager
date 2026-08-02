"""LR011 — integration tests for `RuleVersionCache` against a REAL Redis
instance, and for the cache-aside wiring in `GetEffectiveRuleVersionHandler`.
"""

from __future__ import annotations

from datetime import date
from uuid import uuid4

import pytest
from pydantic import TypeAdapter
from redis.asyncio import Redis
from redis.exceptions import ConnectionError as RedisConnectionError

from src.modules.legal_rules.infrastructure.cache.rule_version_cache import RuleVersionCache
from src.rule_engine.interpreter.version_resolver import ResolvedRuleVersion
from src.rule_engine.schemas.action import Action

pytestmark = pytest.mark.asyncio

_action_adapter: TypeAdapter[Action] = TypeAdapter(Action)


async def _redis_reachable() -> bool:
    client = Redis.from_url("redis://localhost:6379/0")
    try:
        await client.ping()
        return True
    except RedisConnectionError:
        return False
    finally:
        await client.aclose()


@pytest.fixture
async def redis() -> Redis:  # type: ignore[misc]
    if not await _redis_reachable():
        pytest.skip("Redis not reachable — start it with `make up` first (see docker-compose.yml)")
    client = Redis.from_url("redis://localhost:6379/0")
    yield client
    await client.aclose()


def _sample_value() -> ResolvedRuleVersion:
    action = _action_adapter.validate_python(
        {"node_type": "set_result", "field": "weekly_norm_hours", "formula": {"node_type": "literal", "value": 40}}
    )
    return ResolvedRuleVersion(
        id=uuid4(), rule_id=uuid4(), version_no=1, valid_from=date(2024, 1, 1), valid_to=None, actions=[action]
    )


async def test_cold_miss_returns_none(redis: Redis) -> None:
    cache = RuleVersionCache(redis, ttl_seconds=5)
    result = await cache.get(rule_code=f"TEST.{uuid4()}", scope={"category": "normal"}, as_of=date(2024, 6, 1))
    assert result is None


async def test_set_then_get_round_trips_all_fields(redis: Redis) -> None:
    cache = RuleVersionCache(redis, ttl_seconds=5)
    rule_code = f"TEST.{uuid4()}"
    scope = {"category": "normal"}
    as_of = date(2024, 6, 1)
    value = _sample_value()

    await cache.set(rule_code=rule_code, scope=scope, as_of=as_of, value=value)
    hit = await cache.get(rule_code=rule_code, scope=scope, as_of=as_of)

    assert hit is not None
    assert hit.id == value.id
    assert hit.rule_id == value.rule_id
    assert hit.version_no == value.version_no
    assert hit.valid_from == value.valid_from
    assert hit.valid_to == value.valid_to
    assert hit.actions[0].field == value.actions[0].field  # type: ignore[union-attr]
    assert hit.actions[0].formula.value == value.actions[0].formula.value  # type: ignore[union-attr]


async def test_scope_key_order_does_not_affect_cache_hit(redis: Redis) -> None:
    """{"a": "1", "b": "2"} and {"b": "2", "a": "1"} must hit the same key —
    dict insertion order is not part of the cache identity."""
    cache = RuleVersionCache(redis, ttl_seconds=5)
    rule_code = f"TEST.{uuid4()}"
    as_of = date(2024, 6, 1)
    value = _sample_value()

    await cache.set(rule_code=rule_code, scope={"a": "1", "b": "2"}, as_of=as_of, value=value)
    hit = await cache.get(rule_code=rule_code, scope={"b": "2", "a": "1"}, as_of=as_of)

    assert hit is not None
    assert hit.id == value.id


async def test_different_scope_is_a_cache_miss(redis: Redis) -> None:
    cache = RuleVersionCache(redis, ttl_seconds=5)
    rule_code = f"TEST.{uuid4()}"
    as_of = date(2024, 6, 1)
    value = _sample_value()

    await cache.set(rule_code=rule_code, scope={"category": "normal"}, as_of=as_of, value=value)
    miss = await cache.get(rule_code=rule_code, scope={"category": "hazardous"}, as_of=as_of)

    assert miss is None


async def test_different_as_of_is_a_cache_miss(redis: Redis) -> None:
    cache = RuleVersionCache(redis, ttl_seconds=5)
    rule_code = f"TEST.{uuid4()}"
    scope = {"category": "normal"}
    value = _sample_value()

    await cache.set(rule_code=rule_code, scope=scope, as_of=date(2024, 6, 1), value=value)
    miss = await cache.get(rule_code=rule_code, scope=scope, as_of=date(2024, 7, 1))

    assert miss is None
