"""Cliente Redis singleton para los routers que leen estado del extractor."""
from __future__ import annotations

import logging
from typing import Optional

import redis

from .config import get_settings

log = logging.getLogger(__name__)

_client: Optional[redis.Redis] = None


def get_redis() -> redis.Redis:
    global _client
    if _client is not None:
        return _client
    s = get_settings()
    _client = redis.Redis(
        host=s.redis_host,
        port=s.redis_port,
        password=s.redis_password,
        decode_responses=True,
        socket_connect_timeout=2,
        socket_timeout=2,
    )
    return _client


def safe_get(key: str) -> Optional[str]:
    try:
        return get_redis().get(key)
    except Exception as e:
        log.debug("redis get %s falló: %s", key, e)
        return None


def safe_set(key: str, value: str, ttl_sec: Optional[int] = None) -> bool:
    try:
        if ttl_sec:
            get_redis().set(key, value, ex=ttl_sec)
        else:
            get_redis().set(key, value)
        return True
    except Exception as e:
        log.debug("redis set %s falló: %s", key, e)
        return False


def safe_del(*keys: str) -> int:
    try:
        return int(get_redis().delete(*keys) or 0)
    except Exception as e:
        log.debug("redis del falló: %s", e)
        return 0
