"""Application configuration loaded from environment variables."""
from __future__ import annotations

import os
from functools import lru_cache
from typing import List


class Settings:
    """Environment-driven settings for the WhatsApp audit API."""

    def __init__(self) -> None:
        # Postgres
        self.postgres_host: str = os.getenv("POSTGRES_HOST", "postgres")
        self.postgres_port: int = int(os.getenv("POSTGRES_PORT", "5432"))
        self.postgres_db: str = os.getenv("POSTGRES_DB", "whatsapp_audit")
        self.postgres_user: str = os.getenv("POSTGRES_USER", "postgres")
        self.postgres_password: str = os.getenv("POSTGRES_PASSWORD", "postgres")

        # Redis
        self.redis_host: str = os.getenv("REDIS_HOST", "redis")
        self.redis_port: int = int(os.getenv("REDIS_PORT", "6379"))
        self.redis_password: str = os.getenv("REDIS_PASSWORD", "") or None  # type: ignore[assignment]

        # Auth
        self.jwt_secret: str = os.getenv("JWT_SECRET", "change-me-in-prod")
        self.jwt_algorithm: str = "HS256"
        self.jwt_expiry_hours: int = int(os.getenv("JWT_EXPIRY_HOURS", "24"))
        self.admin_user: str = os.getenv("ADMIN_USER", "oscar")
        self.admin_password: str = os.getenv("ADMIN_PASSWORD", "")

        # Misc
        self.log_level: str = os.getenv("LOG_LEVEL", "INFO").upper()
        self.domain: str = os.getenv("DOMAIN", "")

        # Connection pool
        self.db_pool_min: int = int(os.getenv("DB_POOL_MIN", "1"))
        self.db_pool_max: int = int(os.getenv("DB_POOL_MAX", "10"))

    @property
    def cors_origins(self) -> List[str]:
        origins = {"http://localhost:3000"}
        if self.domain:
            origins.add(self.domain)
            if not self.domain.startswith("http"):
                origins.add(f"https://{self.domain}")
        return list(origins)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
