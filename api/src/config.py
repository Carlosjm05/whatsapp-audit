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
        # Default: STRICT activado si hay DOMAIN o STRICT_CONFIG explícito.
        # Sin DOMAIN asumimos dev local y permitimos defaults para agilizar.
        # En prod (DOMAIN seteado) NO podemos arrancar con secretos por
        # defecto — el JWT sería trivial de comprometer.
        strict_explicit = os.getenv("STRICT_CONFIG", "").lower() in {"1", "true", "yes"}
        looks_like_prod = bool(self.domain)
        strict = strict_explicit or looks_like_prod
        # Excepción: STRICT_CONFIG=false explícito gana (override emergencia).
        if os.getenv("STRICT_CONFIG", "").lower() in {"0", "false", "no"}:
            strict = False

        if strict:
            if self.jwt_secret in {"", "change-me-in-prod"} or len(self.jwt_secret) < 32:
                raise RuntimeError(
                    "JWT_SECRET invalido o demasiado corto. En produccion (DOMAIN "
                    "seteado o STRICT_CONFIG=true) debe ser >= 32 chars y distinto "
                    "del default. Genera uno con: openssl rand -hex 64"
                )
            if not self.admin_user or not self.admin_password:
                raise RuntimeError(
                    "ADMIN_USER y ADMIN_PASSWORD son obligatorios en produccion. "
                    "Si querés saltar este check, exportá STRICT_CONFIG=false."
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
