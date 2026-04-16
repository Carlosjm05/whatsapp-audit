from __future__ import annotations

import json
import logging
import os
import re
import signal
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
from statistics import mean
from typing import Any, Dict, List, Optional, Tuple

import anthropic
from tenacity import (
    RetryError,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from . import db
from .prompt import SYSTEM_PROMPT
from .validator import AnalysisOutput


log = logging.getLogger("analyzer")

CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-5")
NUM_WORKERS = int(os.getenv("ANALYZER_WORKERS", os.getenv("NUM_WORKERS", "2")))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
MIN_WORDS = 20
# Umbral aproximado para truncar transcripts muy largos (en caracteres).
# 4 chars/token × 180k tokens de contexto = ~720k. Dejamos margen para
# system prompt (~3k tokens) + max_tokens salida (8k) + hints.
# 600k chars ≈ 150k tokens de entrada — seguro para Sonnet 4.5.
MAX_TRANSCRIPT_CHARS = 600_000

INPUT_TOK_COST = 3.0 / 1_000_000
OUTPUT_TOK_COST = 15.0 / 1_000_000
CACHE_READ_COST = 0.30 / 1_000_000
CACHE_WRITE_COST = 3.75 / 1_000_000

_shutdown = threading.Event()


def _install_signals() -> None:
    def _h(signum, frame):
        log.warning("received signal %s, draining workers", signum)
        _shutdown.set()
    for s in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(s, _h)
        except Exception:
            pass


LINE_RE = re.compile(
    r"^\[(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]\s+(?P<role>LEAD|ASESOR)"
    r"(?:\s*\((?P<meta>[^)]*)\))?\s*:\s*(?P<body>.*)$"
)


@dataclass
class ParsedMsg:
    ts: datetime
    role: str
    is_audio: bool
    body: str


def parse_transcript(text: str) -> List[ParsedMsg]:
    out: List[ParsedMsg] = []
    for line in text.splitlines():
        m = LINE_RE.match(line.strip())
        if not m:
            continue
        try:
            ts = datetime.strptime(m.group("ts"), "%Y-%m-%d %H:%M")
        except ValueError:
            continue
        meta = (m.group("meta") or "").lower()
        out.append(ParsedMsg(
            ts=ts,
            role=m.group("role"),
            is_audio="audio" in meta,
            body=m.group("body"),
        ))
    return out


def compute_metrics(text: str) -> Dict[str, Any]:
    msgs = parse_transcript(text)
    if not msgs:
        return {
            "total_messages": 0, "advisor_messages": 0, "lead_messages": 0,
            "advisor_audios": 0, "lead_audios": 0,
        }
    total = len(msgs)
    advisor = [m for m in msgs if m.role == "ASESOR"]
    lead = [m for m in msgs if m.role == "LEAD"]
    first_ts = msgs[0].ts
    last_ts = msgs[-1].ts
    conversation_days = max(1, (last_ts.date() - first_ts.date()).days + 1)

    first_lead_ts: Optional[datetime] = None
    first_response_minutes: Optional[float] = None
    response_gaps: List[float] = []
    longest_gap_hours: Optional[float] = None

    for i, m in enumerate(msgs):
        if m.role == "LEAD" and first_lead_ts is None:
            first_lead_ts = m.ts
        if (m.role == "ASESOR" and first_lead_ts is not None
                and first_response_minutes is None):
            first_response_minutes = (m.ts - first_lead_ts).total_seconds() / 60.0

    for i in range(1, len(msgs)):
        prev, cur = msgs[i-1], msgs[i]
        if prev.role == "LEAD" and cur.role == "ASESOR":
            gap = (cur.ts - prev.ts).total_seconds() / 60.0
            response_gaps.append(gap)

    avg_resp = round(mean(response_gaps), 2) if response_gaps else None

    for i in range(1, len(msgs)):
        gap = (msgs[i].ts - msgs[i-1].ts).total_seconds() / 3600.0
        if longest_gap_hours is None or gap > longest_gap_hours:
            longest_gap_hours = gap
    if longest_gap_hours is not None:
        longest_gap_hours = round(longest_gap_hours, 2)

    if first_response_minutes is None:
        cat = "critico"
    elif first_response_minutes <= 5:
        cat = "excelente"
    elif first_response_minutes <= 30:
        cat = "bueno"
    elif first_response_minutes <= 120:
        cat = "regular"
    elif first_response_minutes <= 60 * 24:
        cat = "malo"
    else:
        cat = "critico"

    hour_counts: Dict[int, int] = {}
    for m in advisor:
        hour_counts[m.ts.hour] = hour_counts.get(m.ts.hour, 0) + 1
    active = ",".join(f"{h}:{hour_counts[h]}" for h in sorted(hour_counts)) or None

    return {
        "total_messages": total,
        "advisor_messages": len(advisor),
        "lead_messages": len(lead),
        "advisor_audios": sum(1 for m in advisor if m.is_audio),
        "lead_audios": sum(1 for m in lead if m.is_audio),
        "first_contact_at": first_ts.isoformat(),
        "last_contact_at": last_ts.isoformat(),
        "conversation_days": conversation_days,
        "first_response_minutes": (
            round(first_response_minutes, 2) if first_response_minutes is not None else None
        ),
        "avg_response_minutes": avg_resp,
        "longest_gap_hours": longest_gap_hours,
        "response_time_category": cat,
        "advisor_active_hours": active,
    }


def _format_hints(metadata: Dict[str, Any], computed: Dict[str, Any]) -> str:
    lines = ["DATOS CALCULADOS (no los repitas en tu JSON, son contexto):"]
    lines.append(f"- teléfono del lead: {metadata.get('phone')}")
    lines.append(f"- nombre WhatsApp: {metadata.get('whatsapp_name')}")
    for k in (
        "total_messages", "advisor_messages", "lead_messages",
        "advisor_audios", "lead_audios",
        "first_contact_at", "last_contact_at", "conversation_days",
        "first_response_minutes", "avg_response_minutes",
        "longest_gap_hours", "response_time_category", "advisor_active_hours",
    ):
        if computed.get(k) is not None:
            lines.append(f"- {k}: {computed[k]}")
    return "\n".join(lines)


class ClaudeClient:
    def __init__(self) -> None:
        self.client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        self.total_in = 0
        self.total_out = 0
        self.total_cache_read = 0
        self.total_cache_write = 0
        self._lock = threading.Lock()

    @retry(
        reraise=True,
        stop=stop_after_attempt(MAX_RETRIES),
        wait=wait_exponential(multiplier=2, min=2, max=30),
        retry=retry_if_exception_type((
            anthropic.APIConnectionError,
            anthropic.APITimeoutError,
            anthropic.RateLimitError,
            anthropic.InternalServerError,
        )),
    )
    def analyze(self, transcript: str, hints: str) -> Tuple[Dict[str, Any], float]:
        resp = self.client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=8000,
            system=[{
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{
                "role": "user",
                "content": f"{hints}\n\nTRANSCRIPCIÓN:\n{transcript}\n\nDevuelve SOLO el JSON."
            }],
        )
        text = "".join(
            b.text for b in resp.content if getattr(b, "type", None) == "text"
        ).strip()

        usage = resp.usage
        in_tok = getattr(usage, "input_tokens", 0) or 0
        out_tok = getattr(usage, "output_tokens", 0) or 0
        cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
        cache_write = getattr(usage, "cache_creation_input_tokens", 0) or 0

        cost = (
            in_tok * INPUT_TOK_COST
            + out_tok * OUTPUT_TOK_COST
            + cache_read * CACHE_READ_COST
            + cache_write * CACHE_WRITE_COST
        )

        with self._lock:
            self.total_in += in_tok
            self.total_out += out_tok
            self.total_cache_read += cache_read
            self.total_cache_write += cache_write

        data = _extract_json(text)
        return data, cost


def _extract_json(text: str) -> Dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"no JSON object in response: {text[:200]}")
    return json.loads(text[start:end + 1])


