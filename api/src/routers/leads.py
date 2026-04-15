"""Panel 2: Recoverable leads + lead detail."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import get_current_user
from ..db import fetch_all, fetch_one
from ..schemas import LeadDetail, PagedRecoverableLeads

router = APIRouter(prefix="/api/leads", tags=["leads"])


@router.get("/recoverable", response_model=PagedRecoverableLeads)
def list_recoverable_leads(
    priority: Optional[str] = Query(None, description="recovery_priority filter"),
    probability: Optional[str] = Query(None, description="recovery_probability filter"),
    advisor: Optional[str] = Query(None, description="advisor_name filter (ILIKE)"),
    search: Optional[str] = Query(None, description="search phone/whatsapp_name/real_name"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _user: str = Depends(get_current_user),
) -> PagedRecoverableLeads:
    where = ["co.is_recoverable = TRUE"]
    params: list = []

    if priority:
        where.append("co.recovery_priority = %s")
        params.append(priority)
    if probability:
        where.append("co.recovery_probability = %s")
        params.append(probability)
    if advisor:
        where.append("ascr.advisor_name ILIKE %s")
        params.append(f"%{advisor}%")
    if search:
        where.append(
            "(l.phone ILIKE %s OR l.whatsapp_name ILIKE %s OR l.real_name ILIKE %s)"
        )
        like = f"%{search}%"
        params.extend([like, like, like])

    where_sql = " AND ".join(where) if where else "TRUE"

    count_row = fetch_one(
        f"""
        SELECT COUNT(*)::int AS c
          FROM leads l
          JOIN conversation_outcomes co ON co.lead_id = l.id
          LEFT JOIN advisor_scores ascr ON ascr.lead_id = l.id
          LEFT JOIN lead_intent li ON li.lead_id = l.id
          LEFT JOIN lead_financials lf ON lf.lead_id = l.id
          LEFT JOIN lead_interests lin ON lin.lead_id = l.id
         WHERE {where_sql}
        """,
        params,
    )
    total = int(count_row["c"]) if count_row else 0

    rows = fetch_all(
        f"""
        SELECT
          l.id,
          l.conversation_id,
          l.phone,
          l.whatsapp_name,
          l.real_name,
          l.city,
          l.zone,
          ascr.advisor_name,
          co.final_status,
          co.is_recoverable,
          co.recovery_probability,
          co.recovery_priority,
          co.recovery_strategy,
          co.recovery_message_suggestion,
          li.intent_score,
          li.urgency,
          lf.budget_estimated_cop,
          lf.budget_range,
          lin.product_type,
          lin.project_name,
          to_char(l.first_contact_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS first_contact_at,
          to_char(l.last_contact_at,  'YYYY-MM-DD"T"HH24:MI:SSOF') AS last_contact_at,
          ascr.overall_score
        FROM leads l
        JOIN conversation_outcomes co ON co.lead_id = l.id
        LEFT JOIN advisor_scores ascr ON ascr.lead_id = l.id
        LEFT JOIN lead_intent li ON li.lead_id = l.id
        LEFT JOIN lead_financials lf ON lf.lead_id = l.id
        LEFT JOIN lead_interests lin ON lin.lead_id = l.id
        WHERE {where_sql}
        ORDER BY
          CASE co.recovery_priority
            WHEN 'esta_semana' THEN 1
            WHEN 'este_mes' THEN 2
            WHEN 'puede_esperar' THEN 3
            ELSE 4
          END,
          CASE co.recovery_probability
            WHEN 'alta' THEN 1
            WHEN 'media' THEN 2
            WHEN 'baja' THEN 3
            ELSE 4
          END,
          lf.budget_estimated_cop DESC NULLS LAST,
          l.last_contact_at DESC NULLS LAST
        LIMIT %s OFFSET %s
        """,
        params + [limit, offset],
    )

    return PagedRecoverableLeads(total=total, limit=limit, offset=offset, rows=rows)


@router.get("/{lead_id}", response_model=LeadDetail)
def get_lead_detail(lead_id: str, _user: str = Depends(get_current_user)) -> LeadDetail:
    lead = fetch_one("SELECT * FROM leads WHERE id = %s", [lead_id])
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    interests = fetch_one("SELECT * FROM lead_interests WHERE lead_id = %s", [lead_id])
    financials = fetch_one("SELECT * FROM lead_financials WHERE lead_id = %s", [lead_id])
    intent = fetch_one("SELECT * FROM lead_intent WHERE lead_id = %s", [lead_id])
    objections = fetch_all("SELECT * FROM lead_objections WHERE lead_id = %s", [lead_id])
    metrics = fetch_one("SELECT * FROM conversation_metrics WHERE lead_id = %s", [lead_id])
    response_times = fetch_one("SELECT * FROM response_times WHERE lead_id = %s", [lead_id])
    advisor_score = fetch_one("SELECT * FROM advisor_scores WHERE lead_id = %s", [lead_id])
    outcome = fetch_one("SELECT * FROM conversation_outcomes WHERE lead_id = %s", [lead_id])
    competitor_intel = fetch_all("SELECT * FROM competitor_intel WHERE lead_id = %s", [lead_id])
    summary = fetch_one("SELECT * FROM conversation_summaries WHERE lead_id = %s", [lead_id])

    return LeadDetail(
        lead=lead,
        interests=interests,
        financials=financials,
        intent=intent,
        objections=objections,
        metrics=metrics,
        response_times=response_times,
        advisor_score=advisor_score,
        outcome=outcome,
        competitor_intel=competitor_intel,
        summary=summary,
    )
