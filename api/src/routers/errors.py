"""Panel 5: Error and response-time diagnostics."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..db import fetch_all, fetch_one
from ..schemas import ErrorsResponse

router = APIRouter(prefix="/api/errors", tags=["errors"])


@router.get("", response_model=ErrorsResponse)
def errors_overview(_user: str = Depends(get_current_user)) -> ErrorsResponse:
    # Normalización de errores: agrupa variantes textuales del mismo problema
    # (ej. "no propuso visita ni acción", "no propuso visita en ningún momento",
    # "no propuso visita al proyecto" → "No propuso visita"). Hecho con regex
    # en SQL para no requerir tabla auxiliar.
    top_errors = fetch_all(
        """
        WITH errores_brutos AS (
          SELECT lower(err) AS err
            FROM advisor_scores, LATERAL unnest(COALESCE(errors_list, ARRAY[]::text[])) AS err
           WHERE err IS NOT NULL AND err <> ''
        ),
        normalizados AS (
          SELECT
            CASE
              WHEN err ~ '(no.{0,3}propuso.{0,3}visita|sin proponer visita|no.{0,3}intent.{0,3}cerr.{0,5}venta|no.{0,3}intent.{0,3}cerr.{0,5}conversaci)'
                THEN 'No propuso visita ni intentó cerrar'
              WHEN err ~ '(no.{0,3}calific|no preguntó.{0,5}(presupuesto|ciudad|propósito|urgencia)|sin calificar.{0,3}lead|nunca preguntó)'
                THEN 'No calificó al lead (faltó preguntar lo básico)'
              WHEN err ~ '(mensaj.{0,3}gen[eé]ric|usó.{0,3}plantilla|sin personalizar|copy.?paste)'
                THEN 'Usó mensajes genéricos / plantilla sin personalizar'
              WHEN err ~ '(respondi[óo].{0,5}tarde|tard[óo].{0,3}responder|fuera de SLA|>5 ?min|sla.{0,3}5)'
                THEN 'Respondió tarde (violó SLA 5 min)'
              WHEN err ~ '(no env[ií]o?.{0,5}info|sin información del proyecto|no.{0,3}compart[ií]o?.{0,5}precio|info incompleta)'
                THEN 'No envió información del proyecto / precios'
              WHEN err ~ '(no.{0,3}(seguimiento|follow.?up)|sin seguimiento|dej[óo] colgado|abandon[óo]?.{0,3}lead)'
                THEN 'Sin seguimiento / dejó colgado'
              WHEN err ~ '(prometi[óo].{0,3}consult|no volvi[óo].{0,3}respuesta|no.{0,3}consult[óo].{0,3}vuelta)'
                THEN 'Prometió consultar y no volvió'
              WHEN err ~ '(no.{0,3}(resolvi[óo]|atendi[óo]|respondi[óo]).{0,3}objec)'
                THEN 'No resolvió objeción del lead'
              WHEN err ~ '(discovery.{0,3}tard|preguntó.{0,3}presupuesto.{0,5}despu)'
                THEN 'Discovery tardío (preguntó presupuesto después de info)'
              ELSE substring(initcap(err) from 1 for 100)
            END AS error_text
          FROM errores_brutos
        )
        SELECT error_text, COUNT(*)::int AS count
          FROM normalizados
         GROUP BY error_text
         ORDER BY count DESC
         LIMIT 15
        """
    )

    # Asesores con más errores. COALESCE(advisor_name, 'General') agrupa
    # los chats donde el analyzer NO pudo identificar al asesor por firma.
    advisors_with_most_errors = fetch_all(
        """
        SELECT COALESCE(NULLIF(advisor_name, ''), 'General') AS advisor_name,
               SUM(COALESCE(array_length(errors_list, 1), 0))::int AS total_errors,
               COUNT(*)::int AS total_leads,
               AVG(overall_score)::float AS avg_overall_score
          FROM advisor_scores
         GROUP BY 1
         ORDER BY total_errors DESC
         LIMIT 15
        """
    )

    # Tiempos de respuesta calculados con HORARIO LABORAL (Lun-Sáb 7-19).
    # FILTRADO ANTI-OUTLIER: leads donde el primer response > 480 min (8h)
    # son chats donde el asesor NUNCA respondió o respondió días/semanas
    # después. Esos distorsionan el promedio. Los excluimos del avg pero
    # los reportamos como "leads sin respuesta efectiva".
    # Mediana (p50) es más robusta y se reporta como métrica principal.
    rt_stats_row = fetch_one(
        """
        SELECT
          -- Mediana (más robusta a outliers) — métrica principal.
          percentile_cont(0.5) WITHIN GROUP (ORDER BY first_response_minutes)::float
              AS p50_first_response_minutes,
          -- Promedio EXCLUYENDO outliers (>8h) — más realista.
          AVG(first_response_minutes) FILTER (WHERE first_response_minutes <= 480)::float
              AS avg_first_response_minutes,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY first_response_minutes)::float
              AS p95_first_response_minutes,
          -- Conteos para contexto.
          COUNT(*) FILTER (WHERE first_response_minutes <= 480)::int
              AS leads_con_respuesta_efectiva,
          COUNT(*) FILTER (WHERE first_response_minutes > 480)::int
              AS leads_sin_respuesta_efectiva,
          -- Otros tiempos (excluyendo outliers también).
          AVG(avg_response_minutes) FILTER (WHERE avg_response_minutes <= 480)::float
              AS avg_response_minutes,
          AVG(longest_gap_hours) FILTER (WHERE longest_gap_hours <= 48)::float
              AS avg_longest_gap_hours,
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
