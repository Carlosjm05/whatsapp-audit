"""Endpoints meta del sistema (status del extractor para el sidebar).

Separado del router /api/qr porque /api/system/status lo usa el sidebar
en TODA la app y queremos evitar que el polling del sidebar pague el
costo de leer el QR completo (data URL grande).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..redis_client import safe_get


router = APIRouter(prefix="/api/system", tags=["system"])


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _seconds_since(s: Optional[str]) -> Optional[int]:
    dt = _parse_iso(s)
    if dt is None:
        return None
    delta = datetime.now(timezone.utc) - dt
    return max(0, int(delta.total_seconds()))


@router.get("/status")
def extractor_status(_user: str = Depends(get_current_user)) -> dict:
    """Status liviano del extractor para el indicador del sidebar.

    Devuelve solo metadatos (sin QR data URL, que pesa). Para ver el
    QR usar /api/qr.
    """
    status = safe_get("wa:status") or "unknown"
    last_activity = safe_get("wa:last_activity")
    status_ts = safe_get("wa:status_ts")
    connected_at = safe_get("wa:connected_at")

    secs_since_activity = _seconds_since(last_activity)
    secs_since_status_change = _seconds_since(status_ts)

    # Heurística: si Redis no responde O el último heartbeat fue hace
    # >10 min, asumimos extractor caído. No alarmamos por algo <5min
    # porque el extractor está procesando un chat largo y no le da tiempo
    # a pulsar.
    is_healthy = (
        status == "connected"
        and secs_since_activity is not None
        and secs_since_activity < 600
    )

    # Color para el sidebar
    if status == "connected" and is_healthy:
        light = "green"
    elif status == "connected":
        light = "yellow"  # conectado pero sin actividad reciente
    elif status in ("connecting", "reconnecting", "qr_ready"):
        light = "yellow"
    else:
        light = "red"

    return {
        "status": status,
        "light": light,
        "is_healthy": is_healthy,
        "last_activity_at": last_activity,
        "last_activity_secs_ago": secs_since_activity,
        "status_changed_at": status_ts,
        "status_changed_secs_ago": secs_since_status_change,
        "connected_at": connected_at,
    }
