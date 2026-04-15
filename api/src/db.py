"""Postgres connection pool and query helpers."""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Dict, Iterable, List, Optional, Sequence

import psycopg2
from psycopg2 import pool as pg_pool
from psycopg2.extras import RealDictCursor

from .config import get_settings

log = logging.getLogger(__name__)

_pool: Optional[pg_pool.ThreadedConnectionPool] = None


def init_pool() -> None:
    """Initialize the global connection pool (idempotent)."""
    global _pool
    if _pool is not None:
        return
    s = get_settings()
    _pool = pg_pool.ThreadedConnectionPool(
        minconn=s.db_pool_min,
        maxconn=s.db_pool_max,
        host=s.postgres_host,
        port=s.postgres_port,
        dbname=s.postgres_db,
        user=s.postgres_user,
        password=s.postgres_password,
    )
    log.info("Postgres pool initialized (%s@%s:%s/%s)", s.postgres_user, s.postgres_host, s.postgres_port, s.postgres_db)


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.closeall()
        _pool = None


@contextmanager
def get_conn():
    if _pool is None:
        init_pool()
    assert _pool is not None
    conn = _pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _pool.putconn(conn)


@contextmanager
def get_cursor():
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        try:
            yield cur
        finally:
            cur.close()


def fetch_all(sql: str, params: Optional[Sequence[Any]] = None) -> List[Dict[str, Any]]:
    with get_cursor() as cur:
        cur.execute(sql, params or ())
        return [dict(r) for r in cur.fetchall()]


def fetch_one(sql: str, params: Optional[Sequence[Any]] = None) -> Optional[Dict[str, Any]]:
    with get_cursor() as cur:
        cur.execute(sql, params or ())
        row = cur.fetchone()
        return dict(row) if row else None


def execute(sql: str, params: Optional[Sequence[Any]] = None) -> None:
    with get_cursor() as cur:
        cur.execute(sql, params or ())


def ping() -> bool:
    try:
        with get_cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        return True
    except Exception as e:  # pragma: no cover
        log.warning("DB ping failed: %s", e)
        return False
