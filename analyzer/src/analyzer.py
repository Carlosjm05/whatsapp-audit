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
from .catalogos import (
    normalize_asesor,
    normalize_project_list,
    normalize_proyecto,
)
from .prompt import get_system_prompt
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
        log.warning("señal %s recibida, drenando workers", signum)
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

    # Violaciones del SLA de 10 min. Excluye ventanas nocturnas (21:00-07:00)
    # en horario local — no cuenta como error si el lead escribió a las 2am.
    SLA_MIN = 10
    NIGHT_HOURS = {21, 22, 23, 0, 1, 2, 3, 4, 5, 6}
    sla_violations: List[Dict[str, Any]] = []
    for i in range(1, len(msgs)):
        prev, cur = msgs[i-1], msgs[i]
        if prev.role == "LEAD" and cur.role == "ASESOR":
            gap = (cur.ts - prev.ts).total_seconds() / 60.0
            response_gaps.append(gap)
            # Skip si el mensaje del lead llegó en horario nocturno.
            if prev.ts.hour in NIGHT_HOURS:
                continue
            if gap > SLA_MIN:
                sla_violations.append({
                    "lead_msg_at": prev.ts.strftime("%Y-%m-%d %H:%M"),
                    "advisor_msg_at": cur.ts.strftime("%Y-%m-%d %H:%M"),
                    "gap_minutes": round(gap, 1),
                })

    avg_resp = round(mean(response_gaps), 2) if response_gaps else None

    for i in range(1, len(msgs)):
        gap = (msgs[i].ts - msgs[i-1].ts).total_seconds() / 3600.0
        if longest_gap_hours is None or gap > longest_gap_hours:
            longest_gap_hours = gap
    if longest_gap_hours is not None:
        longest_gap_hours = round(longest_gap_hours, 2)

    # Umbrales (minutos). SLA duro de Óscar: cualquier respuesta > 10 min
    # es error del asesor.
    if first_response_minutes is None:
        cat = "critico"
    elif first_response_minutes <= 2:
        cat = "excelente"
    elif first_response_minutes <= 5:
        cat = "bueno"
    elif first_response_minutes <= 10:    # dentro del SLA
        cat = "regular"
    elif first_response_minutes <= 30:    # fuera del SLA
        cat = "malo"
    else:                                  # > 30 min
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
        "sla_violations": sla_violations,
        "sla_violations_count": len(sla_violations),
    }


def _format_hints(metadata: Dict[str, Any], computed: Dict[str, Any],
                  transcript: str) -> str:
    """Construye hints para Claude. Incluye metadatos, métricas calculadas
    y una señal clave: quién envió el último mensaje (crítico para
    distinguir ghosteado_por_asesor vs ghosteado_por_lead)."""
    lines = ["DATOS CALCULADOS (NO los repitas en tu JSON, son contexto):"]
    lines.append(f"- telefono del lead: {metadata.get('phone')}")
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

    # SLA de 10 min: pasar conteo y muestras al LLM para que las
    # incluya en errors_list con evidencia específica.
    v_count = computed.get("sla_violations_count", 0)
    if v_count > 0:
        lines.append(f"- sla_10min_violaciones_total: {v_count} (cada una es error)")
        # Pasar hasta 5 violaciones concretas con timestamps.
        samples = (computed.get("sla_violations") or [])[:5]
        for v in samples:
            lines.append(
                f"  - lead escribio {v['lead_msg_at']}, asesor "
                f"respondio {v['advisor_msg_at']} ({v['gap_minutes']} min)"
            )
        if v_count > 5:
            lines.append(f"  - ... y {v_count - 5} mas")

    # Quién habló último — señal crítica para el outcome correcto.
    msgs = parse_transcript(transcript)
    if msgs:
        last = msgs[-1]
        lines.append(
            f"- ultimo_mensaje_de: {last.role} "
            f"({'audio' if last.is_audio else 'texto'}) "
            f"el {last.ts.strftime('%Y-%m-%d %H:%M')}"
        )
        # Si el lead escribió último y no ha habido respuesta del asesor
        # en >24h, sugiere ghosteado_por_asesor.
        if last.role == "LEAD":
            lines.append(
                "- pista: el LEAD fue el ultimo en escribir. Si ya paso "
                "tiempo significativo sin respuesta del asesor, considera "
                "'ghosteado_por_asesor' en outcome.final_status."
            )
        else:
            lines.append(
                "- pista: el ASESOR fue el ultimo en escribir. Si el lead "
                "no respondio al mensaje del asesor, considera "
                "'ghosteado_por_lead' o 'se_enfrio' segun el contenido."
            )

    # Días desde el último contacto (útil para recovery_priority).
    if computed.get("last_contact_at"):
        try:
            lct = computed["last_contact_at"]
            # isoformat -> datetime
            if isinstance(lct, str):
                # Tolerar 'Z' y offsets.
                lct_clean = lct.replace("Z", "+00:00")
                lct_dt = datetime.fromisoformat(lct_clean)
            else:
                lct_dt = lct
            # Naive comparison para simplificar.
            now = datetime.now(tz=lct_dt.tzinfo) if lct_dt.tzinfo else datetime.now()
            days_since = (now - lct_dt).days
            lines.append(f"- dias_desde_ultimo_contacto: {days_since}")
        except Exception:
            pass

    return "\n".join(lines)


