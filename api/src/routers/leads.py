"""Panel 2: Recoverable leads + lead detail."""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import get_current_user
from ..db import fetch_all, fetch_one, execute
from ..schemas import LeadDetail, PagedRecoverableLeads

router = APIRouter(prefix="/api/leads", tags=["leads"])


def _parse_lead_id(lead_id: str) -> str:
    """Valida que lead_id sea un UUID bien formado antes de llegar al
    driver. Sin esto, un path param inválido (ej. /api/leads/foo) genera
    psycopg2.errors.InvalidTextRepresentation → 500."""
    try:
        return str(uuid.UUID(lead_id))
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="ID de lead inválido")


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


@router.post("/{lead_id}/reanalyze")
def reanalyze_lead(lead_id: str, _user: str = Depends(get_current_user)):
    """Encola el lead para re-análisis: marca analysis_status='pending'
    y crea una entrada en lead_analysis_history. El analyzer lo tomará
    en su próxima corrida."""
    lead_id = _parse_lead_id(lead_id)
    lead = fetch_one("SELECT id, conversation_id FROM leads WHERE id = %s", [lead_id])
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    execute(
        """UPDATE leads SET
             analysis_status = 'pending',
             analysis_retry_count = 0,
             analysis_error = NULL,
             updated_at = NOW()
           WHERE id = %s""",
        [lead_id],
    )

    execute(
        """INSERT INTO lead_analysis_history
             (lead_id, triggered_by, status, started_at)
           VALUES (%s, 'manual', 'pending', NOW())""",
        [lead_id],
    )

    return {"ok": True, "message": "Lead queued for re-analysis"}


@router.get("/{lead_id}/analysis-history")
def get_analysis_history(lead_id: str, _user: str = Depends(get_current_user)):
    """Historial de análisis del lead, más recientes primero."""
    lead_id = _parse_lead_id(lead_id)
    if not fetch_one("SELECT 1 FROM leads WHERE id = %s", [lead_id]):
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    rows = fetch_all(
        """
        SELECT id, lead_id, triggered_by, status, model_used,
               cost_usd::float AS cost_usd,
               to_char(started_at,   'YYYY-MM-DD"T"HH24:MI:SSOF') AS started_at,
               to_char(completed_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS completed_at,
               error_message, diff_summary
          FROM lead_analysis_history
         WHERE lead_id = %s
         ORDER BY started_at DESC
         LIMIT 50
        """,
        [lead_id],
    )
    return {"items": rows}


