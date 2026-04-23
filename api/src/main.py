"""Punto de entrada FastAPI para el API de auditoría de WhatsApp."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import redis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from . import auth as auth_module
from . import db as db_module
from .config import get_settings
from .ratelimit import limiter
from .routers import (
    advisors,
    catalogs,
    competitors,
    cost as cost_router,
    errors as errors_router,
    export,
    knowledge_base,
    leads,
    overview,
    product_intel,
    qr as qr_router,
    system as system_router,
    trends,
)
from .schemas import HealthResponse


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    _configure_logging(settings.log_level)
    log = logging.getLogger("wa_api")
    try:
        db_module.init_pool()
        log.info("Pool de DB listo")
    except Exception as e:
        log.error("Fallo al iniciar pool de DB: %s", e)
    yield
    try:
        db_module.close_pool()
    except Exception:  # pragma: no cover
        pass


app = FastAPI(
    title="Ortiz Finca Raíz — API de auditoría WhatsApp",
    version="1.0.0",
    lifespan=lifespan,
)

_settings = get_settings()

# Rate limiting (aplicado selectivamente a endpoints sensibles; ver auth.py).
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS: cerrado al dominio configurado (y extras explícitos). En dev con
# DOMAIN vacío acepta localhost:3000.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# --- Routers ---
app.include_router(auth_module.router)
app.include_router(overview.router)
app.include_router(leads.router)
app.include_router(advisors.router)
app.include_router(product_intel.router)
app.include_router(errors_router.router)
app.include_router(competitors.router)
app.include_router(knowledge_base.router)
app.include_router(export.router)
app.include_router(trends.router)
app.include_router(catalogs.router)
app.include_router(qr_router.router)
app.include_router(system_router.router)
app.include_router(cost_router.router)


# --- Health ---
def _redis_ping() -> bool:
    s = get_settings()
    try:
        client = redis.Redis(
            host=s.redis_host,
            port=s.redis_port,
            password=s.redis_password,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        return bool(client.ping())
    except Exception:
        return False


@app.get("/health", response_model=HealthResponse, tags=["meta"])
def health() -> HealthResponse:
    """Probe para contenedor/orquestador. Devuelve 200 con {"status":"ok"}
    solo si DB y Redis responden; si alguno falla, 503. No expone detalles
    para evitar reconocimiento."""
    db_ok = db_module.ping()
    redis_ok = _redis_ping()
    if not (db_ok and redis_ok):
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="servicio degradado")
    return HealthResponse(status="ok")


@app.get("/", tags=["meta"])
def root() -> dict:
    return {
        "service": "wa_api",
        "client": "Ortiz Finca Raíz",
        "docs": "/docs",
        "health": "/health",
    }
