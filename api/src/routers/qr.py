"""QR + estado de conexión del extractor.

Endpoints:
  GET  /api/qr                    → admin (JWT). Devuelve QR + status actual.
  POST /api/qr/share              → admin (JWT). Genera token público temporal.
  GET  /api/qr/share              → admin (JWT). Lista tokens activos.
  POST /api/qr/share/{token}/revoke → admin (JWT). Revoca un token.
  GET  /api/qr/public/{token}     → SIN auth. Para que el cliente vea el QR.

Las claves Redis las publica el extractor (extractor/src/status-publisher.js):
  wa:qr, wa:qr_ts, wa:status, wa:status_ts, wa:last_activity, wa:connected_at
"""
from __future__ import annotations

import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..db import execute, fetch_all, fetch_one
from ..redis_client import safe_get

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/qr", tags=["qr"])


# ─── Schemas ────────────────────────────────────────────────
class QRStatusResponse(BaseModel):
    status: str = Field(..., description="connecting|qr_ready|connected|disconnected|reconnecting|unknown")
    qr_data_url: Optional[str] = None
    qr_emitted_at: Optional[str] = None
    connected_at: Optional[str] = None
    last_activity: Optional[str] = None
    status_changed_at: Optional[str] = None
    stats: Optional[dict] = None


class ShareTokenCreate(BaseModel):
    note: Optional[str] = None
    minutes: int = Field(10, ge=1, le=60, description="Vida del token en minutos")


class ShareTokenInfo(BaseModel):
    token: str
    note: Optional[str]
    created_by: str
    created_at: str
    expires_at: str
    used_at: Optional[str]
    revoked_at: Optional[str]
    is_active: bool
    public_url_path: str  # ej. "/escanear/abc123"


# ─── Helpers ────────────────────────────────────────────────
def _read_status() -> QRStatusResponse:
    """Lee todas las claves wa:* de Redis y arma el payload para el panel."""
    status = safe_get("wa:status") or "unknown"
    qr = safe_get("wa:qr")
    qr_ts = safe_get("wa:qr_ts")
    connected_at = safe_get("wa:connected_at")
    last_activity = safe_get("wa:last_activity")
    status_ts = safe_get("wa:status_ts")
    stats_raw = safe_get("wa:stats")
    stats = None
    if stats_raw:
        try:
            stats = json.loads(stats_raw)
        except json.JSONDecodeError:
            stats = None

    # Si Redis no responde (status=unknown) y no hay nada en absoluto,
    # el dashboard puede mostrar "Extractor offline".
    return QRStatusResponse(
        status=status,
        qr_data_url=qr,
        qr_emitted_at=qr_ts,
        connected_at=connected_at,
        last_activity=last_activity,
        status_changed_at=status_ts,
        stats=stats,
    )


def _public_path(token: str) -> str:
    return f"/escanear/{token}"


def _token_row_to_info(row: dict) -> ShareTokenInfo:
    now = datetime.now(timezone.utc)
    expires = row["expires_at"]
    revoked = row.get("revoked_at")
    used = row.get("used_at")
    is_active = (
        revoked is None
        and used is None
        and expires > now
    )
    return ShareTokenInfo(
        token=row["token"],
        note=row.get("note"),
        created_by=row["created_by"],
        created_at=row["created_at"].isoformat() if row["created_at"] else "",
        expires_at=expires.isoformat() if expires else "",
        used_at=used.isoformat() if used else None,
        revoked_at=revoked.isoformat() if revoked else None,
        is_active=is_active,
        public_url_path=_public_path(row["token"]),
    )


# ─── Admin endpoints ────────────────────────────────────────
@router.get("", response_model=QRStatusResponse)
def get_qr_admin(_user: str = Depends(get_current_user)) -> QRStatusResponse:
    """Vista del admin: QR + status del extractor."""
    return _read_status()


