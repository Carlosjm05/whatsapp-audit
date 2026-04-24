"""Recomputa response_times para leads ya analizados, SIN llamar a Claude.

Cuándo correrlo:
  - Después de cambiar la lógica de cálculo (horario laboral, SLA, etc.).
  - El analyzer normal recomputa solo cuando se re-analiza el lead vía Claude
    (caro). Este script lee los `messages` de cada lead, recalcula con la
    nueva lógica y reescribe la fila de `response_times`. Costo: $0.

Uso:
  docker compose run --rm analyzer python -m src.recompute_metrics
  docker compose run --rm analyzer python -m src.recompute_metrics --limit=10
  docker compose run --rm analyzer python -m src.recompute_metrics --lead-id=<uuid>
"""
from __future__ import annotations

import argparse
import logging
import sys
from typing import List, Optional

import psycopg2.extras

from .analyzer import ParsedMsg, compute_metrics_from_msgs
from . import db as _db


log = logging.getLogger("recompute")


def _setup_logging() -> None:
    logging.basicConfig(
        level="INFO",
        stream=sys.stdout,
        format="[%(asctime)s] [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def _query_dicts(sql: str, params: Optional[list] = None) -> List[dict]:
    with _db.get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params or ())
        return [dict(r) for r in cur.fetchall()]


def _query_one(sql: str, params: Optional[list] = None) -> Optional[dict]:
    rows = _query_dicts(sql, params)
    return rows[0] if rows else None


def _exec(sql: str, params: Optional[list] = None) -> None:
    with _db.cursor() as cur:
        cur.execute(sql, params or ())


def _fetch_completed_leads(limit: Optional[int], only_lead_id: Optional[str]) -> List[dict]:
    sql = """
        SELECT l.id::text AS lead_id, l.conversation_id::text AS conversation_id
          FROM leads l
         WHERE l.analysis_status = 'completed'
    """
    params: list = []
    if only_lead_id:
        sql += " AND l.id = %s::uuid"
        params.append(only_lead_id)
    sql += " ORDER BY l.analyzed_at DESC NULLS LAST"
    if limit:
        sql += " LIMIT %s"
        params.append(limit)
    return _query_dicts(sql, params)


def _fetch_messages(conversation_id: str) -> List[ParsedMsg]:
    """Construye lista de ParsedMsg desde la tabla messages."""
    rows = _query_dicts(
        """SELECT timestamp, sender, message_type, body, media_duration_sec
             FROM messages
            WHERE conversation_id = %s::uuid
              AND message_type IN ('text', 'audio')
            ORDER BY timestamp ASC""",
        [conversation_id],
    )
    msgs: List[ParsedMsg] = []
    for r in rows:
        if r["sender"] == "asesor":
            role = "ASESOR"
        elif r["sender"] == "lead":
            role = "LEAD"
        else:
            continue
        msgs.append(
            ParsedMsg(
                ts=r["timestamp"],
                role=role,
                is_audio=(r["message_type"] == "audio"),
                body=r.get("body") or "",
            )
        )
    return msgs


def _recompute_one(lead_id: str, conversation_id: str) -> bool:
    msgs = _fetch_messages(conversation_id)
    if not msgs:
        log.info("lead %s sin mensajes — skip", lead_id)
        return False

    metrics = compute_metrics_from_msgs(msgs)

    # Preservamos los flags que Claude llenó (lead_had_to_repeat, etc.) — solo
    # recalculamos los tiempos.
    existing = _query_one(
        """SELECT unanswered_messages_count, lead_had_to_repeat, repeat_count
             FROM response_times
            WHERE lead_id = %s::uuid""",
        [lead_id],
    ) or {}

    _exec("DELETE FROM response_times WHERE lead_id = %s::uuid", [lead_id])
    _exec(
        """INSERT INTO response_times
             (lead_id, first_response_minutes, avg_response_minutes,
              longest_gap_hours, unanswered_messages_count,
              lead_had_to_repeat, repeat_count,
              advisor_active_hours, response_time_category,
              sunday_avg_minutes, sunday_response_count)
           VALUES (%s::uuid,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        [
            lead_id,
            metrics.get("first_response_minutes"),
            metrics.get("avg_response_minutes"),
            metrics.get("longest_gap_hours"),
            int(existing.get("unanswered_messages_count") or 0),
            bool(existing.get("lead_had_to_repeat") or False),
            int(existing.get("repeat_count") or 0),
            metrics.get("advisor_active_hours"),
            metrics.get("response_time_category"),
            metrics.get("sunday_response_minutes_avg"),
            int(metrics.get("sunday_response_count") or 0),
        ],
    )
    return True


def main(argv=None) -> int:
    _setup_logging()
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--lead-id", type=str, default=None)
    args = p.parse_args(argv)

    leads = _fetch_completed_leads(args.limit, args.lead_id)
    log.info("Recomputando response_times para %d leads...", len(leads))

    ok = 0
    fail = 0
    for i, l in enumerate(leads, 1):
        try:
            if _recompute_one(l["lead_id"], l["conversation_id"]):
                ok += 1
            if i % 25 == 0:
                log.info("Progreso: %d/%d", i, len(leads))
        except Exception as e:
            fail += 1
            log.error("lead %s fallo: %s", l["lead_id"], e)

    log.info("LISTO. ok=%d fail=%d total=%d", ok, fail, len(leads))
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
