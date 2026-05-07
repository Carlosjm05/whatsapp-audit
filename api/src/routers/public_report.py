"""Informe público de errores — endpoint sin login.

Pensado para que Oscar (cliente) comparta el link en reuniones con el
equipo. NUNCA expone datos por asesor (sin advisor_name, sin teléfono,
sin nombre de lead): solo agregados. Si llegan a filtrar el link, lo
peor que pasa es que alguien ve estadísticas anónimas.

Protección: token simple en query string (`?k=<token>`) validado por
`share_tokens.validate_public_token`. Esa función:
  1. Hashea el token recibido y lo busca en `public_report_tokens`
     (gestionados desde el panel admin /enlaces).
  2. Si no encuentra match, cae al `PUBLIC_REPORT_TOKEN` del .env
     (compatibilidad con setups viejos).
  3. Si tampoco coincide, devolvemos 404 — sin filtrar si el endpoint
     existe.
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Query

from ..db import fetch_all, fetch_one
from .share_tokens import validate_public_token

router = APIRouter(prefix="/api/public", tags=["public"])


def _check_token(token: str) -> None:
    """Valida o tira 404. Acepta tokens generados desde el panel admin
    o (legacy) el de `PUBLIC_REPORT_TOKEN` del .env."""
    if not validate_public_token(token):
        raise HTTPException(status_code=404, detail="Not found")


@router.get("/report")
def public_report(
    k: str = Query("", description="Token público"),
    raw_limit: int = Query(2000, ge=0, le=10000, description="Tope de errores raw a devolver"),
) -> Dict[str, Any]:
    """Devuelve TODO lo medible sobre errores del equipo, en agregado."""
    _check_token(k)

    # ── 1. Resumen general ──────────────────────────────────────
    summary = fetch_one(
        """
        SELECT
          (SELECT COUNT(*)::int FROM advisor_scores) AS leads_analyzed,
          (SELECT MIN(first_contact_at) FROM leads) AS period_start,
          (SELECT MAX(first_contact_at) FROM leads) AS period_end,
          (SELECT AVG(overall_score)::float FROM advisor_scores
            WHERE overall_score IS NOT NULL) AS avg_overall_score,
          (SELECT SUM(COALESCE(array_length(errors_list, 1), 0))::int
             FROM advisor_scores) AS total_errors,
          (SELECT COUNT(*)::int FROM advisor_scores
            WHERE COALESCE(array_length(errors_list, 1), 0) > 0) AS leads_with_errors
        """
    ) or {}

    leads_analyzed = int(summary.get("leads_analyzed") or 0)
    total_errors = int(summary.get("total_errors") or 0)
    leads_with_errors = int(summary.get("leads_with_errors") or 0)
    summary["pct_leads_with_errors"] = (
        (leads_with_errors / leads_analyzed * 100.0) if leads_analyzed > 0 else None
    )
    summary["errors_per_lead"] = (
        (total_errors / leads_analyzed) if leads_analyzed > 0 else None
    )

    # ── 2. Tiempos de respuesta (mismo cálculo que /api/errors) ─
    rt_stats = fetch_one(
        """
        SELECT
          percentile_cont(0.5) WITHIN GROUP (ORDER BY first_response_minutes)::float
              AS p50_first_response_minutes,
          AVG(first_response_minutes) FILTER (WHERE first_response_minutes <= 480)::float
              AS avg_first_response_minutes,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY first_response_minutes)::float
              AS p95_first_response_minutes,
          COUNT(*) FILTER (WHERE first_response_minutes <= 480)::int
              AS leads_con_respuesta_efectiva,
          COUNT(*) FILTER (WHERE first_response_minutes > 480)::int
              AS leads_sin_respuesta_efectiva,
          AVG(avg_response_minutes) FILTER (WHERE avg_response_minutes <= 480)::float
              AS avg_response_minutes,
          AVG(longest_gap_hours) FILTER (WHERE longest_gap_hours <= 48)::float
              AS avg_longest_gap_hours,
          AVG(NULLIF(sunday_avg_minutes, 0))::float AS sunday_avg_minutes,
          SUM(COALESCE(sunday_response_count, 0))::int AS sunday_total_responses,
          COUNT(*) FILTER (WHERE sunday_response_count > 0)::int AS leads_with_sunday_activity
        FROM response_times
        WHERE first_response_minutes IS NOT NULL
        """
    ) or {}

    # ── 3. Categorías de tiempo (excelente/bueno/.../critico) ───
    rt_categories = fetch_all(
        """
        SELECT response_time_category AS category, COUNT(*)::int AS count
          FROM response_times
         WHERE response_time_category IS NOT NULL
         GROUP BY 1
         ORDER BY CASE response_time_category
                    WHEN 'excelente' THEN 1
                    WHEN 'bueno'     THEN 2
                    WHEN 'regular'   THEN 3
                    WHEN 'malo'      THEN 4
                    WHEN 'critico'   THEN 5
                    ELSE 6
                  END
        """
    )

    # ── 4. SLA: cumplimiento global de speed/followup ───────────
    sla = fetch_one(
        """
        SELECT
          COUNT(*) FILTER (WHERE speed_compliance IS TRUE)::int AS speed_ok,
          COUNT(*) FILTER (WHERE speed_compliance IS FALSE)::int AS speed_fail,
          COUNT(*) FILTER (WHERE followup_compliance IS TRUE)::int AS followup_ok,
          COUNT(*) FILTER (WHERE followup_compliance IS FALSE)::int AS followup_fail
          FROM advisor_scores
        """
    ) or {}
    sok = int(sla.get("speed_ok") or 0)
    sfail = int(sla.get("speed_fail") or 0)
    sla["speed_compliance_pct"] = (sok / (sok + sfail) * 100.0) if (sok + sfail) > 0 else None
    fok = int(sla.get("followup_ok") or 0)
    ffail = int(sla.get("followup_fail") or 0)
    sla["followup_compliance_pct"] = (
        (fok / (fok + ffail) * 100.0) if (fok + ffail) > 0 else None
    )

    # ── 5. % sin seguimiento + procesos rotos (binarios) ────────
    binarios = fetch_one(
        """
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE did_followup = FALSE)::int AS no_followup,
          COUNT(*) FILTER (WHERE used_generic_messages = TRUE)::int AS used_generic,
          COUNT(*) FILTER (WHERE proposed_visit = FALSE)::int AS no_proposed_visit,
          COUNT(*) FILTER (WHERE attempted_close = FALSE)::int AS no_attempted_close,
          COUNT(*) FILTER (WHERE asked_qualification_questions = FALSE)::int AS no_qualified,
          COUNT(*) FILTER (WHERE answered_all_questions = FALSE)::int AS unanswered,
          COUNT(*) FILTER (WHERE sent_project_info = FALSE)::int AS no_project_info,
          COUNT(*) FILTER (WHERE sent_prices = FALSE)::int AS no_prices,
          COUNT(*) FILTER (WHERE offered_alternatives = FALSE)::int AS no_alternatives
          FROM conversation_metrics
        """
    ) or {}
    cm_total = int(binarios.get("total") or 0)

    def _pct(field: str) -> float | None:
        v = int(binarios.get(field) or 0)
        return (v / cm_total * 100.0) if cm_total > 0 else None

    process_failures = {
        "total_chats": cm_total,
        "no_followup": {"count": int(binarios.get("no_followup") or 0), "pct": _pct("no_followup")},
        "used_generic": {"count": int(binarios.get("used_generic") or 0), "pct": _pct("used_generic")},
        "no_proposed_visit": {"count": int(binarios.get("no_proposed_visit") or 0), "pct": _pct("no_proposed_visit")},
        "no_attempted_close": {"count": int(binarios.get("no_attempted_close") or 0), "pct": _pct("no_attempted_close")},
        "no_qualified": {"count": int(binarios.get("no_qualified") or 0), "pct": _pct("no_qualified")},
        "unanswered_questions": {"count": int(binarios.get("unanswered") or 0), "pct": _pct("unanswered")},
        "no_project_info": {"count": int(binarios.get("no_project_info") or 0), "pct": _pct("no_project_info")},
        "no_prices_sent": {"count": int(binarios.get("no_prices") or 0), "pct": _pct("no_prices")},
        "no_alternatives": {"count": int(binarios.get("no_alternatives") or 0), "pct": _pct("no_alternatives")},
    }

    # ── 6. Top errores (categorizados — mismas reglas que /errors) ─
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
         LIMIT 30
        """
    )

    # ── 7. Causa granular de pérdida (perdido_por) ──────────────
    loss_causes = fetch_all(
        """
        SELECT COALESCE(perdido_por, 'no_aplica') AS cause, COUNT(*)::int AS count
          FROM conversation_outcomes
         WHERE perdido_por IS NOT NULL
         GROUP BY 1
         ORDER BY count DESC
        """
    )

    # ── 8. Estados finales ──────────────────────────────────────
    final_statuses = fetch_all(
        """
        SELECT final_status AS status, COUNT(*)::int AS count
          FROM conversation_outcomes
         GROUP BY 1
         ORDER BY count DESC
        """
    )

    # ── 9. Objeciones ───────────────────────────────────────────
    obj_summary = fetch_one(
        """
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE was_resolved IS TRUE)::int AS resolved,
          COUNT(*) FILTER (WHERE is_hidden_objection IS TRUE)::int AS hidden,
          AVG(response_quality)::float AS avg_response_quality
        FROM lead_objections
        """
    ) or {}
    ot = int(obj_summary.get("total") or 0)
    obj_summary["pct_resolved"] = (
        (int(obj_summary.get("resolved") or 0) / ot * 100.0) if ot > 0 else None
    )

    objections_by_type = fetch_all(
        """
        SELECT COALESCE(objection_type, 'otro') AS type,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE was_resolved IS TRUE)::int AS resolved
          FROM lead_objections
         GROUP BY 1
         ORDER BY total DESC
        """
    )

    # ── 10. Preguntas del lead que el asesor nunca contestó ─────
    unanswered_sample = fetch_all(
        """
        SELECT lower(q) AS question, COUNT(*)::int AS count
          FROM conversation_metrics,
               LATERAL unnest(COALESCE(unanswered_questions, ARRAY[]::text[])) AS q
         WHERE q IS NOT NULL AND q <> ''
         GROUP BY 1
         ORDER BY count DESC
         LIMIT 20
        """
    )

    # ── 11. Tendencia mensual ───────────────────────────────────
    monthly = fetch_all(
        """
        SELECT to_char(date_trunc('month', l.first_contact_at), 'YYYY-MM') AS month,
               COUNT(*)::int AS leads,
               SUM(COALESCE(array_length(asc_.errors_list, 1), 0))::int AS errors,
               ROUND(AVG(asc_.overall_score)::numeric, 2)::float AS avg_score,
               ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY rt.first_response_minutes)::numeric, 1)::float
                   AS p50_first_response,
               COUNT(*) FILTER (WHERE co.final_status IN ('venta_cerrada','cliente_existente'))::int AS conversions
          FROM leads l
          LEFT JOIN advisor_scores asc_ ON asc_.lead_id = l.id
          LEFT JOIN response_times rt ON rt.lead_id = l.id
          LEFT JOIN conversation_outcomes co ON co.lead_id = l.id
         WHERE l.first_contact_at IS NOT NULL
         GROUP BY 1
         ORDER BY 1
        """
    )

    # ── 12. Lista textual de errores (anónima, todo lo medible) ─
    # Sin advisor_name, sin lead_id ni teléfono. Solo el texto y la
    # fecha de creación del scoring para poder ordenarlos.
    raw_errors = []
    if raw_limit > 0:
        raw_errors = fetch_all(
            """
            SELECT err AS text,
                   to_char(asc_.created_at, 'YYYY-MM-DD') AS date
              FROM advisor_scores asc_,
                   LATERAL unnest(COALESCE(errors_list, ARRAY[]::text[])) AS err
             WHERE err IS NOT NULL AND err <> ''
             ORDER BY asc_.created_at DESC
             LIMIT %s
            """,
            [raw_limit],
        )

    # ── 13. Fortalezas (para balance — opcional pero útil) ──────
    top_strengths = fetch_all(
        """
        SELECT initcap(lower(s)) AS strength, COUNT(*)::int AS count
          FROM advisor_scores,
               LATERAL unnest(COALESCE(strengths_list, ARRAY[]::text[])) AS s
         WHERE s IS NOT NULL AND s <> ''
         GROUP BY 1
         ORDER BY count DESC
         LIMIT 15
        """
    )

    return {
        "summary": summary,
        "response_time_stats": rt_stats,
        "response_time_categories": rt_categories,
        "sla_compliance": sla,
        "process_failures": process_failures,
        "top_errors": top_errors,
        "loss_causes": loss_causes,
        "final_statuses": final_statuses,
        "objections_summary": obj_summary,
        "objections_by_type": objections_by_type,
        "unanswered_questions": unanswered_sample,
        "monthly_evolution": monthly,
        "raw_errors": raw_errors,
        "top_strengths": top_strengths,
    }
