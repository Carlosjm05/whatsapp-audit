"""Panel 5: Error and response-time diagnostics."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..db import fetch_all, fetch_one
from ..schemas import ErrorsResponse

router = APIRouter(prefix="/api/errors", tags=["errors"])


@router.get("", response_model=ErrorsResponse)
def errors_overview(_user: str = Depends(get_current_user)) -> ErrorsResponse:
    top_errors = fetch_all(
        """
        SELECT err AS error_text, COUNT(*)::int AS count
          FROM advisor_scores, LATERAL unnest(COALESCE(errors_list, ARRAY[]::text[])) AS err
         WHERE err IS NOT NULL AND err <> ''
         GROUP BY err
         ORDER BY count DESC
         LIMIT 25
        """
    )

    advisors_with_most_errors = fetch_all(
        """
        SELECT advisor_name,
               SUM(COALESCE(array_length(errors_list, 1), 0))::int AS total_errors,
               COUNT(*)::int AS total_leads,
               AVG(overall_score)::float AS avg_overall_score
          FROM advisor_scores
         WHERE advisor_name IS NOT NULL AND advisor_name <> ''
         GROUP BY advisor_name
         ORDER BY total_errors DESC
         LIMIT 15
        """
    )

    # Tiempos de respuesta calculados con HORARIO LABORAL de Óscar
    # (Lun-Sáb 7-19). Domingos se reportan en métrica separada `sunday_*`
    # para no inflar los KPIs principales.
    rt_stats_row = fetch_one(
        """
        SELECT
          AVG(first_response_minutes)::float AS avg_first_response_minutes,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY first_response_minutes)::float AS p50_first_response_minutes,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY first_response_minutes)::float AS p95_first_response_minutes,
          AVG(avg_response_minutes)::float AS avg_response_minutes,
          AVG(longest_gap_hours)::float AS avg_longest_gap_hours,
          -- Métricas de domingo (separadas, no entran al SLA).
          AVG(NULLIF(sunday_avg_minutes, 0))::float AS sunday_avg_minutes,
          SUM(COALESCE(sunday_response_count, 0))::int AS sunday_total_responses,
          COUNT(*) FILTER (WHERE sunday_response_count > 0)::int AS leads_with_sunday_activity
        FROM response_times
        WHERE first_response_minutes IS NOT NULL
        """
    ) or {}

    followup_row = fetch_one(
        """
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE did_followup = FALSE)::int AS no_followup
        FROM conversation_metrics
        """
    ) or {}
    total = int(followup_row.get("total") or 0)
    no_fu = int(followup_row.get("no_followup") or 0)
    pct_no_fu = (no_fu / total * 100.0) if total > 0 else None

    return ErrorsResponse(
        top_errors=top_errors,
        advisors_with_most_errors=advisors_with_most_errors,
        response_time_stats=rt_stats_row,
        pct_without_followup=pct_no_fu,
    )