def _short_summary(transcript: str) -> str:
    msgs = parse_transcript(transcript)
    if not msgs:
        return "Transcripción vacía o sin mensajes parseables."
    return (
        f"Conversación muy corta ({len(msgs)} mensajes). "
        f"Primer mensaje: {msgs[0].role}: {msgs[0].body[:120]}"
    )


def process_lead(lead: Dict[str, Any], client: ClaudeClient) -> Tuple[bool, float]:
    lead_id = str(lead["lead_id"])
    conversation_id = str(lead["conversation_id"])
    transcript = lead["full_transcript"] or ""
    word_count = lead.get("word_count") or len(transcript.split())

    if word_count < MIN_WORDS:
        log.info("lead %s datos insuficientes (%d palabras)", lead_id, word_count)
        db.write_insufficient(lead_id, conversation_id, _short_summary(transcript))
        return True, 0.0

    # Truncar transcripts que exceden el límite de contexto. Preserva
    # inicio (donde se revela la intención) y final (donde se define el
    # outcome) — descarta el medio con una marca visible.
    if len(transcript) > MAX_TRANSCRIPT_CHARS:
        keep = MAX_TRANSCRIPT_CHARS // 2 - 200
        transcript = (
            transcript[:keep]
            + "\n\n[... transcripción truncada por exceder límite de contexto ...]\n\n"
            + transcript[-keep:]
        )
        log.warning("lead %s transcript truncado a %d chars", lead_id, len(transcript))

    computed = compute_metrics(transcript)
    metadata = {"phone": lead["phone"], "whatsapp_name": lead["whatsapp_name"]}
    hints = _format_hints(metadata, computed)

    # Errores de red/API de Anthropic: retriables (volverá como pending).
    # Errores de parseo/validación: NO retriables (se marca failed directo
    # porque reintentar sin cambios va a dar el mismo error y cuesta $$).
    try:
        raw, cost = client.analyze(transcript, hints)
    except (
        anthropic.APIConnectionError,
        anthropic.APITimeoutError,
        anthropic.RateLimitError,
        anthropic.InternalServerError,
        RetryError,
    ) as e:
        rc = db.get_retry_count(lead_id) + 1
        status = "failed" if rc >= MAX_RETRIES else "pending"
        db.mark_status(lead_id, status, retry_count=rc, error=str(e)[:500])
        log.error("lead %s error de API (retry %d/%d): %s",
                  lead_id, rc, MAX_RETRIES, e)
        db.log_system("error", f"api error lead {lead_id}",
                      {"lead_id": lead_id, "error": str(e)[:500], "retry": rc})
        return False, 0.0
    except (ValueError, json.JSONDecodeError, KeyError) as e:
        # JSON malformado, estructura inesperada — no retriable.
        db.mark_status(lead_id, "failed", retry_count=MAX_RETRIES,
                       error=f"parseo JSON: {str(e)[:400]}")
        log.error("lead %s JSON malformado (no retriable): %s", lead_id, e)
        return False, 0.0
    except Exception as e:
        # Cualquier otra cosa: ya agotó los retries internos de tenacity.
        rc = db.get_retry_count(lead_id) + 1
        status = "failed" if rc >= MAX_RETRIES else "pending"
        db.mark_status(lead_id, status, retry_count=rc, error=str(e)[:500])
        log.error("lead %s error inesperado (retry %d/%d): %s",
                  lead_id, rc, MAX_RETRIES, e)
        return False, 0.0

    try:
        validated = AnalysisOutput.model_validate(raw)
    except Exception as e:
        rc = db.get_retry_count(lead_id) + 1
        status = "failed" if rc >= MAX_RETRIES else "pending"
        db.mark_status(lead_id, status, retry_count=rc,
                       error=f"validation: {str(e)[:400]}")
        log.error("lead %s validation failed: %s", lead_id, e)
        return False, cost

    try:
        db.persist_analysis(
            lead_id,
            conversation_id,
            validated.model_dump(),
            computed,
        )
    except Exception as e:
        rc = db.get_retry_count(lead_id) + 1
        status = "failed" if rc >= MAX_RETRIES else "pending"
        db.mark_status(lead_id, status, retry_count=rc,
                       error=f"persist: {str(e)[:400]}")
        log.error("lead %s persist failed: %s", lead_id, e)
        return False, cost

    log.info("lead %s analyzed OK (cost $%.4f)", lead_id, cost)
    return True, cost


