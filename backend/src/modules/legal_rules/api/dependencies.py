"""FastAPI dependencies specific to `legal_rules` — the per-module
`api/dependencies.py` that Backend_Architecture разд. 2 places in every
module's `api/` package.

The generic ones (DB session, Redis client) come from `building_blocks`;
what belongs here is only what is about THIS module — the rule-version
cache. Keeping it here rather than in `composition/di.py` is what stops a
router from importing the Composition Root and, through it, every other
module (see `building_blocks/infrastructure/db.py` for the full story).
"""

from __future__ import annotations

from src.building_blocks.infrastructure.redis_client import get_redis
from src.modules.legal_rules.infrastructure.cache.rule_version_cache import RuleVersionCache


def get_rule_version_cache() -> RuleVersionCache:
    """One shared `Redis` client, a new lightweight `RuleVersionCache`
    wrapper per request."""
    return RuleVersionCache(get_redis())
