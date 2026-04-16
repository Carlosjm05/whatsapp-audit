"""Configuración de la aplicación, leída del entorno."""
from __future__ import annotations

import os
from functools import lru_cache
from typing import List


class Settings:
    """Settings dirigidos por entorno para el API de auditoría."""

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
        self.jwt_expiry_hours: int = int(os.getenv("JWT_EXPIRY_HOURS", "8"))
        self.admin_user: str = os.getenv("ADMIN_USER", "")
        self.admin_password: str = os.getenv("ADMIN_PASSWORD", "")

        # Misc
        self.log_level: str = os.getenv("LOG_LEVEL", "INFO").upper()
        self.domain: str = os.getenv("DOMAIN", "")
        # Origenes extra separados por coma (ej. dashboard staging).
        extra = os.getenv("CORS_EXTRA_ORIGINS", "")
        self._extra_origins = [o.strip() for o in extra.split(",") if o.strip()]

        # Connection pool
        self.db_pool_min: int = int(os.getenv("DB_POOL_MIN", "1"))
        self.db_pool_max: int = int(os.getenv("DB_POOL_MAX", "10"))

        # Fail-fast: no permitir arrancar con secretos por defecto en prod.
        # Si alguien deja 'change-me-in-prod' en prod, el compromiso de los
        # JWT es trivial.
        self._validate()

    def _validate(self) -> None:
        # Solo fallamos si el flag explícito lo pide (prod). En dev permitimos
        # los defaults para agilizar el desarrollo local.
        strict = os.getenv("STRICT_CONFIG", "false").lower() in {"1", "true", "yes"}
        if strict:
            if self.jwt_secret in {"", "change-me-in-prod"} or len(self.jwt_secret) < 32:
                raise RuntimeError(
                    "JWT_SECRET invalido o demasiado corto. Configura un secreto "
                    "fuerte (>= 32 chars) via variable de entorno."
                )
            if not self.admin_user or not self.admin_password:
                raise RuntimeError(
                    "ADMIN_USER y ADMIN_PASSWORD son obligatorios en modo STRICT."
                )

    @property
    def cors_origins(self) -> List[str]:
        # En desarrollo aceptamos localhost. En producción solo el dominio
        # configurado + cualquier origen extra explícito.
        origins: set[str] = set()
        if self.domain:
            d = self.domain
            origins.add(f"https://{d}" if not d.startswith("http") else d)
        else:
            # Sin dominio configurado: asumimos dev con localhost.
            origins.add("http://localhost:3000")
        for o in self._extra_origins:
            origins.add(o)
        return sorted(origins)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