def run_analyze(limit: Optional[int] = None) -> Dict[str, Any]:
    _install_signals()

    # Auto-generar unified_transcripts faltantes antes de registrar leads.
    # Esto permite que el analyzer funcione aunque el transcriber no haya
    # corrido (audios aparecen como [AUDIO SIN TRANSCRIBIR] en el texto).
    transcripts_created = db.ensure_unified_transcripts()
    if transcripts_created > 0:
        log.info("generated %d missing unified_transcripts from messages",
                 transcripts_created)

    registered = db.register_pending_leads()
    log.info("registered %d new pending leads", registered)
    pending = db.fetch_pending_leads(limit=limit)
    log.info("processing %d pending leads with %d workers",
             len(pending), NUM_WORKERS)

    client = ClaudeClient()
    ok = 0
    fail = 0
    total_cost = 0.0

    with ThreadPoolExecutor(max_workers=NUM_WORKERS) as ex:
        futures = {ex.submit(process_lead, lead, client): lead for lead in pending}
        for fut in as_completed(futures):
            if _shutdown.is_set():
                break
            try:
                success, cost = fut.result()
                total_cost += cost
                if success:
                    ok += 1
                else:
                    fail += 1
            except Exception as e:
                fail += 1
                log.exception("worker crashed: %s", e)

    log.info(
        "done: ok=%d failed=%d total_cost=$%.4f tokens in=%d out=%d cache_read=%d cache_write=%d",
        ok, fail, total_cost,
        client.total_in, client.total_out,
        client.total_cache_read, client.total_cache_write,
    )
    db.log_system("info", "analyze run finished", {
        "ok": ok, "failed": fail, "total_cost_usd": round(total_cost, 4),
        "input_tokens": client.total_in, "output_tokens": client.total_out,
        "cache_read_tokens": client.total_cache_read,
        "cache_write_tokens": client.total_cache_write,
    })
    return {"ok": ok, "failed": fail, "total_cost": total_cost}
