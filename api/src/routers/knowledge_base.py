"""Panel 7: Dapta knowledge base."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query

from ..auth import get_current_user
from ..db import fetch_all

router = APIRouter(prefix="/api/knowledge-base", tags=["knowledge-base"])


@router.get("")
def list_knowledge(
    type: Optional[str] = Query(None, description="entry_type filter"),
    search: Optional[str] = Query(None, description="search in content_text/category"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    _user: str = Depends(get_current_user),
) -> Dict[str, Any]:
    where = ["TRUE"]
    params: list = []
    if type:
        where.append("entry_type = %s")
        params.append(type)
    if search:
        where.append("(content_text ILIKE %s OR category ILIKE %s OR ideal_response ILIKE %s)")
        like = f"%{search}%"
        params.extend([like, like, like])

    where_sql = " AND ".join(where)

    total_row = fetch_all(f"SELECT COUNT(*)::int AS c FROM dapta_knowledge_base WHERE {where_sql}", params)
    total = int(total_row[0]["c"]) if total_row else 0

    rows = fetch_all(
        f"""
        SELECT id, entry_type, category, content_text, verbatim_examples,
               frequency_count, ideal_response
          FROM dapta_knowledge_base
         WHERE {where_sql}
         ORDER BY frequency_count DESC NULLS LAST, id ASC
         LIMIT %s OFFSET %s
        """,
        params + [limit, offset],
    )
    return {"total": total, "limit": limit, "offset": offset, "rows": rows}


@router.get("/export")
def export_knowledge_base(_user: str = Depends(get_current_user)) -> Dict[str, Any]:
    """Full JSON export grouped by entry_type for Dapta ingestion."""
    rows = fetch_all(
        """
        SELECT id, entry_type, category, content_text, verbatim_examples,
               frequency_count, ideal_response
          FROM dapta_knowledge_base
         ORDER BY entry_type, frequency_count DESC NULLS LAST, id ASC
        """
    )
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        grouped.setdefault(r["entry_type"] or "unknown", []).append(r)

    return {
        "client": "Ortiz Finca Raiz",
        "total_entries": len(rows),
        "entry_types": {k: len(v) for k, v in grouped.items()},
        "data": grouped,
    }