@router.post("/share", response_model=ShareTokenInfo)
def create_share_token(
    body: ShareTokenCreate,
    user: str = Depends(get_current_user),
) -> ShareTokenInfo:
    """Genera un link público temporal. Default 10 min, max 60 min."""
    token = secrets.token_urlsafe(24)  # ~32 chars URL-safe
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=body.minutes)
    execute(
        """INSERT INTO qr_share_tokens (token, created_by, note, expires_at)
             VALUES (%s, %s, %s, %s)""",
        [token, user, body.note, expires_at],
    )
    row = fetch_one(
        "SELECT * FROM qr_share_tokens WHERE token = %s",
        [token],
    )
    return _token_row_to_info(row)


@router.get("/share")
def list_share_tokens(
    only_active: bool = Query(False),
    _user: str = Depends(get_current_user),
) -> dict:
    sql = """
        SELECT token, created_by, note, created_at, expires_at, used_at, revoked_at
          FROM qr_share_tokens
    """
    params: list = []
    if only_active:
        sql += " WHERE revoked_at IS NULL AND used_at IS NULL AND expires_at > NOW()"
    sql += " ORDER BY created_at DESC LIMIT 50"
    rows = fetch_all(sql, params)
    items = [_token_row_to_info(r).model_dump() for r in rows]
    return {"items": items}


@router.post("/share/{token}/revoke")
def revoke_share_token(
    token: str,
    _user: str = Depends(get_current_user),
) -> dict:
    affected = execute(
        """UPDATE qr_share_tokens
              SET revoked_at = NOW()
            WHERE token = %s
              AND revoked_at IS NULL""",
        [token],
    )
    if affected == 0:
        raise HTTPException(status_code=404, detail="Token no encontrado o ya revocado")
    return {"ok": True, "revoked": True}


# ─── Endpoint público (sin auth) ────────────────────────────
@router.get("/public/{token}")
def get_qr_public(token: str) -> dict:
    """Vista pública para el cliente. Solo expone el QR + status mínimo.

    Validación: token debe existir, no estar revocado, no estar usado,
    y no estar expirado.
    """
    row = fetch_one(
        """SELECT token, expires_at, used_at, revoked_at, note
             FROM qr_share_tokens
            WHERE token = %s""",
        [token],
    )
    if not row:
        raise HTTPException(status_code=404, detail="Link no válido")
    if row["revoked_at"] is not None:
        raise HTTPException(status_code=410, detail="Link revocado")
    if row["used_at"] is not None:
        raise HTTPException(status_code=410, detail="Link ya utilizado")
    if row["expires_at"] <= datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Link expirado")

    state = _read_status()

    # Si el extractor ya está conectado, marcamos el token como "usado"
    # para invalidarlo automáticamente y devolvemos un mensaje de éxito
    # sin exponer el QR (que ya es viejo).
    if state.status == "connected" and state.connected_at:
        # Heurística: si la conexión es POSTERIOR a la creación del token,
        # probablemente fue ESTE escaneo. Lo marcamos como usado.
        try:
            connected_dt = datetime.fromisoformat(state.connected_at.replace("Z", "+00:00"))
            # row['created_at'] ya viene tz-aware del psycopg2 con TZ
            # Buscamos created_at:
            t2 = fetch_one(
                "SELECT created_at FROM qr_share_tokens WHERE token = %s",
                [token],
            )
            if t2 and connected_dt > t2["created_at"]:
                execute(
                    "UPDATE qr_share_tokens SET used_at = NOW() WHERE token = %s AND used_at IS NULL",
                    [token],
                )
        except Exception as e:
            log.debug("no se pudo marcar token como used: %s", e)

    return {
        "status": state.status,
        "qr_data_url": state.qr_data_url,
        "qr_emitted_at": state.qr_emitted_at,
        "connected_at": state.connected_at,
        "expires_at": row["expires_at"].isoformat(),
        "note": row.get("note"),
    }
