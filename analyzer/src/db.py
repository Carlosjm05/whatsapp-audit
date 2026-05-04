from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional, Set, Tuple

import psycopg2
import psycopg2.extras
from psycopg2 import pool as pg_pool

log = logging.getLogger(__name__)

# Enums compartidos con validator.py — única fuente de verdad.
from .enums import (
    BUDGET_RANGES as BUDGET_RANGES_SET,
    DECISION_MAKERS as DECISION_MAKERS_SET,
    FINAL_STATUSES as FINAL_STATUSES_SET,
    LEAD_SOURCES as LEAD_SOURCES_SET,
    OBJECTION_TYPES as OBJECTION_TYPES_SET,
    PAYMENT_METHODS as PAYMENT_METHODS_SET,
    PRODUCT_TYPES as PRODUCT_TYPES_SET,
    PURPOSES as PURPOSES_SET,
    RECOVERY_PRIORITY as RECOVERY_PRIORITY_SET,
    RECOVERY_PROB as RECOVERY_PROB_SET,
    RESPONSE_TIME_CATEGORIES as RESPONSE_TIME_CATEGORIES_SET,
    URGENCIES as URGENCIES_SET,
    YES_NO_UNKNOWN as YES_NO_UNKNOWN_SET,
)


def _safe_enum(value: Any, allowed: Set[str], default: Optional[str]) -> Optional[str]:
    """Si value cae fuera de allowed, retorna default. Acepta None.
    Coerciona bool → 'si'/'no' para campos YES_NO_UNKNOWN."""
    if value is None:
        return default
    if isinstance(value, bool):
        coerced = "si" if value else "no"
        return coerced if coerced in allowed else default
    if isinstance(value, str):
        s = value.strip()
        if s in allowed:
            return s
        lower = s.lower()
        if lower in allowed:
            return lower
    return default


def _conn_params() -> Dict[str, Any]:
    return {
        "host": os.getenv("POSTGRES_HOST", "postgres"),
        "port": int(os.getenv("POSTGRES_PORT", "5432")),
        "dbname": os.getenv("POSTGRES_DB", "whatsapp_audit"),
        "user": os.getenv("POSTGRES_USER", "wa_admin"),
        "password": os.getenv("POSTGRES_PASSWORD", ""),
    }


_pool: Optional[pg_pool.ThreadedConnectionPool] = None


def _init_pool() -> pg_pool.ThreadedConnectionPool:
    """Crea (idempotente) el pool. Tamaños conservadores para el daemon
    que típicamente trabaja con 1-3 leads en paralelo."""
    global _pool
    if _pool is not None:
        return _pool
    minconn = int(os.getenv("DB_POOL_MIN", "1"))
    maxconn = int(os.getenv("DB_POOL_MAX", "5"))
    _pool = pg_pool.ThreadedConnectionPool(
        minconn=minconn,
        maxconn=maxconn,
        **_conn_params(),
    )
    log.info("Postgres pool listo (analyzer): min=%d max=%d", minconn, maxconn)
    return _pool


def close_pool() -> None:
    """Llamado al shutdown (signal handler). Libera todas las conexiones."""
    global _pool
    if _pool is not None:
        try:
            _pool.closeall()
        except Exception:
            pass
        _pool = None


@contextmanager
def get_conn() -> Iterator[psycopg2.extensions.connection]:
    p = _init_pool()
    conn = p.getconn()
    try:
        yield conn
    finally:
        # Devolver al pool (no cerrar) — resetear estado de transacción.
        try:
            if conn.status != psycopg2.extensions.STATUS_READY:
                conn.rollback()
        except Exception:
            pass
        p.putconn(conn)


@contextmanager
def cursor(commit: bool = True) -> Iterator[psycopg2.extensions.cursor]:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield cur
            if commit:
                conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            cur.close()


# ─── PENDING LEADS ────────────────────────────────────────────
# Registra un lead 'pending' por cada raw_conversation extraída que
# aún no tenga lead. Antes dependía de unified_transcripts (que solo
# crea el transcriber tras terminar las transcripciones de audio),
# bloqueando conversaciones de puro texto o con audios sin transcribir.
def register_pending_leads() -> int:
    sql = """
    INSERT INTO leads (conversation_id, phone, whatsapp_name, analysis_status)
    SELECT rc.id, rc.phone, rc.whatsapp_name, 'pending'
    FROM raw_conversations rc
    WHERE rc.extraction_status = 'extracted'
      AND COALESCE(rc.is_group, false) = false
      AND NOT EXISTS (
          SELECT 1 FROM leads l WHERE l.conversation_id = rc.id
      )
    RETURNING id;
    """
    with cursor() as cur:
        cur.execute(sql)
        return cur.rowcount


