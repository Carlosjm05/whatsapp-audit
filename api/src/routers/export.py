"""Exportación CSV / JSON de recursos comunes."""
from __future__ import annotations

import csv
import io
import json
from typing import Any, Callable, Dict, Iterable, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..auth import get_current_user
from ..db import fetch_all

router = APIRouter(prefix="/api/export", tags=["export"])


# --- SQL builder para recoverable_leads (con filtros) ---
def _build_recoverable_leads_sql(
    priority: Optional[str],
    probability: Optional[str],
    advisor: Optional[str],
    search: Optional[str],
) -> tuple[str, list]:
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

    where_sql = " AND ".join(where)
    sql = f"""
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
          l.first_contact_at,
          l.last_contact_at,
          ascr.overall_score
        FROM leads l
        JOIN conversation_outcomes co ON co.lead_id = l.id
        LEFT JOIN advisor_scores ascr ON ascr.lead_id = l.id
        LEFT JOIN lead_intent li ON li.lead_id = l.id
        LEFT JOIN lead_financials lf ON lf.lead_id = l.id
        LEFT JOIN lead_interests lin ON lin.lead_id = l.id
        WHERE {where_sql}
        ORDER BY lf.budget_estimated_cop DESC NULLS LAST
    """
    return sql, params


# --- Registry de recursos ---
# La clave canónica usa guion bajo; se acepta también con guion como alias.
_RESOURCES: Dict[str, Dict[str, Any]] = {
    "recoverable_leads": {
        "filename": "leads_recuperables",
        "build": _build_recoverable_leads_sql,
    },
    "advisor_scores": {
        "filename": "puntajes_asesores",
        "sql": """
            SELECT
              ascr.lead_id,
              ascr.advisor_name,
              ascr.speed_score,
              ascr.qualification_score,
              ascr.product_presentation_score,
              ascr.objection_handling_score,
              ascr.closing_attempt_score,
              ascr.followup_score,
              ascr.overall_score,
              ascr.errors_list,
              ascr.strengths_list,
              co.final_status,
              co.is_recoverable
            FROM advisor_scores ascr
            LEFT JOIN conversation_outcomes co ON co.lead_id = ascr.lead_id
            ORDER BY ascr.advisor_name, ascr.overall_score DESC NULLS LAST
        """,
    },
    "knowledge_base": {
        "filename": "base_conocimiento",
        "sql": """
            SELECT id, entry_type, category, content_text, verbatim_examples,
                   frequency_count, ideal_response
              FROM dapta_knowledge_base
             ORDER BY entry_type, frequency_count DESC NULLS LAST
        """,
    },
}


def _normalize_resource_key(resource: str) -> str:
    """Acepta tanto 'recoverable-leads' como 'recoverable_leads'."""
    return resource.replace("-", "_").lower()


def _json_default(o: Any) -> Any:
    if hasattr(o, "isoformat"):
        return o.isoformat()
    return str(o)


def _stringify_cell(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, (list, tuple)):
        return " | ".join(_stringify_cell(x) for x in v)
    if isinstance(v, dict):
        return json.dumps(v, ensure_ascii=False, default=_json_default)
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


def _csv_stream(rows: List[Dict[str, Any]]) -> Iterable[bytes]:
    if not rows:
        yield b""
        return
    fieldnames = list(rows[0].keys())
    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    writer.writerow(fieldnames)
    yield buf.getvalue().encode("utf-8")
    buf.seek(0)
    buf.truncate(0)

    for row in rows:
        writer.writerow([_stringify_cell(row.get(fn)) for fn in fieldnames])
        yield buf.getvalue().encode("utf-8")
        buf.seek(0)
        buf.truncate(0)


def _json_stream(rows: List[Dict[str, Any]]) -> Iterable[bytes]:
    yield b"["
    first = True
    for row in rows:
        chunk = json.dumps(row, ensure_ascii=False, default=_json_default)
        if first:
            first = False
            yield chunk.encode("utf-8")
        else:
            yield ("," + chunk).encode("utf-8")
    yield b"]"


@router.get("/{resource}")
def export_resource(
    resource: str,
    format: str = Query("csv", pattern="^(csv|json)$"),
    priority: Optional[str] = Query(None),
    probability: Optional[str] = Query(None),
    advisor: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    _user: str = Depends(get_current_user),
) -> StreamingResponse:
    key = _normalize_resource_key(resource)
    spec = _RESOURCES.get(key)
    if not spec:
        raise HTTPException(
            status_code=404,
            detail=f"Recurso desconocido '{resource}'. Permitidos: {list(_RESOURCES.keys())}",
        )

    # Recursos con builder (aceptan filtros) vs. SQL estático
    if "build" in spec:
        builder: Callable = spec["build"]
        sql, params = builder(priority, probability, advisor, search)
        rows = fetch_all(sql, params)
    else:
        rows = fetch_all(spec["sql"])

    filename = f"{spec['filename']}.{format}"

    if format == "json":
        return StreamingResponse(
            _json_stream(rows),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    return StreamingResponse(
        _csv_stream(rows),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
