"""Application settings, validated at process startup — not at some point
mid-runtime (Backend_Architecture_FastAPI_Stack_FPS.md, разд. 6.3).

Syntax verified against pydantic-settings docs (Context7,
/pydantic/pydantic-settings): SettingsConfigDict + env_file + env_prefix.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="FPS_",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Database (SQLAlchemy 2 async engine, see Backend_Architecture разд. 3.3) ---
    database_dsn: str = "postgresql+asyncpg://fps:fps@localhost:5432/fps_timekeeping"
    database_pool_size: int = 20

    # --- Redis: cache / idempotency store / rate-limit / Celery broker ---
    # (kept as one URL for local dev; Backend_Architecture разд. 4 calls for a
    # SEPARATE Redis instance for Celery broker/result-backend in production —
    # override REDIS_BROKER_URL via env when deploying).
    redis_url: str = "redis://localhost:6379/0"
    redis_broker_url: str | None = None

    # --- JWT verification (Identity Provider issues tokens; see API_Conventions разд. 2) ---
    jwt_public_key: str
    jwt_algorithm: str = "RS256"

    # --- Celery ---
    celery_task_default_queue: str = "default"

    @property
    def celery_broker_url(self) -> str:
        return self.redis_broker_url or self.redis_url

    @property
    def celery_result_backend(self) -> str:
        return self.redis_broker_url or self.redis_url


@lru_cache
def get_settings() -> Settings:
    """Cached factory — FastAPI Depends(get_settings) and Celery both read
    through this so env is parsed exactly once per process."""
    return Settings()