# Genera unified_transcripts on-the-fly desde messages para conversaciones
# extraídas que aún no lo tienen. Los audios sin transcripción completa
# quedan como [AUDIO SIN TRANSCRIBIR] — la conversación sigue siendo
# analizable aunque falte alguna transcripción.
def ensure_unified_transcripts() -> int:
    select_sql = """
    SELECT rc.id AS conversation_id
    FROM raw_conversations rc
    WHERE rc.extraction_status = 'extracted'
      AND COALESCE(rc.is_group, false) = false
      AND NOT EXISTS (
          SELECT 1 FROM unified_transcripts ut
          WHERE ut.conversation_id = rc.id
      )
    """
    messages_sql = """
    SELECT m.timestamp, m.sender, m.message_type, m.body,
           m.media_duration_sec,
           t.transcription_text, t.is_low_confidence
    FROM messages m
    LEFT JOIN transcriptions t ON t.message_id = m.id
                               AND t.status = 'completed'
    WHERE m.conversation_id = %s
      AND m.message_type IN ('text', 'audio')
    ORDER BY m.timestamp ASC
    """
    created = 0
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(select_sql)
        conv_ids = [r["conversation_id"] for r in cur.fetchall()]

        for cid in conv_ids:
            cur.execute(messages_sql, (cid,))
            msgs = cur.fetchall()
            if not msgs:
                continue

            lines: List[str] = []
            from_lead = 0
            from_asesor = 0
            audios_included = 0
            audios_failed = 0

            for m in msgs:
                ts = m["timestamp"].strftime("%Y-%m-%d %H:%M") if m["timestamp"] else "????-??-?? ??:??"
                role = "LEAD" if m["sender"] == "lead" else "ASESOR"
                if m["sender"] == "lead":
                    from_lead += 1
                else:
                    from_asesor += 1

                if m["message_type"] == "text" and m["body"]:
                    lines.append(f"[{ts}] {role}: {m['body']}")
                elif m["message_type"] == "audio":
                    duration = m.get("media_duration_sec") or 0
                    if m.get("transcription_text"):
                        note = " [BAJA CONFIANZA]" if m.get("is_low_confidence") else ""
                        lines.append(
                            f"[{ts}] {role} (audio {duration}s{note}): {m['transcription_text']}"
                        )
                        audios_included += 1
                    else:
                        lines.append(f"[{ts}] {role} (audio {duration}s): [AUDIO SIN TRANSCRIBIR]")
                        audios_failed += 1

            full = "\n\n".join(lines)
            word_count = len(full.split())

            cur.execute(
                """INSERT INTO unified_transcripts
                     (conversation_id, full_transcript, total_messages,
                      total_from_lead, total_from_asesor,
                      total_audios_included, total_audios_failed, word_count)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (conversation_id) DO NOTHING""",
                (cid, full, len(msgs), from_lead, from_asesor,
                 audios_included, audios_failed, word_count),
            )
            if cur.rowcount > 0:
                created += 1

        conn.commit()
    return created


def fetch_pending_leads(limit: Optional[int] = None) -> List[Dict[str, Any]]:
    sql = """
    SELECT l.id AS lead_id,
           l.conversation_id,
           l.phone,
           l.whatsapp_name,
           COALESCE(l.analysis_retry_count, 0) AS analysis_retry_count,
           ut.full_transcript,
           ut.word_count,
           rc.first_message_at,
           rc.last_message_at
    FROM leads l
    JOIN unified_transcripts ut ON ut.conversation_id = l.conversation_id
    JOIN raw_conversations rc ON rc.id = l.conversation_id
    WHERE l.analysis_status = 'pending'
      AND COALESCE(l.analysis_retry_count, 0) < %s
    ORDER BY l.created_at ASC
    """
    max_retries = int(os.getenv("MAX_RETRIES", "3"))
    params: List[Any] = [max_retries]
    if limit:
        sql += " LIMIT %s"
        params.append(int(limit))
    with cursor(commit=False) as cur:
        cur.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]


def mark_status(lead_id: str, status: str,
                retry_count: Optional[int] = None,
                error: Optional[str] = None) -> None:
    fields = ["analysis_status=%s", "updated_at=NOW()"]
    vals: List[Any] = [status]
    if status == "completed":
        fields.append("analyzed_at=NOW()")
        fields.append("analysis_error=NULL")
    if retry_count is not None:
        fields.append("analysis_retry_count=%s")
        vals.append(retry_count)
    if error is not None:
        fields.append("analysis_error=%s")
        vals.append(error[:2000])
    vals.append(lead_id)
    with cursor() as cur:
        cur.execute(f"UPDATE leads SET {', '.join(fields)} WHERE id=%s", vals)


def get_retry_count(lead_id: str) -> int:
    with cursor(commit=False) as cur:
        cur.execute(
            "SELECT COALESCE(analysis_retry_count,0) AS rc FROM leads WHERE id=%s",
            (lead_id,),
        )
        row = cur.fetchone()
        return int(row["rc"]) if row else 0


