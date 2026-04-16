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


@router.get("/dapta-export")
def dapta_export(_user: str = Depends(get_current_user)) -> Dict[str, Any]:
    """Exporta la base de conocimiento en el formato estructurado que
    Dapta espera: preguntas_frecuentes, objeciones, señales_de_compra,
    señales_de_perdida, info_proyectos, respuestas_ideales."""
    kb_rows = fetch_all(
        """SELECT entry_type, category, content_text, verbatim_examples,
                  frequency_count, ideal_response, related_project
             FROM dapta_knowledge_base
             ORDER BY entry_type, frequency_count DESC NULLS LAST"""
    )

    out: Dict[str, List[Dict[str, Any]]] = {
        "preguntas_frecuentes": [],
        "objeciones": [],
        "senales_de_compra": [],
        "senales_de_perdida": [],
        "info_proyectos": [],
        "respuestas_ideales": [],
    }

    key_map = {
        "pregunta_frecuente": "preguntas_frecuentes",
        "objecion_comun": "objeciones",
        "senal_compra": "senales_de_compra",
        "senal_abandono": "senales_de_perdida",
        "info_proyecto": "info_proyectos",
        "respuesta_ideal": "respuestas_ideales",
    }

    for r in kb_rows:
        bucket = key_map.get(r["entry_type"])
        if not bucket:
            continue
        out[bucket].append({
            "tema": r.get("category"),
            "contenido": r.get("content_text"),
            "ejemplos_verbatim": r.get("verbatim_examples") or [],
            "frecuencia": r.get("frequency_count") or 0,
            "respuesta_sugerida": r.get("ideal_response"),
            "proyecto_relacionado": r.get("related_project"),
        })

    # Enriquecer respuestas ejemplares con las de asesores top (score >= 8)
    # para cada objeción: buscar respuestas reales de conversaciones con
    # alto overall_score.
    top_advisor_responses = fetch_all(
        """
        SELECT lo.objection_type, lo.objection_text, lo.advisor_response,
               asc_.advisor_name, asc_.overall_score
          FROM lead_objections lo
          JOIN advisor_scores asc_ ON asc_.lead_id = lo.lead_id
         WHERE lo.was_resolved = true
           AND asc_.overall_score >= 8
           AND lo.advisor_response IS NOT NULL
         ORDER BY asc_.overall_score DESC
         LIMIT 200
        """
    )

    by_type: Dict[str, List[Dict[str, Any]]] = {}
    for r in top_advisor_responses:
        by_type.setdefault(r["objection_type"] or "otro", []).append({
            "objecion": r["objection_text"],
            "respuesta_asesor": r["advisor_response"],
            "asesor": r["advisor_name"],
            "score_asesor": float(r["overall_score"]) if r["overall_score"] is not None else None,
        })

    # Anexar top_responses_by_type en cada objeción
    for o in out["objeciones"]:
        t = o.get("tema")
        if t and t in by_type:
            o["respuestas_ejemplares"] = by_type[t][:5]

    return {
        "cliente": "Ortiz Finca Raiz",
        "generado_en": None,  # fill on frontend display
        "estadisticas": {
            "total_entradas": len(kb_rows),
            "preguntas_frecuentes": len(out["preguntas_frecuentes"]),
            "objeciones": len(out["objeciones"]),
            "senales_de_compra": len(out["senales_de_compra"]),
            "senales_de_perdida": len(out["senales_de_perdida"]),
            "info_proyectos": len(out["info_proyectos"]),
            "respuestas_ideales": len(out["respuestas_ideales"]),
            "respuestas_asesores_top": sum(len(v) for v in by_type.values()),
        },
        **out,
    }
