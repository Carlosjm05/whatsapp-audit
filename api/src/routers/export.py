"""CSV / JSON export of common resources."""
from __future__ import annotations

import csv
import io
import json
from typing import Any, Dict, Iterable, List

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..auth import get_current_user
from ..db import fetch_all

router = APIRouter(prefix="/api/export", tags=["export"])


# --- Resource SQL registry ---
_RESOURCES: Dict[str, Dict[str, Any]] = {
    "recoverable_leads": {
        "filename": "recoverable_leads",
        "sql": """
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
            WHERE co.is_recoverable = TRUE
            ORDER BY lf.budget_estimated_cop DESC NULLS LAST
        """,
    },
    "advisor_scores": {
        "filename": "advisor_scores",
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
        "filename": "knowledge_base",
        "sql": """
            SELECT id, entry_type, category, content_text, verbatim_examples,
                   frequency_count, ideal_response
              FROM dapta_knowledge_base
             ORDER BY entry_type, frequency_count DESC NULLS LAST
        """,
    },
}


def _json_default(o: Any) -> Any:
    if hasattr(o, "isoformat"):
        return o.isoformat()
    return str(o)


def _stringify_cell(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, (list, tuple)):
        # Join arrays with ` | ` for CSV readability
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
    _user: str = Depends(get_current_user),
) -> StreamingResponse:
    spec = _RESOURCES.get(resource)
    if not spec:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown resource '{resource}'. Allowed: {list(_RESOURCES.keys())}",
        )

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