def write_triage_verdict(lead_id: str, conversation_id: str, verdict: str,
                         summary_text: str, model_used: str,
                         cost_usd: float) -> None:
    """Escribe el resultado del triage de Haiku ATÓMICAMENTE.

    Una única transacción cubre:
      - update leads.analysis_status
      - rewrite conversation_summaries (UNIQUE lead_id)
      - rewrite conversation_outcomes  (UNIQUE lead_id)
      - lead_analysis_history: promote pending→processing (si existe),
        luego completed. Si no existe fila pending, crea una directamente
        como completed para no dejar zombies.

    Así si la transacción falla, NINGÚN paso queda aplicado — no hay
    estado intermedio para limpiar.
    """
    valid = {"spam", "numero_equivocado", "datos_insuficientes"}
    if verdict not in valid:
        raise ValueError(f"verdict inválido: {verdict}")

    with get_conn() as conn:
        try:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            # 1) leads
            cur.execute(
                """UPDATE leads SET
                     analysis_status='insufficient_data',
                     datos_insuficientes=true,
                     analyzed_at=NOW(),
                     updated_at=NOW()
                   WHERE id=%s""",
                (lead_id,),
            )
            # 2) conversation_summaries (UNIQUE lead_id → delete+insert)
            cur.execute("DELETE FROM conversation_summaries WHERE lead_id=%s", (lead_id,))
            cur.execute(
                """INSERT INTO conversation_summaries
                     (lead_id, conversation_id, summary_text, key_takeaways)
                   VALUES (%s, %s, %s, %s)""",
                (lead_id, conversation_id, summary_text[:1000], []),
            )
            # 3) conversation_outcomes (UNIQUE lead_id → delete+insert)
            cur.execute("DELETE FROM conversation_outcomes WHERE lead_id=%s", (lead_id,))
            cur.execute(
                """INSERT INTO conversation_outcomes
                     (lead_id, final_status, is_recoverable,
                      recovery_probability, recovery_priority, perdido_por,
                      ghost_score)
                   VALUES (%s, %s, FALSE, 'no_aplica', 'no_aplica', 'no_aplica', 0)""",
                (lead_id, verdict),
            )
            # 4) lead_analysis_history: promover pending a completed, o
            # insertar directo como completed si no existía.
            cur.execute(
                """UPDATE lead_analysis_history
                     SET status='completed',
                         completed_at=NOW(),
                         model_used=%s,
                         cost_usd=%s
                   WHERE id = (
                     SELECT id FROM lead_analysis_history
                      WHERE lead_id=%s AND status IN ('pending','processing')
                      ORDER BY started_at DESC
                      LIMIT 1
                   )
                   RETURNING id""",
                (model_used, cost_usd, lead_id),
            )
            if cur.rowcount == 0:
                cur.execute(
                    """INSERT INTO lead_analysis_history
                         (lead_id, triggered_by, status, model_used,
                          cost_usd, started_at, completed_at)
                       VALUES (%s, 'triage', 'completed', %s, %s, NOW(), NOW())""",
                    (lead_id, model_used, cost_usd),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def get_lead_history_by_phone(phone: str, exclude_lead_id: str) -> List[Dict[str, Any]]:
    """Devuelve leads previos del MISMO número de teléfono (distintos del
    actual). Usado como contexto cruzado: si un lead ya vino antes y se
    enfrió por precio, eso es información valiosa para el análisis nuevo.

    Retorna hasta 5 leads, ordenados por fecha de último contacto DESC.
    Solo incluye los que ya fueron analizados (analysis_status='completed')
    para no pasar basura sin outcome.
    """
    if not phone or not phone.strip():
        return []
    with cursor(commit=False) as cur:
        cur.execute(
            """SELECT
                 l.id::text AS lead_id,
                 to_char(l.first_contact_at, 'YYYY-MM-DD') AS first_contact,
                 to_char(l.last_contact_at,  'YYYY-MM-DD') AS last_contact,
                 l.conversation_days,
                 co.final_status,
                 co.perdido_por,
                 li.intent_score,
                 lin.project_name,
                 lf.budget_estimated_cop
                 FROM leads l
                 LEFT JOIN conversation_outcomes co ON co.lead_id = l.id
                 LEFT JOIN lead_intent li ON li.lead_id = l.id
                 LEFT JOIN lead_interests lin ON lin.lead_id = l.id
                 LEFT JOIN lead_financials lf ON lf.lead_id = l.id
                WHERE l.phone = %s
                  AND l.id <> %s::uuid
                  AND l.analysis_status = 'completed'
                ORDER BY l.last_contact_at DESC NULLS LAST
                LIMIT 5""",
            (phone, exclude_lead_id),
        )
        return [dict(r) for r in cur.fetchall()]


def count_recent_transient_failures(lead_id: str, hours: int = 24) -> int:
    """Cuenta cuántas entradas de 'failed (transitorio:)' tuvo el lead en
    las últimas N horas. Si es alto, ya no es transitorio — probablemente
    la API key está rota, el proyecto sin cuota, o el chat rompe al modelo.
    El caller debe escalar a 'failed' duro cuando supere un umbral."""
    with cursor(commit=False) as cur:
        cur.execute(
            """SELECT COUNT(*)::int AS c
                 FROM lead_analysis_history
                WHERE lead_id = %s
                  AND status = 'failed'
                  AND error_message LIKE 'transitorio:%%'
                  AND started_at >= NOW() - (%s || ' hours')::interval""",
            (lead_id, hours),
        )
        row = cur.fetchone()
        return int(row["c"]) if row else 0


# ─── HISTORIAL DE ANÁLISIS (lead_analysis_history) ────────────
# El API `/api/leads/{id}/reanalyze` crea una fila 'pending' en esta
# tabla; el analyzer la promociona a 'processing' al empezar y a
# 'completed'/'failed' al terminar. Si NO hay fila pendiente (caso
# corrida automática del daemon), `mark_history_processing` la crea
# en estado 'processing' para garantizar que el costo y resultado
# queden trackeados aunque el análisis no se haya pedido manualmente.

def mark_history_processing(lead_id: str, triggered_by: str = "auto") -> None:
    with cursor() as cur:
        cur.execute(
            """UPDATE lead_analysis_history
                 SET status='processing'
               WHERE id = (
                 SELECT id FROM lead_analysis_history
                  WHERE lead_id=%s AND status='pending'
                  ORDER BY started_at ASC
                  LIMIT 1
               )
               RETURNING id""",
            (lead_id,),
        )
        if cur.rowcount == 0:
            # No había fila pending → crear una directamente como 'processing'.
            # Esto pasa cuando el analyzer corre solo (daemon o batch CLI) sin
            # que el dashboard haya marcado el lead para reanálisis primero.
            cur.execute(
                """INSERT INTO lead_analysis_history
                     (lead_id, triggered_by, status, started_at)
                   VALUES (%s, %s, 'processing', NOW())""",
                (lead_id, triggered_by),
            )


def mark_history_completed(lead_id: str, model_used: str,
                           cost_usd: float) -> None:
    with cursor() as cur:
        cur.execute(
            """UPDATE lead_analysis_history
                 SET status='completed',
                     completed_at=NOW(),
                     model_used=%s,
                     cost_usd=%s
               WHERE id = (
                 SELECT id FROM lead_analysis_history
                  WHERE lead_id=%s AND status='processing'
                  ORDER BY started_at DESC
                  LIMIT 1
               )""",
            (model_used, cost_usd, lead_id),
        )


def mark_history_failed(lead_id: str, error: str) -> None:
    with cursor() as cur:
        cur.execute(
            """UPDATE lead_analysis_history
                 SET status='failed',
                     completed_at=NOW(),
                     error_message=%s
               WHERE id = (
                 SELECT id FROM lead_analysis_history
                  WHERE lead_id=%s AND status IN ('pending', 'processing')
                  ORDER BY started_at DESC
                  LIMIT 1
               )""",
            (error[:2000] if error else None, lead_id),
        )


# ─── INSUFFICIENT DATA ────────────────────────────────────────
def write_insufficient(lead_id: str, conversation_id: str, summary_text: str) -> None:
    with cursor() as cur:
        cur.execute(
            """UPDATE leads SET
                 analysis_status='insufficient_data',
                 datos_insuficientes=true,
                 analyzed_at=NOW(),
                 updated_at=NOW()
               WHERE id=%s""",
            (lead_id,),
        )
        cur.execute("DELETE FROM conversation_summaries WHERE lead_id=%s", (lead_id,))
        cur.execute(
            """INSERT INTO conversation_summaries
                 (lead_id, conversation_id, summary_text, key_takeaways)
               VALUES (%s, %s, %s, %s)""",
            (lead_id, conversation_id, summary_text, []),
        )
        cur.execute("DELETE FROM conversation_outcomes WHERE lead_id=%s", (lead_id,))
        cur.execute(
            """INSERT INTO conversation_outcomes
                 (lead_id, final_status, is_recoverable, recovery_probability, recovery_priority)
               VALUES (%s, 'datos_insuficientes', false, 'no_aplica', 'no_aplica')""",
            (lead_id,),
        )


# ─── PERSIST FULL ANALYSIS ────────────────────────────────────
def persist_analysis(
    lead_id: str,
    conversation_id: str,
    data: Dict[str, Any],
    computed: Dict[str, Any],
) -> None:
    """Persist the full Claude analysis atomically.

    Child tables don't have UNIQUE(lead_id), so we DELETE-then-INSERT.
    """
    with get_conn() as conn:
        try:
            with conn.cursor() as cur:
                lead = data.get("lead", {}) or {}
                _AGE_RANGES = {"18-25","25-35","35-50","50-65","65+","desconocido"}
                _ANALYSIS_CONF = {"alta","media","baja"}
                cur.execute(
                    """UPDATE leads SET
                         real_name=%s, city=%s, zone=%s,
                         occupation=%s, age_range=%s, family_context=%s,
                         analysis_confidence=%s,
                         lead_source=%s, lead_source_detail=%s,
                         first_contact_at=%s, last_contact_at=%s,
                         conversation_days=%s,
                         datos_insuficientes=%s,
                         analysis_status='completed',
                         analysis_error=NULL,
                         analyzed_at=NOW(),
                         updated_at=NOW()
                       WHERE id=%s""",
                    (
                        lead.get("real_name"), lead.get("city"), lead.get("zone"),
                        (lead.get("occupation") or None),
                        _safe_enum(lead.get("age_range"), _AGE_RANGES, None),
                        (lead.get("family_context") or None),
                        _safe_enum(lead.get("analysis_confidence"), _ANALYSIS_CONF, None),
                        _safe_enum(lead.get("lead_source"), LEAD_SOURCES_SET, "desconocido"),
                        lead.get("lead_source_detail"),
                        computed.get("first_contact_at") or lead.get("first_contact_at"),
                        computed.get("last_contact_at") or lead.get("last_contact_at"),
                        computed.get("conversation_days") or lead.get("conversation_days"),
                        bool(lead.get("datos_insuficientes", False)),
                        lead_id,
                    ),
                )

                # ─── lead_interests ──────────────────────────
                i = data.get("interest", {}) or {}
                cur.execute("DELETE FROM lead_interests WHERE lead_id=%s", (lead_id,))
                cur.execute(
                    """INSERT INTO lead_interests
                         (lead_id, product_type, project_name, all_projects_mentioned,
                          desired_zone, desired_size, desired_features, purpose,
                          specific_conditions)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (
                        lead_id,
                        _safe_enum(i.get("product_type"), PRODUCT_TYPES_SET, "otro"),
                        i.get("project_name"),
                        i.get("all_projects_mentioned") or [],
                        i.get("desired_zone"), i.get("desired_size"),
                        i.get("desired_features"),
                        _safe_enum(i.get("purpose"), PURPOSES_SET, "no_especificado"),
                        i.get("specific_conditions"),
                    ),
                )

                # ─── lead_financials ─────────────────────────
                f = data.get("financials", {}) or {}
                cur.execute("DELETE FROM lead_financials WHERE lead_id=%s", (lead_id,))
                cur.execute(
                    """INSERT INTO lead_financials
                         (lead_id, budget_verbatim, budget_estimated_cop, budget_range,
                          payment_method, has_bank_preapproval, offers_trade_in,
                          depends_on_selling,
                          positive_financial_signals, negative_financial_signals)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (
                        lead_id, f.get("budget_verbatim"), f.get("budget_estimated_cop"),
                        _safe_enum(f.get("budget_range"), BUDGET_RANGES_SET, "no_especificado"),
                        _safe_enum(f.get("payment_method"), PAYMENT_METHODS_SET, "no_especificado"),
                        _safe_enum(f.get("has_bank_preapproval"), YES_NO_UNKNOWN_SET, "desconocido"),
                        _safe_enum(f.get("offers_trade_in"), YES_NO_UNKNOWN_SET, "desconocido"),
                        _safe_enum(f.get("depends_on_selling"), YES_NO_UNKNOWN_SET, "desconocido"),
                        f.get("positive_financial_signals") or [],
                        f.get("negative_financial_signals") or [],
                    ),
                )

                # ─── lead_intent ─────────────────────────────
                it = data.get("intent", {}) or {}
                cur.execute("DELETE FROM lead_intent WHERE lead_id=%s", (lead_id,))
                cur.execute(
                    """INSERT INTO lead_intent
                         (lead_id, intent_score, intent_justification, urgency,
                          high_urgency_signals, low_urgency_signals,
                          is_decision_maker, comparing_competitors)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (
                        lead_id, it.get("intent_score"), it.get("intent_justification"),
                        _safe_enum(it.get("urgency"), URGENCIES_SET, "no_especificado"),
                        it.get("high_urgency_signals") or [],
                        it.get("low_urgency_signals") or [],
                        _safe_enum(it.get("is_decision_maker"), DECISION_MAKERS_SET, "desconocido"),
                        bool(it.get("comparing_competitors", False)),
                    ),
                )

                # ─── lead_objections (multi-row) ─────────────
                cur.execute("DELETE FROM lead_objections WHERE lead_id=%s", (lead_id,))
                for ob in (data.get("objections") or []):
                    cur.execute(
                        """INSERT INTO lead_objections
                             (lead_id, objection_text, objection_verbatim, objection_type,
                              was_resolved, advisor_response, response_quality,
                              is_hidden_objection)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (
                            lead_id, ob.get("objection_text"),
                            ob.get("objection_verbatim"),
                            _safe_enum(ob.get("objection_type"), OBJECTION_TYPES_SET, "otro"),
                            bool(ob.get("was_resolved", False)),
                            ob.get("advisor_response"),
                            ob.get("response_quality"),
                            bool(ob.get("is_hidden_objection", False)),
                        ),
                    )

                # ─── conversation_metrics ────────────────────
                m = data.get("metrics", {}) or {}
                cur.execute(
                    "DELETE FROM conversation_metrics WHERE lead_id=%s", (lead_id,)
                )
                cur.execute(
                    """INSERT INTO conversation_metrics
                         (lead_id, conversation_id,
                          total_messages, advisor_messages, lead_messages,
                          advisor_audios, lead_audios,
                          sent_project_info, sent_prices,
                          asked_qualification_questions, offered_alternatives,
                          proposed_visit, attempted_close,
                          did_followup, followup_attempts,
                          used_generic_messages, answered_all_questions,
                          unanswered_questions)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (
                        lead_id, conversation_id,
                        computed.get("total_messages", m.get("total_messages", 0)),
                        computed.get("advisor_messages", m.get("advisor_messages", 0)),
                        computed.get("lead_messages", m.get("lead_messages", 0)),
                        computed.get("advisor_audios", m.get("advisor_audios", 0)),
                        computed.get("lead_audios", m.get("lead_audios", 0)),
                        bool(m.get("sent_project_info", False)),
                        bool(m.get("sent_prices", False)),
                        bool(m.get("asked_qualification_questions", False)),
                        bool(m.get("offered_alternatives", False)),
                        bool(m.get("proposed_visit", False)),
                        bool(m.get("attempted_close", False)),
                        bool(m.get("did_followup", False)),
                        int(m.get("followup_attempts", 0) or 0),
                        bool(m.get("used_generic_messages", False)),
                        bool(m.get("answered_all_questions", False)),
                        m.get("unanswered_questions") or [],
                    ),
                )

                # ─── response_times ──────────────────────────
                rt = data.get("response_times", {}) or {}
                cur.execute("DELETE FROM response_times WHERE lead_id=%s", (lead_id,))
                cur.execute(
                    """INSERT INTO response_times
                         (lead_id, first_response_minutes, avg_response_minutes,
                          longest_gap_hours, unanswered_messages_count,
                          lead_had_to_repeat, repeat_count,
                          advisor_active_hours, response_time_category,
                          sunday_avg_minutes, sunday_response_count)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (
                        lead_id,
                        computed.get("first_response_minutes", rt.get("first_response_minutes")),
                        computed.get("avg_response_minutes", rt.get("avg_response_minutes")),
                        computed.get("longest_gap_hours", rt.get("longest_gap_hours")),
                        int(rt.get("unanswered_messages_count", 0) or 0),
                        bool(rt.get("lead_had_to_repeat", False)),
                        int(rt.get("repeat_count", 0) or 0),
                        computed.get("advisor_active_hours") or rt.get("advisor_active_hours"),
                        _safe_enum(
                            computed.get("response_time_category") or rt.get("response_time_category"),
                            RESPONSE_TIME_CATEGORIES_SET,
                            "regular",
                        ),
                        computed.get("sunday_response_minutes_avg"),
                        int(computed.get("sunday_response_count", 0) or 0),
                    ),
                )

                # ─── advisor_scores ──────────────────────────
                a = data.get("advisor", {}) or {}
                # speed_compliance derivado: si la app detectó violaciones,
                # forzar False (el LLM no puede mentir aquí).
                violations = int(computed.get("sla_violations_count", 0) or 0)
                speed_compliance_val = a.get("speed_compliance")
                if violations > 0:
                    speed_compliance_val = False
                elif speed_compliance_val is None:
                    # Sin violaciones calculadas y sin info del LLM:
                    # asumimos compliance si hubo al menos una respuesta.
                    speed_compliance_val = True

                followup_compliance_val = a.get("followup_compliance")
                # Si did_followup del LLM es False y el asesor dejó colgado,
                # forzar followup_compliance=False.
                m_block = data.get("metrics", {}) or {}
                if m_block.get("did_followup") is False:
                    followup_compliance_val = False

                cur.execute("DELETE FROM advisor_scores WHERE lead_id=%s", (lead_id,))
                # Asesores no identificados se agrupan bajo "General" para que
                # entren al ranking y métricas. Sin esto, los nulls quedaban
                # fuera de las queries con WHERE advisor_name IS NOT NULL.
                _adv_name = (a.get("advisor_name") or "").strip()
                if not _adv_name:
                    _adv_name = "General"
                _adv_involved = a.get("advisors_involved") or []
                # Si la lista de involucrados está vacía, también marcar General.
                if not _adv_involved:
                    _adv_involved = [_adv_name]
                cur.execute(
                    """INSERT INTO advisor_scores
                         (lead_id, conversation_id,
                          advisor_name, advisors_involved, advisor_phone,
                          speed_score, qualification_score, product_presentation_score,
                          objection_handling_score, closing_attempt_score, followup_score,
                          overall_score,
                          speed_compliance, followup_compliance,
                          errors_list, strengths_list)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (
                        lead_id, conversation_id,
                        _adv_name,
                        _adv_involved,
                        a.get("advisor_phone"),
                        a.get("speed_score"), a.get("qualification_score"),
                        a.get("product_presentation_score"),
                        a.get("objection_handling_score"),
                        a.get("closing_attempt_score"),
                        a.get("followup_score"),
                        a.get("overall_score"),
                        speed_compliance_val,
                        followup_compliance_val,
                        a.get("errors_list") or [],
                        a.get("strengths_list") or [],
                    ),
                )

                # ─── conversation_outcomes ───────────────────
                o = data.get("outcome", {}) or {}
                cur.execute(
                    "DELETE FROM conversation_outcomes WHERE lead_id=%s", (lead_id,)
                )
                _PERDIDO_POR = {
                    "asesor_lento","asesor_sin_seguimiento","asesor_no_califico",
                    "asesor_no_cerro","asesor_info_incompleta",
                    "asesor_no_consulto_de_vuelta",
                    "lead_desaparecio","lead_fuera_portafolio","lead_sin_decision",
                    "lead_presupuesto","lead_competencia","ambos","no_aplica",
                }
                # Ghost score (#10): calculado en Python para poder
                # ordenar /ghosts por ROI de recuperación sin tener que
                # computar-en-SQL pesos complejos.
                from .ghost_score import compute_from_analysis
                _last_contact = data.get("_last_contact_at") or o.get("_last_contact_at")
                g_score = compute_from_analysis(data, _last_contact)

                cur.execute(
                    """INSERT INTO conversation_outcomes
                         (lead_id, final_status, loss_reason, loss_point_description,
                          loss_point_verbatim, peak_intent_verbatim,
                          is_recoverable, recovery_probability,
                          recovery_reason, not_recoverable_reason,
                          recovery_strategy, recovery_message_suggestion,
                          alternative_product, recovery_priority,
                          perdido_por, next_concrete_action, ghost_score)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (
                        lead_id,
                        _safe_enum(o.get("final_status"), FINAL_STATUSES_SET, "nunca_calificado"),
                        o.get("loss_reason"),
                        o.get("loss_point_description"),
                        o.get("loss_point_verbatim"),
                        o.get("peak_intent_verbatim"),
                        bool(o.get("is_recoverable", False)),
                        _safe_enum(o.get("recovery_probability"), RECOVERY_PROB_SET, "no_aplica"),
                        o.get("recovery_reason"),
                        o.get("not_recoverable_reason"),
                        o.get("recovery_strategy"),
                        o.get("recovery_message_suggestion"),
                        o.get("alternative_product"),
                        _safe_enum(o.get("recovery_priority"), RECOVERY_PRIORITY_SET, "no_aplica"),
                        _safe_enum(o.get("perdido_por"), _PERDIDO_POR, None),
                        o.get("next_concrete_action"),
                        g_score,
                    ),
                )

                # ─── competitor_intel (multi-row) ────────────
                cur.execute("DELETE FROM competitor_intel WHERE lead_id=%s", (lead_id,))
                for c in (data.get("competitors") or []):
                    cur.execute(
                        """INSERT INTO competitor_intel
                             (lead_id, competitor_name, competitor_offer,
                              why_considering, went_with_competitor,
                              reason_chose_competitor)
                           VALUES (%s,%s,%s,%s,%s,%s)""",
                        (
                            lead_id, c.get("competitor_name"),
                            c.get("competitor_offer"), c.get("why_considering"),
                            bool(c.get("went_with_competitor", False)),
                            c.get("reason_chose_competitor"),
                        ),
                    )

                # ─── conversation_summaries (UNIQUE(lead_id)) ─
                s = data.get("summary", {}) or {}
                cur.execute(
                    """INSERT INTO conversation_summaries
                         (lead_id, conversation_id, summary_text, key_takeaways)
                       VALUES (%s,%s,%s,%s)
                       ON CONFLICT (lead_id) DO UPDATE SET
                         summary_text=EXCLUDED.summary_text,
                         key_takeaways=EXCLUDED.key_takeaways""",
                    (
                        lead_id, conversation_id,
                        s.get("summary_text") or "",
                        s.get("key_takeaways") or [],
                    ),
                )

            conn.commit()
        except Exception:
            conn.rollback()
            raise


# ─── SYSTEM LOG ───────────────────────────────────────────────
# Antes escribía a tabla system_logs; la tabla fue eliminada en Fase 3
# por ser código muerto (nadie la consultaba). Los callers siguen
# llamando esta función — redirigimos al logger de Python.
import logging as _logging
_sys_log = _logging.getLogger("analyzer.system")


def log_system(level: str, message: str,
               details: Optional[Dict[str, Any]] = None) -> None:
    lvl = (level or "info").lower()
    log_fn = getattr(_sys_log, lvl, _sys_log.info)
    if details:
        log_fn("%s %s", message, details)
    else:
        log_fn("%s", message)


# ─── STATS ────────────────────────────────────────────────────
def stats_summary() -> Dict[str, int]:
    with cursor(commit=False) as cur:
        cur.execute(
            """SELECT analysis_status, COUNT(*) AS n
               FROM leads GROUP BY analysis_status"""
        )
        return {r["analysis_status"]: int(r["n"]) for r in cur.fetchall()}


# ─── KNOWLEDGE BASE AGGREGATION ───────────────────────────────
def fetch_analyzed_for_kb() -> List[Dict[str, Any]]:
    sql = """
    SELECT l.id, l.real_name, l.city, l.zone,
           li.product_type, li.project_name, li.all_projects_mentioned,
           lf.budget_range, lf.budget_estimated_cop,
           lin.intent_score, lin.urgency,
           lf.positive_financial_signals, lf.negative_financial_signals,
           lin.high_urgency_signals, lin.low_urgency_signals,
           co.final_status, co.is_recoverable,
           cs.key_takeaways, cs.summary_text
    FROM leads l
    LEFT JOIN lead_interests li ON li.lead_id = l.id
    LEFT JOIN lead_financials lf ON lf.lead_id = l.id
    LEFT JOIN lead_intent lin ON lin.lead_id = l.id
    LEFT JOIN conversation_outcomes co ON co.lead_id = l.id
    LEFT JOIN conversation_summaries cs ON cs.lead_id = l.id
    WHERE l.analysis_status='completed'
    """
    with cursor(commit=False) as cur:
        cur.execute(sql)
        return [dict(r) for r in cur.fetchall()]


def fetch_top_objections(limit: int = 20) -> List[Dict[str, Any]]:
    """Agrupa objeciones por tipo con ejemplos verbatim y source leads."""
    with cursor(commit=False) as cur:
        cur.execute(
            """SELECT objection_type,
                      COUNT(*) AS n,
                      (ARRAY_AGG(DISTINCT objection_verbatim)
                          FILTER (WHERE objection_verbatim IS NOT NULL))[1:5] AS examples,
                      ARRAY_AGG(DISTINCT lead_id) AS leads
               FROM lead_objections
               WHERE objection_type IS NOT NULL
               GROUP BY objection_type
               ORDER BY n DESC
               LIMIT %s""",
            (limit,),
        )
        return [dict(r) for r in cur.fetchall()]


def fetch_top_unanswered(limit: int = 50) -> List[Dict[str, Any]]:
    with cursor(commit=False) as cur:
        cur.execute(
            """SELECT q, COUNT(*) AS n
               FROM (
                 SELECT UNNEST(unanswered_questions) AS q, lead_id
                 FROM conversation_metrics
               ) t
               WHERE q IS NOT NULL AND LENGTH(q) > 0
               GROUP BY q
               ORDER BY n DESC
               LIMIT %s""",
            (limit,),
        )
        return [dict(r) for r in cur.fetchall()]


def fetch_ideal_responses(min_quality: int = 8, limit: int = 50) -> List[Dict[str, Any]]:
    """Devuelve respuestas de asesor con calidad alta (>=8) para alimentar
    la KB como entry_type='respuesta_ideal'. Útil para que Dapta replique
    lo que ya funciona."""
    with cursor(commit=False) as cur:
        cur.execute(
            """SELECT
                 objection_type,
                 advisor_response,
                 MAX(response_quality) AS quality,
                 COUNT(*) AS n,
                 ARRAY_AGG(DISTINCT lead_id::text) AS leads
               FROM lead_objections
               WHERE advisor_response IS NOT NULL
                 AND LENGTH(advisor_response) > 10
                 AND response_quality >= %s
               GROUP BY objection_type, advisor_response
               ORDER BY quality DESC, n DESC
               LIMIT %s""",
            (min_quality, limit),
        )
        return [dict(r) for r in cur.fetchall()]


def _valid_uuids(values: Any) -> List[str]:
    """Filtra una lista para dejar solo strings que sean UUIDs válidos.
    Los elementos malformados se descartan silenciosamente."""
    import uuid as _uuid
    if not values:
        return []
    out: List[str] = []
    for v in values:
        if not v:
            continue
        try:
            # uuid.UUID() valida formato y normaliza
            out.append(str(_uuid.UUID(str(v))))
        except (ValueError, AttributeError):
            continue
    return out


def upsert_kb_entries(entries: List[Dict[str, Any]]) -> int:
    """Inserta (o reemplaza) filas en dapta_knowledge_base.

    Cada entry: {entry_type, category, content_text, verbatim_examples[],
                 frequency_count, related_project, ideal_response, source_leads[]}
    """
    if not entries:
        return 0
    with cursor() as cur:
        # Reemplazamos todo: knowledge base es regenerado cada corrida.
        cur.execute("TRUNCATE dapta_knowledge_base")
        for e in entries:
            # source_leads es uuid[] en DB — cast explícito del text[] al
            # tipo correcto. Validamos los UUIDs primero para evitar
            # InvalidTextRepresentation si viene algún string malformado.
            source_leads = _valid_uuids(e.get("source_leads"))
            cur.execute(
                """INSERT INTO dapta_knowledge_base
                     (entry_type, category, content_text, verbatim_examples,
                      frequency_count, related_project, ideal_response, source_leads)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s::uuid[])""",
                (
                    e["entry_type"],
                    e.get("category"),
                    e["content_text"],
                    e.get("verbatim_examples") or [],
                    int(e.get("frequency_count", 1)),
                    e.get("related_project"),
                    e.get("ideal_response"),
                    source_leads,
                ),
            )
    return len(entries)
