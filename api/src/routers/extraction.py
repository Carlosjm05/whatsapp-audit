"""Endpoints del workflow de indexado y extracción por lotes.

Diseño:
- El extractor corre en modo daemon escuchando la cola Redis `wa:jobs`.
- El dashboard publica jobs vía POST /api/extraction/jobs.
- El daemon ejecuta uno a uno, escribe el job en `wa:job:current` y
  el resultado en `wa:job:history`.
- El dashboard polea GET /api/extraction/state cada N segundos para
  mostrar progreso.

Acciones del job:
  - "preview": no abre WhatsApp, solo lee DB y publica.
  - "index":   abre WhatsApp (QR si hace falta), guarda metadatos.
  - "extract": abre WhatsApp + procesa próximos N chats indexados.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..db import fetch_all, fetch_one
from ..redis_client import get_redis, safe_get


router = APIRouter(prefix="/api/extraction", tags=["extraction"])


JOBS_QUEUE_KEY = "wa:jobs"
CURRENT_JOB_KEY = "wa:job:current"
JOB_HISTORY_KEY = "wa:job:history"


# ─── MODELOS ─────────────────────────────────────────────────

class JobRequest(BaseModel):
    action: str = Field(..., description="preview | index | extract")
    batch: Optional[int] = Field(None, ge=1, le=10000)
    # Filtro opcional para action='extract': solo procesa chats con
    # last_message_at <= before (hora Bogotá inclusive). Formato YYYY-MM-DD.
    before: Optional[str] = Field(
        None,
        description="YYYY-MM-DD — extract solo chats hasta esa fecha (Bogotá)",
        pattern=r"^\d{4}-\d{2}-\d{2}$",
    )


class ExtractionState(BaseModel):
    total_chats: int
    indexado_pendientes: int
    extracted_total: int
    failed_total: int
    next_priority: Optional[int]
    max_priority: Optional[int]
    histogram: List[dict]
    current_job: Optional[dict]
    last_jobs: List[dict]
    extractor_status: Optional[str]
    extractor_last_activity: Optional[str]


# ─── HELPERS ─────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_json_safe(s: Optional[str]) -> Optional[dict]:
    if not s:
        return None
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return None


# ─── ENDPOINTS ───────────────────────────────────────────────

@router.get("/state", response_model=ExtractionState)
def get_extraction_state(_user: str = Depends(get_current_user)) -> ExtractionState:
    """Estado completo del workflow de extracción para el panel /extraccion.

    Combina:
      - Conteos por estado (DB).
      - Frontera de procesamiento (DB).
      - Histograma por mes (DB).
      - Job actual y últimos 20 (Redis).
      - Status del extractor daemon (Redis).
    """
    counts = fetch_one("""
        SELECT
            COUNT(*)::int                                                AS total,
            COUNT(*) FILTER (WHERE extraction_status = 'indexado')::int  AS indexado,
            COUNT(*) FILTER (WHERE extraction_status = 'extracted')::int AS extracted,
            COUNT(*) FILTER (WHERE extraction_status = 'failed')::int    AS failed
          FROM raw_conversations
    """) or {}

    frontier = fetch_one("""
        SELECT MAX(extract_priority) AS max_priority,
               MIN(extract_priority) FILTER (WHERE extraction_status = 'indexado') AS next_priority
          FROM raw_conversations
         WHERE extract_priority IS NOT NULL
    """) or {}

    histogram = fetch_all("""
        SELECT to_char(date_trunc('month', last_message_at), 'YYYY-MM') AS mes,
               COUNT(*)::int                                                  AS total,
               COUNT(*) FILTER (WHERE extraction_status = 'indexado')::int   AS indexado,
               COUNT(*) FILTER (WHERE extraction_status = 'extracted')::int  AS extracted,
               COUNT(*) FILTER (WHERE extraction_status = 'failed')::int     AS failed
          FROM raw_conversations
         WHERE last_message_at IS NOT NULL
         GROUP BY 1
         ORDER BY 1 DESC
    """)

    # Estado de jobs desde Redis.
    current_job_raw = safe_get(CURRENT_JOB_KEY)
    current_job = _parse_json_safe(current_job_raw)

    last_jobs: List[dict] = []
    try:
        r = get_redis()
        rows = r.lrange(JOB_HISTORY_KEY, 0, 19)
        for raw in rows:
            j = _parse_json_safe(raw)
            if j:
                last_jobs.append(j)
    except Exception:
        pass

    extractor_status = safe_get("wa:status")
    extractor_last_activity = safe_get("wa:last_activity")

    return ExtractionState(
        total_chats=int(counts.get("total") or 0),
        indexado_pendientes=int(counts.get("indexado") or 0),
        extracted_total=int(counts.get("extracted") or 0),
        failed_total=int(counts.get("failed") or 0),
        next_priority=frontier.get("next_priority"),
        max_priority=frontier.get("max_priority"),
        histogram=list(histogram),
        current_job=current_job,
        last_jobs=last_jobs,
        extractor_status=extractor_status,
        extractor_last_activity=extractor_last_activity,
    )


@router.post("/jobs")
def enqueue_job(
    body: JobRequest,
    user: str = Depends(get_current_user),
) -> dict:
    """Encola un job para que el daemon del extractor lo procese.

    Validaciones:
      - action ∈ {preview, index, extract}.
      - extract requiere batch entre 1 y 10000.
      - No se permite encolar si ya hay un job corriendo (evita conflictos
        con la sesión WhatsApp). Devuelve 409 si hay current_job.
    """
    action = (body.action or "").strip().lower()
    if action not in {"preview", "index", "extract"}:
        raise HTTPException(status_code=400, detail=f"Acción inválida: {action}")
    if action == "extract" and (not body.batch or body.batch <= 0):
        raise HTTPException(
            status_code=400,
            detail="action=extract requiere `batch` > 0",
        )

    # No permitir job nuevo si hay uno corriendo (Baileys no soporta dos
    # sockets sobre el mismo creds simultáneamente).
    current = _parse_json_safe(safe_get(CURRENT_JOB_KEY))
    if current and current.get("status") == "running":
        raise HTTPException(
            status_code=409,
            detail=f"Ya hay un job en ejecución: {current.get('action')} (id={current.get('id')})",
        )

    job = {
        "id": str(uuid.uuid4()),
        "action": action,
        "batch": body.batch,
        "before": body.before,
        "requested_by": user,
        "requested_at": _now_iso(),
    }

    try:
        r = get_redis()
        r.lpush(JOBS_QUEUE_KEY, json.dumps(job))
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"No se pudo encolar el job: {e}")

    return {"ok": True, "job": job}


@router.get("/jobs")
def list_jobs(_user: str = Depends(get_current_user)) -> dict:
    """Cola actual + último job en proceso."""
    queue: List[dict] = []
    try:
        r = get_redis()
        rows = r.lrange(JOBS_QUEUE_KEY, 0, -1)
        for raw in rows:
            j = _parse_json_safe(raw)
            if j:
                queue.append(j)
    except Exception:
        pass

    return {
        "current": _parse_json_safe(safe_get(CURRENT_JOB_KEY)),
        "queue": queue,
    }


@router.delete("/jobs/queue")
def clear_queue(_user: str = Depends(get_current_user)) -> dict:
    """Vacía la cola de jobs PENDIENTES (no afecta el job actualmente
    en ejecución). Útil si Carlos encoló por error."""
    try:
        r = get_redis()
        n = r.delete(JOBS_QUEUE_KEY)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"No se pudo vaciar cola: {e}")
    return {"ok": True, "removed_keys": int(n or 0)}


@router.delete("/jobs/current")
def clear_current_job(_user: str = Depends(get_current_user)) -> dict:
    """Borra `wa:job:current` SIN cancelar nada en el daemon.

    Úsese cuando un job quedó marcado como 'running' tras un crash del
    daemon — bloquea el endpoint POST /jobs por hasta 2h (TTL). Borrar
    esta key permite encolar nuevamente. NO interrumpe procesos reales.
    El daemon en su próximo arranque también limpia automáticamente.
    """
    try:
        r = get_redis()
        n = r.delete(CURRENT_JOB_KEY)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"No se pudo borrar job actual: {e}")
    return {"ok": True, "cleared": int(n or 0) > 0}