class ClaudeClient:
    def __init__(self) -> None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError(
                "Falta ANTHROPIC_API_KEY en el entorno. Configúrala antes "
                "de arrancar el analyzer."
            )
        self.client = anthropic.Anthropic(api_key=api_key)
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
            max_tokens=12000,
            system=[{
                "type": "text",
                "text": get_system_prompt(),
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

    # Si fue encolado via POST /reanalyze existe una fila 'pending' en
    # lead_analysis_history; promoverla a 'processing'. Si no existe
    # (corrida automática), el UPDATE no toca nada.
    db.mark_history_processing(lead_id)

    if word_count < MIN_WORDS:
        log.info("lead %s datos insuficientes (%d palabras)", lead_id, word_count)
        db.write_insufficient(lead_id, conversation_id, _short_summary(transcript))
        db.mark_history_completed(lead_id, CLAUDE_MODEL, 0.0)
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
    # Preferir los timestamps reales de raw_conversations (incluyen imágenes,
    # videos, documentos), no los del transcript (solo text/audio). Antes
    # leads con última foto/sticker aparecían con last_contact_at viejo.
    if lead.get("first_message_at"):
        computed["first_contact_at"] = lead["first_message_at"].isoformat() \
            if hasattr(lead["first_message_at"], "isoformat") \
            else lead["first_message_at"]
    if lead.get("last_message_at"):
        computed["last_contact_at"] = lead["last_message_at"].isoformat() \
            if hasattr(lead["last_message_at"], "isoformat") \
            else lead["last_message_at"]
    # Recalcular conversation_days con los timestamps reales.
    fm = lead.get("first_message_at")
    lm = lead.get("last_message_at")
    if fm and lm and hasattr(fm, "date") and hasattr(lm, "date"):
        computed["conversation_days"] = max(1, (lm.date() - fm.date()).days + 1)

    metadata = {"phone": lead["phone"], "whatsapp_name": lead["whatsapp_name"]}
    hints = _format_hints(metadata, computed, transcript)

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
        if status == "failed":
            db.mark_history_failed(lead_id, f"api: {e}")
        log.error("lead %s error de API (reintento %d/%d): %s",
                  lead_id, rc, MAX_RETRIES, e)
        return False, 0.0
    except (ValueError, json.JSONDecodeError, KeyError) as e:
        # JSON malformado, estructura inesperada — no retriable.
        db.mark_status(lead_id, "failed", retry_count=MAX_RETRIES,
                       error=f"parseo JSON: {str(e)[:400]}")
        db.mark_history_failed(lead_id, f"parseo JSON: {e}")
        log.error("lead %s JSON malformado (no retriable): %s", lead_id, e)
        return False, 0.0
    except Exception as e:
        # Cualquier otra cosa: ya agotó los retries internos de tenacity.
        rc = db.get_retry_count(lead_id) + 1
        status = "failed" if rc >= MAX_RETRIES else "pending"
        db.mark_status(lead_id, status, retry_count=rc, error=str(e)[:500])
        if status == "failed":
            db.mark_history_failed(lead_id, str(e))
        log.error("lead %s error inesperado (reintento %d/%d): %s",
                  lead_id, rc, MAX_RETRIES, e)
        return False, 0.0

    try:
        validated = AnalysisOutput.model_validate(raw)
    except Exception as e:
        db.mark_status(lead_id, "failed", retry_count=MAX_RETRIES,
                       error=f"validacion: {str(e)[:400]}")
        db.mark_history_failed(lead_id, f"validacion: {e}")
        log.error("lead %s validacion fallida (no retriable): %s", lead_id, e)
        return False, cost

    # Post-procesar: normalizar nombres de proyectos y asesores contra los
    # catálogos conocidos. Claude a veces confunde ciudades con proyectos
    # o usa variaciones del nombre del asesor.
    data_dict = validated.model_dump()
    if data_dict.get("interest"):
        data_dict["interest"]["project_name"] = normalize_proyecto(
            data_dict["interest"].get("project_name")
        )
        data_dict["interest"]["all_projects_mentioned"] = normalize_project_list(
            data_dict["interest"].get("all_projects_mentioned") or []
        )
    if data_dict.get("advisor"):
        data_dict["advisor"]["advisor_name"] = normalize_asesor(
            data_dict["advisor"].get("advisor_name")
        )

    try:
        db.persist_analysis(
            lead_id,
            conversation_id,
            data_dict,
            computed,
        )
    except Exception as e:
        rc = db.get_retry_count(lead_id) + 1
        status = "failed" if rc >= MAX_RETRIES else "pending"
        db.mark_status(lead_id, status, retry_count=rc,
                       error=f"persist: {str(e)[:400]}")
        if status == "failed":
            db.mark_history_failed(lead_id, f"persist: {e}")
        log.error("lead %s persist fallido: %s", lead_id, e)
        return False, cost

    db.mark_history_completed(lead_id, CLAUDE_MODEL, cost)
    log.info("lead %s analizado OK (costo $%.4f)", lead_id, cost)
    return True, cost


def run_analyze(limit: Optional[int] = None) -> Dict[str, Any]:
    _install_signals()

    # Auto-generar unified_transcripts faltantes antes de registrar leads.
    # Esto permite que el analyzer funcione aunque el transcriber no haya
    # corrido (audios aparecen como [AUDIO SIN TRANSCRIBIR] en el texto).
    transcripts_created = db.ensure_unified_transcripts()
    if transcripts_created > 0:
        log.info("generados %d unified_transcripts faltantes desde messages",
                 transcripts_created)

    registered = db.register_pending_leads()
    log.info("%d nuevos leads pending registrados", registered)
    pending = db.fetch_pending_leads(limit=limit)
    log.info("procesando %d leads pending con %d workers",
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
                log.exception("worker cayó: %s", e)

    log.info(
        "corrida completa: ok=%d fallidos=%d costo_total=$%.4f "
        "tokens entrada=%d salida=%d cache_lectura=%d cache_escritura=%d",
        ok, fail, total_cost,
        client.total_in, client.total_out,
        client.total_cache_read, client.total_cache_write,
    )
    db.log_system("info", "corrida de análisis finalizada", {
        "ok": ok, "fallidos": fail, "costo_total_usd": round(total_cost, 4),
        "tokens_entrada": client.total_in, "tokens_salida": client.total_out,
        "cache_lectura": client.total_cache_read,
        "cache_escritura": client.total_cache_write,
    })
    return {"ok": ok, "fallidos": fail, "costo_total": total_cost}
