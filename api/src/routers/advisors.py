"""Panel 3: Advisor ranking and detail."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user
from ..db import fetch_all, fetch_one

router = APIRouter(prefix="/api/advisors", tags=["advisors"])


@router.get("")
def list_advisors(_user: str = Depends(get_current_user)) -> List[dict]:
    """Ranking of advisors by average overall score with aggregate metrics."""
    rows = fetch_all(
        """
        WITH base AS (
          SELECT
            ascr.advisor_name,
            ascr.lead_id,
            ascr.overall_score,
            ascr.errors_list,
            ascr.strengths_list,
            co.final_status,
            co.is_recoverable,
            rt.first_response_minutes
          FROM advisor_scores ascr
          LEFT JOIN conversation_outcomes co ON co.lead_id = ascr.lead_id
          LEFT JOIN response_times rt ON rt.lead_id = ascr.lead_id
          WHERE ascr.advisor_name IS NOT NULL AND ascr.advisor_name <> ''
        )
        SELECT
          advisor_name,
          COUNT(*)::int AS total_leads,
          COUNT(*) FILTER (WHERE final_status = 'venta_cerrada')::int AS sold,
          COUNT(*) FILTER (WHERE is_recoverable = TRUE)::int AS recoverable,
          AVG(overall_score)::float AS avg_overall_score,
          AVG(first_response_minutes)::float AS avg_first_response_minutes
        FROM base
        GROUP BY advisor_name
        ORDER BY avg_overall_score DESC NULLS LAST, total_leads DESC
        """
    )

    # Aggregate errors/strengths per advisor
    details = fetch_all(
        """
        SELECT advisor_name, err AS item, 'error' AS kind, COUNT(*)::int AS cnt
          FROM advisor_scores, LATERAL unnest(COALESCE(errors_list, ARRAY[]::text[])) AS err
         WHERE advisor_name IS NOT NULL
         GROUP BY advisor_name, err
        UNION ALL
        SELECT advisor_name, s AS item, 'strength' AS kind, COUNT(*)::int AS cnt
          FROM advisor_scores, LATERAL unnest(COALESCE(strengths_list, ARRAY[]::text[])) AS s
         WHERE advisor_name IS NOT NULL
         GROUP BY advisor_name, s
        """
    )

    by_adv: dict = {}
    for d in details:
        name = d["advisor_name"]
        slot = by_adv.setdefault(name, {"errors": [], "strengths": []})
        if d["kind"] == "error":
            slot["errors"].append({"text": d["item"], "count": d["cnt"]})
        else:
            slot["strengths"].append({"text": d["item"], "count": d["cnt"]})

    for r in rows:
        agg = by_adv.get(r["advisor_name"], {"errors": [], "strengths": []})
        errors = sorted(agg["errors"], key=lambda x: x["count"], reverse=True)[:5]
        strengths = sorted(agg["strengths"], key=lambda x: x["count"], reverse=True)[:5]
        r["common_errors"] = errors
        r["common_strengths"] = strengths

    return rows


@router.get("/{name}/patterns")
def advisor_patterns(
    name: str,
    _user: str = Depends(get_current_user),
) -> dict:
    """Patrones de comportamiento del asesor (#14).

    A diferencia de `/errors`, que lista errores sueltos, esta vista
    detecta TENDENCIAS basadas en los agregados de sus leads:
    - usa mensajes plantilla con frecuencia
    - responde tarde (P95 > 10 min SLA)
    - ignora objeciones (was_resolved=false alto)
    - cierra poco (attempted_close=false alto)
    - trabaja en horarios inusuales (1-5am)
    - no propone visitas (proposed_visit=false alto)

    Retorna {patterns: [{type, severity, evidence, affected_leads}]}.
    """
    # Verificar que el asesor existe
    exists = fetch_one(
        "SELECT 1 FROM advisor_scores WHERE advisor_name ILIKE %s LIMIT 1",
        [name],
    )
    if not exists:
        raise HTTPException(status_code=404, detail="Asesor no encontrado")

    # Stats agregados del asesor.
    #
    # Denominadores ESPECÍFICOS por métrica: antes usábamos `total` (todos
    # los leads) pero `COUNT FILTER (WHERE x = FALSE)` descarta NULLs —
    # los leads sin fila `conversation_metrics` o sin `speed_compliance`
    # evaluado no cuentan ni como TRUE ni como FALSE, subestimando
    # sistemáticamente los porcentajes. Ahora cada métrica usa como
    # denominador solo los leads que tienen ese campo determinable.
    stats = fetch_one(
        """
        SELECT
          COUNT(DISTINCT ascr.lead_id)::int                                      AS total,
          AVG(rt.first_response_minutes)::float                                   AS avg_rt,
          percentile_cont(0.95) WITHIN GROUP (
            ORDER BY rt.first_response_minutes)::float                            AS p95_rt,

          -- SLA / followup: denominador = leads con el flag evaluado (no NULL).
          COUNT(*) FILTER (WHERE ascr.speed_compliance IS NOT NULL)::int           AS sla_denom,
          COUNT(*) FILTER (WHERE ascr.speed_compliance = FALSE)::int               AS sla_viol,
          COUNT(*) FILTER (WHERE ascr.followup_compliance IS NOT NULL)::int        AS followup_denom,
          COUNT(*) FILTER (WHERE ascr.followup_compliance = FALSE)::int            AS no_followup,

          -- Conversation metrics: denominador = leads con fila cm (JOIN no NULL).
          COUNT(*) FILTER (WHERE cm.lead_id IS NOT NULL)::int                      AS cm_denom,
          COUNT(*) FILTER (WHERE cm.used_generic_messages = TRUE)::int             AS uses_tmpl,
          COUNT(*) FILTER (WHERE cm.proposed_visit = FALSE)::int                   AS no_visit,
          COUNT(*) FILTER (WHERE cm.attempted_close = FALSE)::int                  AS no_close,
          COUNT(*) FILTER (WHERE cm.asked_qualification_questions = FALSE)::int    AS no_qualif,

          COUNT(DISTINCT ascr.lead_id) FILTER (
            WHERE EXISTS (SELECT 1 FROM lead_objections lo
                          WHERE lo.lead_id = ascr.lead_id)
          )::int                                                                   AS obj_denom,
          COUNT(DISTINCT ascr.lead_id) FILTER (
            WHERE EXISTS (SELECT 1 FROM lead_objections lo
                          WHERE lo.lead_id = ascr.lead_id AND lo.was_resolved = FALSE)
          )::int                                                                   AS unresolved_obj
        FROM advisor_scores ascr
        LEFT JOIN response_times rt ON rt.lead_id = ascr.lead_id
        LEFT JOIN conversation_metrics cm ON cm.lead_id = ascr.lead_id
        WHERE ascr.advisor_name ILIKE %s
        """,
        [name],
    ) or {}

    total = int(stats.get("total") or 0)
    if total == 0:
        return {"advisor_name": name, "total_leads": 0, "patterns": []}

    def pct_of(n: int, denom_key: str) -> float:
        """% usando un denominador específico. Si el denominador es 0 o
        la métrica aún no se evaluó para ningún lead, devolvemos 0."""
        denom = int(stats.get(denom_key) or 0)
        if denom == 0:
            return 0.0
        return round(100.0 * (n or 0) / denom, 1)

    patterns: List[dict] = []

    # Umbrales — los definimos explícitos para que sean auditables y
    # ajustables (ej. >=50% = patrón claro, >=30% = señal). Cada métrica
    # usa SU denominador (leads con el campo evaluado) — no el total
    # global, para no subestimar.
    sla_denom = int(stats.get("sla_denom") or 0)
    followup_denom = int(stats.get("followup_denom") or 0)
    cm_denom = int(stats.get("cm_denom") or 0)
    obj_denom = int(stats.get("obj_denom") or 0)

    sla_pct = pct_of(stats.get("sla_viol") or 0, "sla_denom")
    if sla_pct >= 30 and sla_denom > 0:
        patterns.append({
            "type": "respuestas_tardias",
            "label": "Respuestas tardías (>10 min)",
            "severity": "high" if sla_pct >= 50 else "medium",
            "evidence": f"{stats.get('sla_viol', 0)} de {sla_denom} leads con SLA evaluado",
            "percent": sla_pct,
            "p95_minutes": stats.get("p95_rt"),
        })

    tmpl_pct = pct_of(stats.get("uses_tmpl") or 0, "cm_denom")
    if tmpl_pct >= 40 and cm_denom > 0:
        patterns.append({
            "type": "mensajes_plantilla",
            "label": "Abuso de mensajes plantilla",
            "severity": "medium",
            "evidence": f"{stats.get('uses_tmpl', 0)} de {cm_denom} leads recibieron mensajes genéricos",
            "percent": tmpl_pct,
        })

    qualif_pct = pct_of(stats.get("no_qualif") or 0, "cm_denom")
    if qualif_pct >= 50 and cm_denom > 0:
        patterns.append({
            "type": "no_califica",
            "label": "No califica (no pregunta lo básico)",
            "severity": "high",
            "evidence": f"{stats.get('no_qualif', 0)} de {cm_denom} leads sin preguntas de calificación",
            "percent": qualif_pct,
        })

    visit_pct = pct_of(stats.get("no_visit") or 0, "cm_denom")
    if visit_pct >= 60 and cm_denom > 0:
        patterns.append({
            "type": "no_propone_visita",
            "label": "No propone visita al proyecto",
            "severity": "high",
            "evidence": f"{stats.get('no_visit', 0)} de {cm_denom} leads sin invitación a visitar",
            "percent": visit_pct,
        })

    close_pct = pct_of(stats.get("no_close") or 0, "cm_denom")
    if close_pct >= 70 and cm_denom > 0:
        patterns.append({
            "type": "no_cierra",
            "label": "No intenta cerrar",
            "severity": "high",
            "evidence": f"{stats.get('no_close', 0)} de {cm_denom} leads sin intento de cierre",
            "percent": close_pct,
        })

    followup_pct = pct_of(stats.get("no_followup") or 0, "followup_denom")
    if followup_pct >= 40 and followup_denom > 0:
        patterns.append({
            "type": "sin_seguimiento",
            "label": "Abandona el seguimiento",
            "severity": "high" if followup_pct >= 60 else "medium",
            "evidence": f"{stats.get('no_followup', 0)} de {followup_denom} leads con seguimiento evaluado",
            "percent": followup_pct,
        })

    unres_pct = pct_of(stats.get("unresolved_obj") or 0, "obj_denom")
    if unres_pct >= 30 and obj_denom > 0:
        patterns.append({
            "type": "ignora_objeciones",
            "label": "Ignora objeciones del lead",
            "severity": "medium",
            "evidence": f"{stats.get('unresolved_obj', 0)} de {obj_denom} leads con objeciones sin resolver",
            "percent": unres_pct,
        })

    # Ordenar por severidad y luego por porcentaje desc
    order = {"high": 0, "medium": 1, "low": 2}
    patterns.sort(key=lambda p: (order.get(p["severity"], 9), -p.get("percent", 0)))

    return {
        "advisor_name": name,
        "total_leads": total,
        "avg_first_response_minutes": stats.get("avg_rt"),
        "p95_first_response_minutes": stats.get("p95_rt"),
        "patterns": patterns,
    }


@router.get("/{name}/errors")
def advisor_errors_detail(
    name: str,
    _user: str = Depends(get_current_user),
) -> dict:
    """Devuelve los errores del asesor agrupados por texto del error, con
    la lista de leads donde ocurrió cada uno. Permite que el panel haga
    drill-down al click."""
    # Agrupar por texto de error. Unnest de errors_list + join con leads
    # para traer cliente, teléfono, fecha y score.
    rows = fetch_all(
        """
        SELECT
          err AS error_text,
          COUNT(*)::int AS occurrences,
          ARRAY_AGG(
            json_build_object(
              'lead_id', l.id::text,
              'real_name', l.real_name,
              'whatsapp_name', l.whatsapp_name,
              'phone', l.phone,
              'overall_score', ascr.overall_score,
              'final_status', co.final_status,
              'first_response_minutes', rt.first_response_minutes,
              'last_contact_at', to_char(
                l.last_contact_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
              )
            ) ORDER BY l.last_contact_at DESC NULLS LAST
          ) AS leads
        FROM advisor_scores ascr
        JOIN leads l ON l.id = ascr.lead_id
        LEFT JOIN conversation_outcomes co ON co.lead_id = l.id
        LEFT JOIN response_times rt ON rt.lead_id = l.id,
        LATERAL unnest(COALESCE(ascr.errors_list, ARRAY[]::text[])) AS err
        WHERE ascr.advisor_name ILIKE %s
          AND err IS NOT NULL AND err <> ''
        GROUP BY err
        ORDER BY occurrences DESC, err ASC
        """,
        [name],
    )
    return {"advisor_name": name, "errors": rows}


@router.get("/{name}")
def advisor_detail(name: str, _user: str = Depends(get_current_user)) -> dict:
    summary = fetch_one(
        """
        SELECT
          ascr.advisor_name,
          COUNT(*)::int AS total_leads,
          COUNT(*) FILTER (WHERE co.final_status = 'venta_cerrada')::int AS sold,
          COUNT(*) FILTER (WHERE co.is_recoverable = TRUE)::int AS recoverable,
          AVG(ascr.overall_score)::float AS avg_overall_score,
          AVG(ascr.speed_score)::float AS avg_speed_score,
          AVG(ascr.qualification_score)::float AS avg_qualification_score,
          AVG(ascr.product_presentation_score)::float AS avg_product_presentation_score,
          AVG(ascr.objection_handling_score)::float AS avg_objection_handling_score,
          AVG(ascr.closing_attempt_score)::float AS avg_closing_attempt_score,
          AVG(ascr.followup_score)::float AS avg_followup_score,
          AVG(rt.first_response_minutes)::float AS avg_first_response_minutes,
          AVG(rt.avg_response_minutes)::float AS avg_response_minutes,
          AVG(rt.longest_gap_hours)::float AS avg_longest_gap_hours
        FROM advisor_scores ascr
        LEFT JOIN conversation_outcomes co ON co.lead_id = ascr.lead_id
        LEFT JOIN response_times rt ON rt.lead_id = ascr.lead_id
        WHERE ascr.advisor_name ILIKE %s
        GROUP BY ascr.advisor_name
        """,
        [name],
    )
    if not summary:
        raise HTTPException(status_code=404, detail="Advisor not found")

    errors = fetch_all(
        """
        SELECT err AS text, COUNT(*)::int AS count
          FROM advisor_scores, LATERAL unnest(COALESCE(errors_list, ARRAY[]::text[])) AS err
         WHERE advisor_name ILIKE %s
         GROUP BY err
         ORDER BY count DESC
         LIMIT 20
        """,
        [name],
    )
    strengths = fetch_all(
        """
        SELECT s AS text, COUNT(*)::int AS count
          FROM advisor_scores, LATERAL unnest(COALESCE(strengths_list, ARRAY[]::text[])) AS s
         WHERE advisor_name ILIKE %s
         GROUP BY s
         ORDER BY count DESC
         LIMIT 20
        """,
        [name],
    )
    outcome_dist = fetch_all(
        """
        SELECT COALESCE(co.final_status, 'unknown') AS final_status, COUNT(*)::int AS count
          FROM advisor_scores ascr
          LEFT JOIN conversation_outcomes co ON co.lead_id = ascr.lead_id
         WHERE ascr.advisor_name ILIKE %s
         GROUP BY co.final_status
         ORDER BY count DESC
        """,
        [name],
    )
    recent_leads = fetch_all(
        """
        SELECT l.id, l.whatsapp_name, l.real_name, l.phone,
               co.final_status, co.is_recoverable, ascr.overall_score,
               to_char(l.last_contact_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_contact_at
          FROM advisor_scores ascr
          JOIN leads l ON l.id = ascr.lead_id
          LEFT JOIN conversation_outcomes co ON co.lead_id = l.id
         WHERE ascr.advisor_name ILIKE %s
         ORDER BY l.last_contact_at DESC NULLS LAST
         LIMIT 50
        """,
        [name],
    )

    return {
        "summary": summary,
        "common_errors": errors,
        "common_strengths": strengths,
        "outcome_distribution": outcome_dist,
        "recent_leads": recent_leads,
    }
