"""Generador del export "base de conocimiento" para Dapta.

Toma todos los leads ya analizados y produce filas en
`dapta_knowledge_base` listas para alimentar el agente IA del cliente:

  - Top preguntas reales del lead (verbatim) clasificadas por tema.
  - Top objeciones por tipo, con la respuesta del asesor cuando
    `response_quality >= 8` ("respuesta_ideal").
  - Señales de compra y abandono detectadas.

El export se regenera completo en cada corrida (TRUNCATE + INSERT
dentro de transacción) — un fallo intermedio NO deja la KB vacía.

NO contiene PII por diseño: agregamos verbatim de objeciones y
preguntas, pero los `source_leads` se referencian por UUID (no número
de teléfono) y el agente Dapta solo recibe el corpus textual. Ver
docs/PRIVACIDAD.md sección 7 (transferencia internacional).
"""
from __future__ import annotations

import logging
from collections import Counter, defaultdict
from typing import Any, Dict, List

from . import db


log = logging.getLogger("analyzer.kb")


def _flatten(rows: List[Dict[str, Any]], key: str) -> List[str]:
    out: List[str] = []
    for r in rows:
        v = r.get(key) or []
        if isinstance(v, list):
            out.extend(s for s in v if isinstance(s, str) and s.strip())
    return out


def build_knowledge_base() -> Dict[str, int]:
    """Regenera la tabla dapta_knowledge_base a partir de leads analizados.

    Escribe filas con entry_type en:
      - pregunta_frecuente
      - objecion_comun
      - senal_compra
      - senal_abandono
      - info_proyecto
    """
    leads = db.fetch_analyzed_for_kb()
    log.info("generando KB desde %d leads analizados", len(leads))

    entries: List[Dict[str, Any]] = []

    # ─── 1. Top 50 preguntas frecuentes ────────────────────────
    top_unanswered = db.fetch_top_unanswered(limit=50)
    for r in top_unanswered:
        entries.append({
            "entry_type": "pregunta_frecuente",
            "category": None,
            "content_text": r["q"],
            "verbatim_examples": [r["q"]],
            "frequency_count": int(r["n"]),
            "ideal_response": None,
            "source_leads": [],
        })

    # ─── 2. Top 20 objeciones por tipo ─────────────────────────
    top_objections = db.fetch_top_objections(limit=20)
    for r in top_objections:
        entries.append({
            "entry_type": "objecion_comun",
            "category": r["objection_type"],
            "content_text": (r.get("examples") or [r["objection_type"]])[0],
            "verbatim_examples": list(r.get("examples") or []),
            "frequency_count": int(r["n"]),
            "ideal_response": None,
            "source_leads": [str(x) for x in (r.get("leads") or [])[:20]],
        })

    # ─── 3. Señales de compra y abandono ───────────────────────
    buy_counter: Counter = Counter()
    buy_sources: Dict[str, List[str]] = defaultdict(list)
    for col in ("positive_financial_signals", "high_urgency_signals"):
        for r in leads:
            for sig in (r.get(col) or []):
                if isinstance(sig, str) and sig.strip():
                    buy_counter[sig] += 1
                    buy_sources[sig].append(str(r["id"]))

    for sig, cnt in buy_counter.most_common(30):
        entries.append({
            "entry_type": "senal_compra",
            "category": None,
            "content_text": sig,
            "verbatim_examples": [sig],
            "frequency_count": int(cnt),
            "ideal_response": None,
            "source_leads": buy_sources[sig][:20],
        })

    abandon_counter: Counter = Counter()
    abandon_sources: Dict[str, List[str]] = defaultdict(list)
    for col in ("negative_financial_signals", "low_urgency_signals"):
        for r in leads:
            for sig in (r.get(col) or []):
                if isinstance(sig, str) and sig.strip():
                    abandon_counter[sig] += 1
                    abandon_sources[sig].append(str(r["id"]))

    for sig, cnt in abandon_counter.most_common(30):
        entries.append({
            "entry_type": "senal_abandono",
            "category": None,
            "content_text": sig,
            "verbatim_examples": [sig],
            "frequency_count": int(cnt),
            "ideal_response": None,
            "source_leads": abandon_sources[sig][:20],
        })

    # ─── 3b. Respuestas ideales del asesor (calidad >= 8) ──────
    # Tomamos respuestas del asesor que obtuvieron score alto — útiles
    # para que Dapta replique patrones que ya funcionan en el equipo.
    top_responses = db.fetch_ideal_responses(min_quality=8, limit=40)
    for r in top_responses:
        entries.append({
            "entry_type": "respuesta_ideal",
            "category": r.get("objection_type"),
            "content_text": r["advisor_response"][:1000],
            "verbatim_examples": [r["advisor_response"][:1000]],
            "frequency_count": int(r.get("n") or 1),
            "ideal_response": r["advisor_response"][:1000],
            "source_leads": (r.get("leads") or [])[:20],
        })

    # ─── 4. Proyectos mencionados ──────────────────────────────
    project_counter: Counter = Counter()
    project_sources: Dict[str, List[str]] = defaultdict(list)
    for r in leads:
        for p in (r.get("all_projects_mentioned") or []):
            if isinstance(p, str) and p.strip():
                project_counter[p] += 1
                project_sources[p].append(str(r["id"]))
    for p, cnt in project_counter.most_common(50):
        entries.append({
            "entry_type": "info_proyecto",
            "category": None,
            "content_text": p,
            "verbatim_examples": [p],
            "frequency_count": int(cnt),
            "related_project": p,
            "ideal_response": None,
            "source_leads": project_sources[p][:20],
        })

    written = db.upsert_kb_entries(entries)

    summary = {
        "total_leads_analyzed": len(leads),
        "preguntas_frecuentes": sum(1 for e in entries if e["entry_type"] == "pregunta_frecuente"),
        "objeciones_comunes": sum(1 for e in entries if e["entry_type"] == "objecion_comun"),
        "senales_compra": sum(1 for e in entries if e["entry_type"] == "senal_compra"),
        "senales_abandono": sum(1 for e in entries if e["entry_type"] == "senal_abandono"),
        "respuestas_ideales": sum(1 for e in entries if e["entry_type"] == "respuesta_ideal"),
        "info_proyectos": sum(1 for e in entries if e["entry_type"] == "info_proyecto"),
        "total_entries": written,
    }

    log.info(
        "KB generada: %d entradas (%d preguntas, %d objeciones, "
        "%d compra, %d abandono, %d resp. ideales, %d proyectos)",
        summary["total_entries"],
        summary["preguntas_frecuentes"],
        summary["objeciones_comunes"],
        summary["senales_compra"],
        summary["senales_abandono"],
        summary["respuestas_ideales"],
        summary["info_proyectos"],
    )
    return summary
