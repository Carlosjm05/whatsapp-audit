"""Panel: tendencias temporales."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Query

from ..auth import get_current_user
from ..db import fetch_all

router = APIRouter(prefix="/api/trends", tags=["trends"])


@router.get("")
def get_trends(
    from_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    _user: str = Depends(get_current_user),
) -> Dict[str, Any]:
    """Data agregada para gráficos temporales."""
    where = []
    params: list = []
    if from_date:
        where.append("l.first_contact_at >= %s::timestamptz")
        params.append(from_date)
    if to_date:
        where.append("l.first_contact_at <= %s::timestamptz")
        params.append(to_date)
    where_sql = (" AND " + " AND ".join(where)) if where else ""

    # Volumen por mes
    volume = fetch_all(
        f"""SELECT to_char(date_trunc('month', l.first_contact_at), 'YYYY-MM') AS month,
                   COUNT(*)::int AS count
              FROM leads l
             WHERE l.first_contact_at IS NOT NULL{where_sql}
             GROUP BY 1 ORDER BY 1""",
        params,
    )

    # Conversión: cerrados vs total por mes
    conversion = fetch_all(
        f"""SELECT to_char(date_trunc('month', l.first_contact_at), 'YYYY-MM') AS month,
                   COUNT(*)::int AS leads,
                   COUNT(*) FILTER (WHERE co.final_status = 'venta_cerrada')::int AS conversions
              FROM leads l
              LEFT JOIN conversation_outcomes co ON co.lead_id = l.id
             WHERE l.first_contact_at IS NOT NULL{where_sql}
             GROUP BY 1 ORDER BY 1""",
        params,
    )

    # Intent score promedio por mes
    intent = fetch_all(
        f"""SELECT to_char(date_trunc('month', l.first_contact_at), 'YYYY-MM') AS month,
                   ROUND(AVG(li.intent_score)::numeric, 2)::float AS score
              FROM leads l
              JOIN lead_intent li ON li.lead_id = l.id
             WHERE l.first_contact_at IS NOT NULL AND li.intent_score IS NOT NULL{where_sql}
             GROUP BY 1 ORDER BY 1""",
        params,
    )

    # Advisor score promedio por mes
    advisor = fetch_all(
        f"""SELECT to_char(date_trunc('month', l.first_contact_at), 'YYYY-MM') AS month,
                   ROUND(AVG(asc_.overall_score)::numeric, 2)::float AS score
              FROM leads l
              JOIN advisor_scores asc_ ON asc_.lead_id = l.id
             WHERE l.first_contact_at IS NOT NULL AND asc_.overall_score IS NOT NULL{where_sql}
             GROUP BY 1 ORDER BY 1""",
        params,
    )

    # Heatmap día/hora
    heatmap = fetch_all(
        f"""SELECT EXTRACT(DOW FROM l.first_contact_at)::int AS dow,
                   EXTRACT(HOUR FROM l.first_contact_at)::int AS hour,
                   COUNT(*)::int AS count
              FROM leads l
             WHERE l.first_contact_at IS NOT NULL{where_sql}
             GROUP BY 1, 2 ORDER BY 1, 2""",
        params,
    )

    # Producto por mes
    product = fetch_all(
        f"""SELECT to_char(date_trunc('month', l.first_contact_at), 'YYYY-MM') AS month,
                   lin.product_type AS product,
                   COUNT(*)::int AS count
              FROM leads l
              JOIN lead_interests lin ON lin.lead_id = l.id
             WHERE l.first_contact_at IS NOT NULL AND lin.product_type IS NOT NULL{where_sql}
             GROUP BY 1, 2 ORDER BY 1, 2""",
        params,
    )

    # Razones de pérdida por mes
    loss = fetch_all(
        f"""SELECT to_char(date_trunc('month', l.first_contact_at), 'YYYY-MM') AS month,
                   co.loss_reason AS reason,
                   COUNT(*)::int AS count
              FROM leads l
              JOIN conversation_outcomes co ON co.lead_id = l.id
             WHERE l.first_contact_at IS NOT NULL AND co.loss_reason IS NOT NULL{where_sql}
             GROUP BY 1, 2 ORDER BY 1, 3 DESC""",
        params,
    )

    # Tiempo de respuesta promedio por mes
    rt = fetch_all(
        f"""SELECT to_char(date_trunc('month', l.first_contact_at), 'YYYY-MM') AS month,
                   ROUND(AVG(rt.first_response_minutes)::numeric, 1)::float AS avg_min
              FROM leads l
              JOIN response_times rt ON rt.lead_id = l.id
             WHERE l.first_contact_at IS NOT NULL AND rt.first_response_minutes IS NOT NULL{where_sql}
             GROUP BY 1 ORDER BY 1""",
        params,
    )

    return {
        "volumeByMonth": volume,
        "conversionByMonth": conversion,
        "intentScoreByMonth": intent,
        "advisorScoreByMonth": advisor,
        "hourDayHeatmap": heatmap,
        "productByMonth": product,
        "lossReasonsByMonth": loss,
        "responseTimeByMonth": rt,
    }
