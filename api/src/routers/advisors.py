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
        WHERE ascr.advisor_name = %s
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
         WHERE advisor_name = %s
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
         WHERE advisor_name = %s
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
         WHERE ascr.advisor_name = %s
         GROUP BY co.final_status
         ORDER BY count DESC
        """,
        [name],
    )
    recent_leads = fetch_all(
        """
        SELECT l.id, l.whatsapp_name, l.real_name, l.phone,
               co.final_status, co.is_recoverable, ascr.overall_score,
               to_char(l.last_contact_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS last_contact_at
          FROM advisor_scores ascr
          JOIN leads l ON l.id = ascr.lead_id
          LEFT JOIN conversation_outcomes co ON co.lead_id = l.id
         WHERE ascr.advisor_name = %s
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
