"""Panel 1: Overview dashboard endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..db import fetch_all, fetch_one
from ..schemas import FunnelCounts, OverviewResponse

router = APIRouter(prefix="/api", tags=["overview"])


@router.get("/overview", response_model=OverviewResponse)
def get_overview(_user: str = Depends(get_current_user)) -> OverviewResponse:
    total_conversations_row = fetch_one("SELECT COUNT(*)::int AS c FROM raw_conversations")
    total_conversations = int(total_conversations_row["c"]) if total_conversations_row else 0

    total_leads_row = fetch_one("SELECT COUNT(*)::int AS c FROM leads")
    total_leads = int(total_leads_row["c"]) if total_leads_row else 0

    # Funnel:
    #   contactado = todos los leads
    #   calificado = leads con intent_score >= 5 (escala 1-10) — presupuesto,
    #                propósito y urgencia suficientes para avanzar
    #   visita     = outcomes.final_status en visita_agendada/venta_cerrada/cliente_existente
    #   venta      = outcomes.final_status en venta_cerrada/cliente_existente
    # cliente_existente = ya compró y sigue en postventa; cuenta como venta consumada
    # (mismo criterio que en /leads/recoverable y /search para excluirlos del pool).
    funnel_row = fetch_one(
        """
        SELECT
          (SELECT COUNT(*)::int FROM leads) AS contactado,
          (SELECT COUNT(*)::int
             FROM lead_intent li
            WHERE li.intent_score IS NOT NULL AND li.intent_score >= 5) AS calificado,
          (SELECT COUNT(*)::int
             FROM conversation_outcomes co
            WHERE co.final_status IN ('visita_agendada','venta_cerrada','cliente_existente')) AS visita,
          (SELECT COUNT(*)::int
             FROM conversation_outcomes co
            WHERE co.final_status IN ('venta_cerrada','cliente_existente')) AS venta
        """
    ) or {}
    funnel = FunnelCounts(
        contactado=int(funnel_row.get("contactado") or 0),
        calificado=int(funnel_row.get("calificado") or 0),
        visita=int(funnel_row.get("visita") or 0),
        venta=int(funnel_row.get("venta") or 0),
    )

    status_distribution = fetch_all(
        """
        SELECT COALESCE(final_status, 'unknown') AS final_status, COUNT(*)::int AS count
          FROM conversation_outcomes
         GROUP BY final_status
         ORDER BY count DESC
        """
    )

    monthly_volume = fetch_all(
        """
        SELECT to_char(date_trunc('month', first_contact_at), 'YYYY-MM') AS month,
               COUNT(*)::int AS count
          FROM leads
         WHERE first_contact_at IS NOT NULL
         GROUP BY 1
         ORDER BY 1
        """
    )

    rec_row = fetch_one(
        """
        SELECT COUNT(*)::int AS cnt,
               COALESCE(SUM(lf.budget_estimated_cop), 0)::bigint AS total_value
          FROM conversation_outcomes co
          LEFT JOIN lead_financials lf ON lf.lead_id = co.lead_id
         WHERE co.is_recoverable = TRUE
        """
    ) or {}
    recoverable_count = int(rec_row.get("cnt") or 0)
    total_recoverable_estimated_value = int(rec_row.get("total_value") or 0)

    avg_intent_row = fetch_one("SELECT AVG(intent_score)::float AS v FROM lead_intent WHERE intent_score IS NOT NULL")
    avg_advisor_row = fetch_one("SELECT AVG(overall_score)::float AS v FROM advisor_scores WHERE overall_score IS NOT NULL")

    # Estado del análisis IA (cuántos leads ya pasaron por Claude vs pendientes).
    analysis_status_row = fetch_one(
        """
        SELECT
          COUNT(*) FILTER (WHERE analysis_status = 'completed')::int          AS analyzed,
          COUNT(*) FILTER (WHERE analysis_status = 'pending')::int            AS pending,
          COUNT(*) FILTER (WHERE analysis_status = 'processing')::int         AS processing,
          COUNT(*) FILTER (WHERE analysis_status = 'failed')::int             AS failed,
          COUNT(*) FILTER (WHERE analysis_status = 'insufficient_data')::int  AS insufficient
          FROM leads
        """
    ) or {}

    return OverviewResponse(
        total_conversations=total_conversations,
        total_leads=total_leads,
        funnel=funnel,
        status_distribution=status_distribution,
        monthly_volume=monthly_volume,
        recoverable_count=recoverable_count,
        total_recoverable_estimated_value=total_recoverable_estimated_value,
        avg_intent_score=(avg_intent_row["v"] if avg_intent_row else None),
        avg_advisor_score=(avg_advisor_row["v"] if avg_advisor_row else None),
        analyzed_count=int(analysis_status_row.get("analyzed") or 0),
        pending_count=int(analysis_status_row.get("pending") or 0),
        processing_count=int(analysis_status_row.get("processing") or 0),
        failed_count=int(analysis_status_row.get("failed") or 0),
        insufficient_count=int(analysis_status_row.get("insufficient") or 0),
    )