@router.get("/search")
def search_leads(
    q: Optional[str] = Query(None, description="texto (nombre/teléfono/resumen)"),
    min_intent: Optional[int] = Query(None, ge=1, le=10),
    max_intent: Optional[int] = Query(None, ge=1, le=10),
    budget_range: Optional[str] = Query(None),
    urgency: Optional[str] = Query(None),
    final_status: Optional[str] = Query(None),
    advisor: Optional[str] = Query(None),
    recovery_probability: Optional[str] = Query(None),
    lead_source: Optional[str] = Query(None),
    product_type: Optional[str] = Query(None),
    has_unresolved_objections: Optional[bool] = Query(None),
    mentioned_competitors: Optional[bool] = Query(None),
    from_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _user: str = Depends(get_current_user),
):
    """Búsqueda avanzada con todos los filtros combinables."""
    where: list[str] = []
    params: list = []

    if q:
        where.append(
            "(l.phone ILIKE %s OR l.whatsapp_name ILIKE %s OR l.real_name ILIKE %s "
            "OR cs.summary_text ILIKE %s)"
        )
        like = f"%{q}%"
        params.extend([like, like, like, like])
    if min_intent is not None:
        where.append("li.intent_score >= %s"); params.append(min_intent)
    if max_intent is not None:
        where.append("li.intent_score <= %s"); params.append(max_intent)
    if budget_range:
        where.append("lf.budget_range = %s"); params.append(budget_range)
    if urgency:
        where.append("li.urgency = %s"); params.append(urgency)
    if final_status:
        where.append("co.final_status = %s"); params.append(final_status)
    if advisor:
        where.append("ascr.advisor_name ILIKE %s"); params.append(f"%{advisor}%")
    if recovery_probability:
        where.append("co.recovery_probability = %s"); params.append(recovery_probability)
    if lead_source:
        where.append("l.lead_source = %s"); params.append(lead_source)
    if product_type:
        where.append("lin.product_type = %s"); params.append(product_type)
    if has_unresolved_objections is True:
        where.append(
            "EXISTS (SELECT 1 FROM lead_objections lo "
            "WHERE lo.lead_id = l.id AND lo.was_resolved = false)"
        )
    elif has_unresolved_objections is False:
        where.append(
            "NOT EXISTS (SELECT 1 FROM lead_objections lo "
            "WHERE lo.lead_id = l.id AND lo.was_resolved = false)"
        )
    if mentioned_competitors is True:
        where.append("EXISTS (SELECT 1 FROM competitor_intel ci WHERE ci.lead_id = l.id)")
    elif mentioned_competitors is False:
        where.append("NOT EXISTS (SELECT 1 FROM competitor_intel ci WHERE ci.lead_id = l.id)")
    if from_date:
        where.append("l.last_contact_at >= %s::timestamptz"); params.append(from_date)
    if to_date:
        where.append("l.last_contact_at <= %s::timestamptz"); params.append(to_date)

    where_sql = " AND ".join(where) if where else "TRUE"

    count_row = fetch_one(
        f"""SELECT COUNT(*)::int AS c
              FROM leads l
              LEFT JOIN conversation_outcomes co ON co.lead_id = l.id
              LEFT JOIN advisor_scores ascr    ON ascr.lead_id = l.id
              LEFT JOIN lead_intent li          ON li.lead_id = l.id
              LEFT JOIN lead_financials lf      ON lf.lead_id = l.id
              LEFT JOIN lead_interests lin      ON lin.lead_id = l.id
              LEFT JOIN conversation_summaries cs ON cs.lead_id = l.id
             WHERE {where_sql}""",
        params,
    )
    total = int(count_row["c"]) if count_row else 0

    rows = fetch_all(
        f"""
        SELECT
          l.id, l.conversation_id, l.phone, l.whatsapp_name, l.real_name,
          l.city, l.zone, l.lead_source,
          ascr.advisor_name,
          co.final_status, co.is_recoverable, co.recovery_probability,
          co.recovery_priority,
          li.intent_score, li.urgency,
          lf.budget_estimated_cop, lf.budget_range,
          lin.product_type, lin.project_name,
          to_char(l.first_contact_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS first_contact_at,
          to_char(l.last_contact_at,  'YYYY-MM-DD"T"HH24:MI:SSOF') AS last_contact_at,
          ascr.overall_score
        FROM leads l
        LEFT JOIN conversation_outcomes co ON co.lead_id = l.id
        LEFT JOIN advisor_scores ascr    ON ascr.lead_id = l.id
        LEFT JOIN lead_intent li          ON li.lead_id = l.id
        LEFT JOIN lead_financials lf      ON lf.lead_id = l.id
        LEFT JOIN lead_interests lin      ON lin.lead_id = l.id
        LEFT JOIN conversation_summaries cs ON cs.lead_id = l.id
        WHERE {where_sql}
        ORDER BY li.intent_score DESC NULLS LAST, l.last_contact_at DESC NULLS LAST
        LIMIT %s OFFSET %s
        """,
        params + [limit, offset],
    )
    return {"total": total, "limit": limit, "offset": offset, "rows": rows}


@router.get("/{lead_id}/conversation")
def get_lead_conversation(
    lead_id: str,
    _user: str = Depends(get_current_user),
):
    """Devuelve los mensajes completos del chat del lead, con transcripciones
    si están disponibles. Usado por el visualizador de conversación."""
    lead_id = _parse_lead_id(lead_id)
    lead = fetch_one(
        "SELECT id, conversation_id, phone, whatsapp_name, real_name "
        "FROM leads WHERE id = %s",
        [lead_id],
    )
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    conv_id = lead["conversation_id"]
    if not conv_id:
        return {
            "conversation_id": None,
            "chat_name": lead.get("real_name") or lead.get("whatsapp_name"),
            "phone": lead.get("phone"),
            "messages": [],
            "total": 0,
        }

    messages = fetch_all(
        """
        SELECT
            m.id,
            m.message_id,
            to_char(m.timestamp, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS timestamp,
            m.sender,
            m.sender_name,
            m.message_type,
            m.body,
            m.media_path,
            m.media_duration_sec,
            m.media_mimetype,
            m.is_forwarded,
            m.is_reply,
            m.reply_to_id,
            t.transcription_text,
            t.confidence_score AS transcription_confidence,
            t.is_low_confidence
        FROM messages m
        LEFT JOIN transcriptions t ON t.message_id = m.id
                                    AND t.status = 'completed'
        WHERE m.conversation_id = %s
        ORDER BY m.timestamp ASC
        """,
        [conv_id],
    )

    return {
        "conversation_id": str(conv_id),
        "chat_name": lead.get("real_name") or lead.get("whatsapp_name"),
        "phone": lead.get("phone"),
        "messages": messages,
        "total": len(messages),
    }


@router.get("/{lead_id}", response_model=LeadDetail)
def get_lead_detail(lead_id: str, _user: str = Depends(get_current_user)) -> LeadDetail:
    lead_id = _parse_lead_id(lead_id)
    lead = fetch_one("SELECT * FROM leads WHERE id = %s", [lead_id])
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

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
