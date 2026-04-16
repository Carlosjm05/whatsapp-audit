"""FastAPI application entrypoint for Ortiz Finca Raiz WhatsApp audit API."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import redis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import auth as auth_module
from . import db as db_module
from .config import get_settings
from .routers import (
    advisors,
    competitors,
    errors as errors_router,
    export,
    knowledge_base,
    leads,
    overview,
    product_intel,
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
        log.info("DB pool ready")
    except Exception as e:
        log.error("Failed to init DB pool at startup: %s", e)
    yield
    try:
        db_module.close_pool()
    except Exception:  # pragma: no cover
        pass


app = FastAPI(
    title="Ortiz Finca Raiz - WhatsApp Audit API",
    version="1.0.0",
    lifespan=lifespan,
)

_settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
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
    return HealthResponse(
        status="ok",
        db="ok" if db_module.ping() else "down",
        redis="ok" if _redis_ping() else "down",
    )


@app.get("/", tags=["meta"])
def root() -> dict:
    return {
        "service": "wa_api",
        "client": "Ortiz Finca Raiz",
        "docs": "/docs",
        "health": "/health",
    }
