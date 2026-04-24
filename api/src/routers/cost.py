"""Endpoint de costos agregados.

Suma de:
  - transcripciones (Whisper):  transcriptions.cost_usd
  - análisis (Claude):          lead_analysis_history.cost_usd

Buckets: hoy, semana actual, mes actual, total all-time.
También un breakdown por día (últimos 30 días) para el chart del overview.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query

from ..auth import get_current_user
from ..db import fetch_all, fetch_one

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cost", tags=["cost"])


def _safe_float(v) -> float:
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


@router.get("/summary")
def cost_summary(_user: str = Depends(get_current_user)) -> dict:
    """Totales gastados por bucket temporal, separados por servicio.

    Importante: hoy/semana/mes se calculan en zona horaria de Colombia
    (America/Bogota) — la DB corre en UTC. Sin la conversión, "hoy"
    terminaba a las 19:00 hora Colombia y los gastos de la noche caían
    al día siguiente."""
    # Convertir TIMESTAMPTZ → timestamp local Colombia, después comparar
    # contra CURRENT_DATE en la misma timezone.
    sql = """
    WITH whisper AS (
      SELECT
        SUM(cost_usd) FILTER (WHERE (processed_at AT TIME ZONE 'America/Bogota')::date
                                  = (NOW() AT TIME ZONE 'America/Bogota')::date)                    AS hoy,
        SUM(cost_usd) FILTER (WHERE (processed_at AT TIME ZONE 'America/Bogota')
                                  >= date_trunc('week',  (NOW() AT TIME ZONE 'America/Bogota')))    AS semana,
        SUM(cost_usd) FILTER (WHERE (processed_at AT TIME ZONE 'America/Bogota')
                                  >= date_trunc('month', (NOW() AT TIME ZONE 'America/Bogota')))    AS mes,
        SUM(cost_usd)                                                                                 AS total
      FROM transcriptions
     WHERE status = 'completed'
    ),
    claude AS (
      SELECT
        SUM(cost_usd) FILTER (WHERE (completed_at AT TIME ZONE 'America/Bogota')::date
                                  = (NOW() AT TIME ZONE 'America/Bogota')::date)                    AS hoy,
        SUM(cost_usd) FILTER (WHERE (completed_at AT TIME ZONE 'America/Bogota')
                                  >= date_trunc('week',  (NOW() AT TIME ZONE 'America/Bogota')))    AS semana,
        SUM(cost_usd) FILTER (WHERE (completed_at AT TIME ZONE 'America/Bogota')
                                  >= date_trunc('month', (NOW() AT TIME ZONE 'America/Bogota')))    AS mes,
        SUM(cost_usd)                                                                                 AS total
      FROM lead_analysis_history
     WHERE status = 'completed'
    )
    SELECT
      (SELECT hoy    FROM whisper) AS whisper_hoy,
      (SELECT semana FROM whisper) AS whisper_semana,
      (SELECT mes    FROM whisper) AS whisper_mes,
      (SELECT total  FROM whisper) AS whisper_total,
      (SELECT hoy    FROM claude)  AS claude_hoy,
      (SELECT semana FROM claude)  AS claude_semana,
      (SELECT mes    FROM claude)  AS claude_mes,
      (SELECT total  FROM claude)  AS claude_total
    """
    row = fetch_one(sql) or {}
    w_hoy = _safe_float(row.get("whisper_hoy"))
    c_hoy = _safe_float(row.get("claude_hoy"))
    w_sem = _safe_float(row.get("whisper_semana"))
    c_sem = _safe_float(row.get("claude_semana"))
    w_mes = _safe_float(row.get("whisper_mes"))
    c_mes = _safe_float(row.get("claude_mes"))
    w_tot = _safe_float(row.get("whisper_total"))
    c_tot = _safe_float(row.get("claude_total"))
    return {
        "hoy":     {"whisper": w_hoy, "claude": c_hoy, "total": w_hoy + c_hoy},
        "semana":  {"whisper": w_sem, "claude": c_sem, "total": w_sem + c_sem},
        "mes":     {"whisper": w_mes, "claude": c_mes, "total": w_mes + c_mes},
        "total":   {"whisper": w_tot, "claude": c_tot, "total": w_tot + c_tot},
    }


@router.get("/daily")
def cost_daily(
    days: int = Query(30, ge=1, le=180),
    _user: str = Depends(get_current_user),
) -> dict:
    """Serie diaria de costos (whisper + claude) para chart."""
    sql = """
    WITH whisper AS (
      SELECT (processed_at AT TIME ZONE 'America/Bogota')::date AS day,
             SUM(cost_usd) AS amount
        FROM transcriptions
       WHERE status = 'completed'
         AND (processed_at AT TIME ZONE 'America/Bogota')::date
             >= (NOW() AT TIME ZONE 'America/Bogota')::date - (%s::int - 1)
       GROUP BY 1
    ),
    claude AS (
      SELECT (completed_at AT TIME ZONE 'America/Bogota')::date AS day,
             SUM(cost_usd) AS amount
        FROM lead_analysis_history
       WHERE status = 'completed'
         AND (completed_at AT TIME ZONE 'America/Bogota')::date
             >= (NOW() AT TIME ZONE 'America/Bogota')::date - (%s::int - 1)
       GROUP BY 1
    ),
    days AS (
      SELECT generate_series(
               (NOW() AT TIME ZONE 'America/Bogota')::date - (%s::int - 1),
               (NOW() AT TIME ZONE 'America/Bogota')::date,
               '1 day'::interval
             )::date AS day
    )
    SELECT
      d.day,
      COALESCE(w.amount, 0)::float AS whisper,
      COALESCE(c.amount, 0)::float AS claude,
      (COALESCE(w.amount, 0) + COALESCE(c.amount, 0))::float AS total
      FROM days d
      LEFT JOIN whisper w ON w.day = d.day
      LEFT JOIN claude  c ON c.day = d.day
     ORDER BY d.day
    """
    rows = fetch_all(sql, [days, days, days])
    return {
        "days": days,
        "series": [
            {
                "day": r["day"].isoformat() if r.get("day") else None,
                "whisper": r["whisper"],
                "claude": r["claude"],
                "total": r["total"],
            }
            for r in rows
        ],
    }
