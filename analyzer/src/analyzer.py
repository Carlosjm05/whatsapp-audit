"""Núcleo del analizador IA (cerebro v3) — pipeline two-pass por lead.

Para cada lead pendiente:

  1. Si el chat tiene <20 palabras → marca `datos_insuficientes` y
     persiste sin llamar a Claude.
  2. Pass 1 (triaje): Claude Haiku decide `analizable | trivial | spam`.
     Si NO es `analizable`, persiste el verdict y termina.
  3. Pass 2 (análisis): Claude Sonnet con prompt cacheado (5 min TTL)
     extrae los 45+ campos. Pydantic valida la salida.
  4. Computa métricas no-IA (response times, ghost score, business
     hours) localmente.
  5. Persiste todo en una transacción atómica.

Workers paralelos: `ANALYZER_WORKERS` (default 2). Costos por token
(input/output/cache_read/cache_write) se trackean en
`lead_analysis_history`.

Decisiones documentadas en docs/adr/0003-two-pass-haiku-sonnet.md.
Contrato de salida: docs/SCHEMA_45_CAMPOS.md.
"""
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
# Modelo "cheap" para triaje previo (two-pass) — clasifica chats basura
# sin gastar Sonnet. Haiku cuesta ~1/15 de Sonnet.
CHEAP_MODEL = os.getenv("CHEAP_MODEL", "claude-haiku-4-5")
# Two-pass activado por default. Se desactiva con TWO_PASS=false si da
# problemas (fallback a single-call Sonnet).
TWO_PASS_ENABLED = os.getenv("TWO_PASS", "true").lower() != "false"
# Chats más cortos que este umbral NO escalan a Sonnet ni pasan triage:
# son demasiado simples, Sonnet/Haiku dan el mismo resultado. Default
# pasa a usar MIN_WORDS para consistencia.
NUM_WORKERS = int(os.getenv("ANALYZER_WORKERS", os.getenv("NUM_WORKERS", "2")))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
MIN_WORDS = 20
# Umbral aproximado para truncar transcripts muy largos (en caracteres).
# 4 chars/token × 180k tokens de contexto = ~720k. Dejamos margen para
# system prompt (~3k tokens) + max_tokens salida (8k) + hints.
# 600k chars ≈ 150k tokens de entrada — seguro para Sonnet 4.5.
MAX_TRANSCRIPT_CHARS = 600_000

# Costos Sonnet 4.5 (por M tokens, ver docs.anthropic.com).
INPUT_TOK_COST = 3.0 / 1_000_000
OUTPUT_TOK_COST = 15.0 / 1_000_000
CACHE_READ_COST = 0.30 / 1_000_000
CACHE_WRITE_COST = 3.75 / 1_000_000

# Costos Haiku 4.5 (aprox): input $1/M, output $5/M. No cacheamos en
# el pass de triage (prompt mucho más corto, no vale la pena).
HAIKU_INPUT_COST = 1.0 / 1_000_000
HAIKU_OUTPUT_COST = 5.0 / 1_000_000

# Estados que el triage puede marcar como "cerrado" sin escalar a Sonnet.
# Son chats donde el análisis profundo no cambia nada de valor.
TRIAGE_TERMINAL_STATES = {"spam", "numero_equivocado", "datos_insuficientes"}

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
    is_bot: bool = False  # True si es respuesta automática del bot de Ortiz


# Detección del mensaje automático del WhatsApp Business de Ortiz Finca
# Raíz. Patrones específicos detectados en producción (2026-05-04):
#   "Hola 👋 estás comunicado con el equipo de  ORTIZ EXPERTOS EN FINCA RAÍZ"
#   "Mientras respondemos tu mensaje te invitamos a visitar nuestra página web"
#   URL ortizfincaraiz.com
#
# Este mensaje se dispara automáticamente al recibir CUALQUIER mensaje
# del lead, antes de que un humano siquiera lo vea. Si lo contamos como
# "primera respuesta del asesor" → mediana de SLA queda en 0 minutos
# falsamente. CRÍTICO excluirlo de las métricas de tiempo de respuesta.
_BOT_PATTERNS = [
    r"est[áa]s\s+comunicado\s+con\s+el\s+equipo\s+de",
    r"ORTIZ\s+EXPERTOS\s+EN\s+FINCA\s+RA[ÍI]Z",
    r"mientras\s+respondemos\s+tu\s+mensaje",
    r"te\s+invitamos\s+a\s+visitar\s+nuestra\s+p[áa]gina",
    r"ortizfincaraiz\.com",
    # Variantes vistas en otros bots:
    r"este\s+es\s+un\s+mensaje\s+autom[áa]tico",
    r"en\s+breve\s+te\s+atender(?:emos|án)",
]
_BOT_RE = re.compile("|".join(_BOT_PATTERNS), re.IGNORECASE)


def is_bot_message(body: str) -> bool:
    """True si el mensaje del asesor es la respuesta automática del bot.
    Solo se evalúa contenido textual; los audios/imágenes nunca son bots.
    Detección por patrones (regex). Si el mensaje contiene 2+ patrones
    distintos del bot, alta confianza. Con 1 sola coincidencia también
    cuenta — son frases muy específicas que no aparecen en chat humano."""
    if not body:
        return False
    return bool(_BOT_RE.search(body))


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
        body = m.group("body")
        role = m.group("role")
        # Detección de bot:
        # 1. Marca explícita en el transcript "(auto-bot)" — la pone el
        #    transcriber al unificar mensajes.
        # 2. Detección por contenido (regex) — fallback si no hay marca
        #    explícita o el transcript fue generado con código viejo.
        is_bot = (role == "ASESOR") and (
            "auto-bot" in meta or is_bot_message(body)
        )
        out.append(ParsedMsg(
            ts=ts,
            role=role,
            is_audio="audio" in meta,
            body=body,
            is_bot=is_bot,
        ))
    return out


def compute_metrics(text: str) -> Dict[str, Any]:
    return compute_metrics_from_msgs(parse_transcript(text))


def compute_metrics_from_msgs(msgs: List["ParsedMsg"]) -> Dict[str, Any]:
    """Misma lógica que compute_metrics() pero recibe la lista ya parseada.
    Útil para `recompute_metrics.py` que construye los msgs directamente
    de la tabla `messages` sin pasar por unified_transcripts."""
    if not msgs:
        return {
            "total_messages": 0, "advisor_messages": 0, "lead_messages": 0,
            "advisor_audios": 0, "lead_audios": 0,
        }
    total = len(msgs)
    # `advisor` excluye bots para que conteos y promedios reflejen
    # actividad humana real. `advisor_with_bots` se mantiene aparte por
    # si alguna métrica lo necesita.
    advisor_with_bots = [m for m in msgs if m.role == "ASESOR"]
    advisor = [m for m in advisor_with_bots if not m.is_bot]
    lead = [m for m in msgs if m.role == "LEAD"]
    first_ts = msgs[0].ts
    last_ts = msgs[-1].ts
    conversation_days = max(1, (last_ts.date() - first_ts.date()).days + 1)

    # Tiempos de respuesta calculados con HORARIO LABORAL de Óscar:
    # Lun-Sáb 7-19. Domingos se trackean por separado para visibilidad.
    # (Definido 2026-04-23, antes era wall-clock y daba 36h promedio
    # porque contaba noches y fines de semana.)
    from .business_hours import response_time_minutes

    first_lead_ts: Optional[datetime] = None
    first_response_minutes: Optional[float] = None
    response_gaps: List[float] = []         # solo business
    sunday_gaps: List[float] = []           # solo domingos (separado)
    longest_gap_hours: Optional[float] = None

    # `first_lead_ts` se mantiene como el PRIMER mensaje del lead en TODA
    # la conversación (otras métricas lo usan).
    for m in msgs:
        if m.role == "LEAD":
            first_lead_ts = m.ts
            break

    # `first_response_minutes` mide el tiempo entre el ÚLTIMO mensaje
    # del lead ANTES de la primera respuesta del asesor HUMANO (no desde
    # el PRIMERO ni contando bots).
    #
    # CRITERIOS DE EXCLUSIÓN:
    # 1. is_bot=True (auto-respuesta de Ortiz): no es asesor real,
    #    distorsiona el SLA bajándolo a 0 segundos artificialmente.
    # 2. Caso reactivación: si el lead escribió hace meses sin respuesta
    #    y ahora reactivó la conversación, mide desde la reactivación
    #    no desde el primer mensaje.
    first_advisor_idx: Optional[int] = None
    for i, m in enumerate(msgs):
        if m.role == "ASESOR" and not m.is_bot:
            first_advisor_idx = i
            break
    if first_advisor_idx is not None:
        # último mensaje LEAD antes de esa respuesta humana
        last_lead_before_advisor = None
        for m in msgs[:first_advisor_idx]:
            if m.role == "LEAD":
                last_lead_before_advisor = m
        if last_lead_before_advisor is not None:
            mins, bucket = response_time_minutes(
                last_lead_before_advisor.ts, msgs[first_advisor_idx].ts
            )
            first_response_minutes = mins
            if bucket == "sunday":
                sunday_gaps.append(mins)

    # SLA de 5 min: cualquier respuesta > 5 min en horario laboral
    # es violación. Definido por Óscar (2026-04-26): "5 en adelante ya es
    # mucho". Antes era 10 min — al bajar a 5 muchos leads previos quedan
    # con violación. Domingos NO cuentan para SLA (se reportan aparte).
    #
    # GAPS DE REACTIVACIÓN (>8h en horario laboral) NO son violaciones
    # de SLA — son chats donde el asesor ignoró un mensaje y el lead
    # volvió a escribir días/semanas después. Excluirlos del promedio
    # da una métrica más realista. Se reportan por separado más abajo.
    SLA_MIN = 5
    REACTIVATION_THRESHOLD_MIN = 480  # 8h horario laboral = "reactivación"
    sla_violations: List[Dict[str, Any]] = []
    reactivation_gaps: List[float] = []  # gaps gigantes informativos
    bot_responses_count = 0  # auto-respuestas que NO contamos como SLA
    for i in range(1, len(msgs)):
        prev, cur = msgs[i-1], msgs[i]
        if prev.role == "LEAD" and cur.role == "ASESOR":
            # Si el "asesor" es el bot, NO cuenta como respuesta humana.
            # Saltamos al siguiente mensaje hasta encontrar uno humano.
            if cur.is_bot:
                bot_responses_count += 1
                continue
            mins, bucket = response_time_minutes(prev.ts, cur.ts)
            if bucket == "sunday":
                sunday_gaps.append(mins)
                continue                    # no entra al promedio business
            if mins > REACTIVATION_THRESHOLD_MIN:
                # Gap de reactivación: el lead se cansó y volvió después.
                # NO entra al promedio ni cuenta como violación SLA.
                reactivation_gaps.append(mins)
                continue
            response_gaps.append(mins)
            if mins > SLA_MIN:
                sla_violations.append({
                    "lead_msg_at": prev.ts.strftime("%Y-%m-%d %H:%M"),
                    "advisor_msg_at": cur.ts.strftime("%Y-%m-%d %H:%M"),
                    "gap_minutes": round(mins, 1),
                })

    avg_resp = round(mean(response_gaps), 2) if response_gaps else None
    sunday_avg = round(mean(sunday_gaps), 2) if sunday_gaps else None

    for i in range(1, len(msgs)):
        gap = (msgs[i].ts - msgs[i-1].ts).total_seconds() / 3600.0
        if longest_gap_hours is None or gap > longest_gap_hours:
            longest_gap_hours = gap
    if longest_gap_hours is not None:
        longest_gap_hours = round(longest_gap_hours, 2)

    # Umbrales (minutos). SLA duro de Óscar: cualquier respuesta > 5 min
    # es error del asesor.
    if first_response_minutes is None:
        cat = "critico"
    elif first_response_minutes <= 2:
        cat = "excelente"
    elif first_response_minutes <= 5:     # dentro del SLA
        cat = "bueno"
    elif first_response_minutes <= 15:    # apenas fuera del SLA
        cat = "regular"
    elif first_response_minutes <= 60:    # claramente lento
        cat = "malo"
    else:                                  # > 1h
        cat = "critico"

    hour_counts: Dict[int, int] = {}
    for m in advisor:
        hour_counts[m.ts.hour] = hour_counts.get(m.ts.hour, 0) + 1
    active = ",".join(f"{h}:{hour_counts[h]}" for h in sorted(hour_counts)) or None

    # ─── Métricas cualitativas (hints ricos para Claude) ──────
    # Ratio asesor/lead — detecta "asesor ausente" (lead se esfuerza,
    # asesor apenas contesta) o "asesor monológico".
    ratio_advisor_lead = (
        round(len(advisor) / len(lead), 2) if lead else None
    )

    # Palabras promedio por mensaje del asesor — detecta plantillas
    # cortas/genéricas vs respuestas pensadas.
    advisor_word_counts = [len((m.body or "").split()) for m in advisor if not m.is_audio]
    avg_words_per_advisor_msg = (
        round(mean(advisor_word_counts), 1) if advisor_word_counts else None
    )
    lead_word_counts = [len((m.body or "").split()) for m in lead if not m.is_audio]
    avg_words_per_lead_msg = (
        round(mean(lead_word_counts), 1) if lead_word_counts else None
    )

    # Detección simple de plantillas: >=3 mensajes del asesor con los
    # primeros 40 chars idénticos (ignorando espacios y caso).
    def _head(s: str, n: int = 40) -> str:
        return " ".join((s or "").lower().split())[:n]
    head_counts: Dict[str, int] = {}
    for m in advisor:
        if m.is_audio or not m.body:
            continue
        h = _head(m.body)
        if len(h) < 20:
            continue
        head_counts[h] = head_counts.get(h, 0) + 1
    uses_templates = any(c >= 3 for c in head_counts.values())
    template_samples = [h for h, c in head_counts.items() if c >= 3][:2]

    # Horarios inusuales del asesor (1-5 AM local): indica automatización,
    # descuido o asesor trabajando a deshoras. No es error per se pero
    # Claude puede usarlo como señal.
    unusual_hours_advisor = sum(
        1 for m in advisor if m.ts.hour in {1, 2, 3, 4, 5}
    )

    # Instrumentación #2: contamos referencias a media visual en el
    # transcripto. Si hay muchas "(imagen)" y Claude marca venta_cerrada
    # como ghost, es señal de que conviene activar Vision para leer PDFs
    # de soporte de pago.
    image_markers = sum(1 for m in msgs if "imagen" in (m.body or "").lower()
                        or "(imagen)" in (m.body or ""))
    document_markers = sum(1 for m in msgs if "documento" in (m.body or "").lower()
                           or "(documento)" in (m.body or ""))

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
        # Gaps de reactivación (>8h horario laboral): chats donde el lead
        # volvió a escribir días/semanas después, NO son violaciones SLA.
        # Solo informativo — útil para detectar leads que se enfriaron y
        # reactivaron.
        "reactivation_gaps_count": len(reactivation_gaps),
        # Auto-respuestas del bot detectadas (informativo, no entran al SLA).
        # Si un chat tiene 5 bot_responses y solo 1 advisor_human → señal
        # de que el asesor casi no participó (bot predominante).
        "bot_responses_count": bot_responses_count,
        "advisor_human_messages": len(advisor),
        # Domingo (separado del SLA, solo informativo):
        "sunday_response_minutes_avg": sunday_avg,
        "sunday_response_count": len(sunday_gaps),
        # Métricas cualitativas nuevas (hints ricos para Claude).
        "ratio_advisor_lead_messages": ratio_advisor_lead,
        "avg_words_per_advisor_msg": avg_words_per_advisor_msg,
        "avg_words_per_lead_msg": avg_words_per_lead_msg,
        "uses_templates": uses_templates,
        "template_samples": template_samples,
        "unusual_hours_advisor_count": unusual_hours_advisor,
        # Instrumentación Vision (#2): para decidir si vale activar
        # lectura de imágenes/PDFs del chat.
        "image_markers_count": image_markers,
        "document_markers_count": document_markers,
    }


def _format_hints(metadata: Dict[str, Any], computed: Dict[str, Any],
                  transcript: str,
                  history: Optional[List[Dict[str, Any]]] = None) -> str:
    """Construye hints para Claude. Incluye metadatos, métricas calculadas
    y una señal clave: quién envió el último mensaje (crítico para
    distinguir ghosteado_por_asesor vs ghosteado_por_lead).

    Si `history` (leads previos del mismo teléfono) está presente, se
    agrega como contexto — permite a Claude detectar patrones como "este
    lead ya contactó antes y se enfrió por precio" o "este número ya
    compró, ahora probablemente es postventa"."""
    lines = ["DATOS CALCULADOS (NO los repitas en tu JSON, son contexto):"]
    lines.append(f"- telefono del lead: {metadata.get('phone')}")
    lines.append(f"- nombre WhatsApp: {metadata.get('whatsapp_name')}")
    for k in (
        "total_messages", "advisor_messages", "lead_messages",
        "advisor_audios", "lead_audios",
        "first_contact_at", "last_contact_at", "conversation_days",
        "first_response_minutes", "avg_response_minutes",
        "longest_gap_hours", "response_time_category", "advisor_active_hours",
        # Hints cualitativos nuevos — usalos para calibrar tu análisis.
        "ratio_advisor_lead_messages",  # <1 = asesor escribe menos que el lead
        "avg_words_per_advisor_msg",    # <10 = plantillas/respuestas secas
        "avg_words_per_lead_msg",
        "unusual_hours_advisor_count",  # mensajes asesor 1-5am
        "image_markers_count",          # imágenes en el chat
        "document_markers_count",       # documentos en el chat
        # Bot vs humano — si advisor_human_messages=0 pero bot_responses>0,
        # NADIE humano respondió, solo el bot. Lead abandonado.
        "bot_responses_count",
        "advisor_human_messages",
    ):
        if computed.get(k) is not None:
            lines.append(f"- {k}: {computed[k]}")

    # Alerta crítica: chat donde solo el bot respondió, sin asesor humano.
    bot_count = computed.get("bot_responses_count", 0) or 0
    human_count = computed.get("advisor_human_messages", 0) or 0
    if bot_count > 0 and human_count == 0:
        lines.append(
            "- ⚠️ ATENCIÓN: el bot auto-respondió pero NINGÚN asesor humano "
            "intervino en este chat. Lead abandonado por completo. "
            "Considera final_status='ghosteado_por_asesor' y "
            "perdido_por='asesor_sin_seguimiento'."
        )

    # Señal de plantilla: si el asesor repite el mismo inicio de mensaje.
    # Crítico para errors_list ("usó mensaje genérico/plantilla").
    if computed.get("uses_templates"):
        lines.append(
            "- uses_templates: true (asesor reutilizó el mismo inicio de "
            "mensaje 3+ veces — probable uso de plantilla. Considera en errors_list)"
        )
        for sample in (computed.get("template_samples") or []):
            lines.append(f"  - plantilla detectada: \"{sample}...\"")

    # SLA de 5 min: pasar conteo y muestras al LLM para que las
    # incluya en errors_list con evidencia específica.
    v_count = computed.get("sla_violations_count", 0)
    if v_count > 0:
        lines.append(f"- sla_5min_violaciones_total: {v_count} (cada una es error)")
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

    # Historial cross-lead por teléfono (#8): si este número ya apareció
    # en chats anteriores, Claude puede detectar patrones ("ya compró →
    # es postventa", "ya se enfrió 2 veces → lead difícil", etc.).
    if history:
        lines.append("")
        lines.append(f"HISTORIAL DE ESTE TELÉFONO ({len(history)} chat(s) previos):")
        for i, h in enumerate(history, 1):
            parts = [
                f"  {i}. {h.get('first_contact','?')} → {h.get('last_contact','?')}"
                f" ({h.get('conversation_days', 0)} días)"
            ]
            if h.get("final_status"):
                parts.append(f"outcome={h['final_status']}")
            if h.get("perdido_por") and h["perdido_por"] != "no_aplica":
                parts.append(f"perdido_por={h['perdido_por']}")
            if h.get("intent_score") is not None:
                parts.append(f"intent={h['intent_score']}/10")
            if h.get("project_name"):
                parts.append(f"proyecto={h['project_name']}")
            if h.get("budget_estimated_cop"):
                parts.append(f"presupuesto≈{h['budget_estimated_cop']:,}")
            lines.append(" · ".join(parts))
        lines.append(
            "  (pista: si algún chat previo es 'venta_cerrada' o "
            "'cliente_existente', el actual probablemente es postventa — "
            "considera final_status='cliente_existente')"
        )

    return "\n".join(lines)


_TRIAGE_PROMPT = """Eres un clasificador rápido de conversaciones de WhatsApp.

Tu único trabajo: en UNA palabra, determinar si la conversación es analizable como lead comercial real o descartable.

Reglas:
- "spam" si es propaganda masiva, publicidad no solicitada, bot/automatización ajena.
- "numero_equivocado" si el lead explícitamente dice que llegó al número por error o no conoce Ortiz Finca Raíz.
- "datos_insuficientes" si hay menos de 3 intercambios reales (saludo+genérico no cuenta) o el contenido no permite evaluar interés.
- "analizable" en CUALQUIER otro caso — incluso leads que se ghostearon o fueron atendidos mal, siempre que haya algo que analizar.

IMPORTANTE: en caso de duda, respondé "analizable". El objetivo es NO descartar leads reales.

Respondé SOLO con una de las 4 palabras: spam | numero_equivocado | datos_insuficientes | analizable.
No expliques, no justifiques, solo la palabra."""


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
        # Contadores separados para triage (Haiku).
        self.triage_in = 0
        self.triage_out = 0
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
    def triage(self, transcript: str) -> Tuple[str, float]:
        """Pass #1 del two-pass: clasifica el chat en 1 palabra con Haiku.

        Retorna (clasificacion, costo_usd). Clasificacion ∈
        {"spam", "numero_equivocado", "datos_insuficientes", "analizable"}.
        Si la respuesta del modelo no matchea, devolvemos "analizable"
        como defensa (prefí escalar a Sonnet antes que perder un lead real).
        """
        # Para triage truncamos a 4000 chars — alcanza para clasificar y
        # mantiene costo <$0.001/lead.
        short = transcript if len(transcript) <= 4000 else (
            transcript[:3000] + "\n...[truncado]...\n" + transcript[-1000:]
        )
        resp = self.client.messages.create(
            model=CHEAP_MODEL,
            max_tokens=10,                      # 1 palabra suficiente
            system=_TRIAGE_PROMPT,
            messages=[{
                "role": "user",
                "content": f"TRANSCRIPCIÓN:\n{short}\n\nClasificación (una palabra):",
            }],
        )
        text = "".join(
            b.text for b in resp.content if getattr(b, "type", None) == "text"
        ).strip().lower()

        usage = resp.usage
        in_tok = getattr(usage, "input_tokens", 0) or 0
        out_tok = getattr(usage, "output_tokens", 0) or 0
        cost = in_tok * HAIKU_INPUT_COST + out_tok * HAIKU_OUTPUT_COST

        with self._lock:
            self.triage_in += in_tok
            self.triage_out += out_tok

        # Defensive: parseamos la respuesta. Orden crítico: buscamos
        # "analizable" PRIMERO porque Haiku a veces responde con
        # oraciones negativas tipo "no es spam, es analizable" —
        # substring-matching con spam primero daría un falso positivo.
        # Si queda duda, siempre preferimos "analizable" (no perder leads).
        #
        # Además usamos regex con word boundary para evitar matches
        # espurios tipo "datos_insuficientes_para..." matchee algo más.
        import re as _re
        def _has_word(needle: str) -> bool:
            return bool(_re.search(rf"\b{_re.escape(needle)}\b", text))

        if _has_word("analizable"):
            return "analizable", cost
        for valid in ("numero_equivocado", "datos_insuficientes", "spam"):
            if _has_word(valid):
                return valid, cost
        # Si el modelo devolvió algo raro, escalamos por seguridad.
        log.warning("triage respuesta inesperada %r → analizable", text[:50])
        return "analizable", cost

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

    if word_count < MIN_WORDS:
        # Datos insuficientes — promovemos a 'processing' y completamos
        # directamente (costo 0, sin llamada a Claude).
        db.mark_history_processing(lead_id)
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

    # Histórico cross-lead: leads previos del mismo teléfono ya analizados.
    # Útil para detectar "ya compró → postventa" o "ya se enfrió antes".
    # Se desactiva con HISTORY_LOOKUP=false si introduce problemas.
    history = None
    if os.getenv("HISTORY_LOOKUP", "true").lower() != "false":
        try:
            history = db.get_lead_history_by_phone(lead["phone"], lead_id)
        except Exception as e:
            log.warning("lead %s: no se pudo traer historial: %s", lead_id, e)
            history = None

    hints = _format_hints(metadata, computed, transcript, history=history)

    # ─── Two-pass (#9): triage con Haiku antes de gastar Sonnet ────────
    # Si el chat es spam / número equivocado / datos insuficientes, lo
    # resolvemos con Haiku (1/15 del costo de Sonnet) y salimos.
    # Solo los "analizables" escalan a Sonnet.
    #
    # OPTIMIZACIÓN: en retries (analysis_retry_count > 0) NO re-triageamos.
    # Si el lead ya llegó a Sonnet en el primer intento, sabemos que
    # verdict fue "analizable" (sino write_triage_verdict lo habría
    # cerrado). Evita cobrar Haiku múltiples veces en outages de Anthropic.
    triage_cost = 0.0
    retry_count = int(lead.get("analysis_retry_count") or 0)
    should_triage = TWO_PASS_ENABLED and retry_count == 0
    if should_triage:
        try:
            verdict, triage_cost = client.triage(transcript)
        except Exception as e:
            log.warning("lead %s triage fallo, cayendo a single-pass Sonnet: %s",
                        lead_id, e)
            verdict = "analizable"

        if verdict in TRIAGE_TERMINAL_STATES:
            # Cerrar el análisis directamente — no vale la pena Sonnet.
            # write_triage_verdict es ATÓMICO (única transacción):
            # actualiza leads + outcomes + summaries + history de un solo
            # commit, así no quedan filas 'processing' huérfanas si falla.
            log.info("lead %s → %s (triage Haiku, costo $%.6f)",
                     lead_id, verdict, triage_cost)
            db.write_triage_verdict(
                lead_id, conversation_id, verdict,
                f"Clasificado como {verdict} por triage. {_short_summary(transcript)}",
                CHEAP_MODEL, triage_cost,
            )
            return True, triage_cost

    # Promover a 'processing' JUSTO antes de la llamada a Claude. Así si
    # cae un transitorio (5xx, connection, timeout) NO dejamos una fila
    # 'processing' huérfana en lead_analysis_history — la fila solo se
    # crea si efectivamente la llamada arrancó y tenemos qué completar.
    db.mark_history_processing(lead_id)

    # Errores de red/API de Anthropic: retriables (volverá como pending).
    # Errores de parseo/validación: NO retriables (se marca failed directo
    # porque reintentar sin cambios va a dar el mismo error y cuesta $$).
    #
    # IMPORTANTE: errores TRANSITORIOS de la API de Anthropic (5xx,
    # connection, timeout) NO incrementan retry_count — un outage de 30
    # min de Anthropic no debería "quemar" a todos los pending mandándolos
    # a failed. Solo RateLimitError sí cuenta porque puede ser por culpa
    # nuestra (mucho throughput).
    # Cap defensivo: si un mismo lead lleva >= TRANSIENT_CAP "transitorios"
    # en las últimas 24h, probablemente NO es transitorio (API key mala,
    # cuota agotada, chat que rompe al modelo). Escalar a failed duro para
    # que no ocupe la cola del daemon eternamente.
    TRANSIENT_CAP = int(os.getenv("TRANSIENT_CAP_24H", "10"))

    try:
        raw, cost = client.analyze(transcript, hints)
    except (
        anthropic.APIConnectionError,
        anthropic.APITimeoutError,
        anthropic.InternalServerError,
    ) as e:
        # Transitorios → pending sin incrementar retry. El daemon vuelve
        # a intentar en la próxima vuelta (poll); cuando Anthropic vuelva,
        # el lead se procesa normal sin perder oportunidad.
        # Marcamos la fila 'processing' recién creada como 'failed' con
        # flag transitorio — el próximo ciclo crea otra al invocar
        # mark_history_processing de nuevo. No acumula zombies.
        transient_count = db.count_recent_transient_failures(lead_id, hours=24)
        if transient_count >= TRANSIENT_CAP:
            # Ya no es transitorio — escalar a failed duro.
            db.mark_history_failed(
                lead_id,
                f"escalado tras {transient_count} transitorios consecutivos: {str(e)[:250]}",
            )
            db.mark_status(
                lead_id, "failed", retry_count=MAX_RETRIES,
                error=f"transitorios excedieron {TRANSIENT_CAP} en 24h: {str(e)[:300]}",
            )
            log.error("lead %s escalado a FAILED tras %d transitorios: %s",
                      lead_id, transient_count, e)
            return False, 0.0

        db.mark_history_failed(lead_id, f"transitorio: {str(e)[:300]}")
        db.mark_status(lead_id, "pending", error=f"transitorio: {str(e)[:300]}")
        log.warning("lead %s error transitorio #%d (no cuenta retry): %s",
                    lead_id, transient_count + 1, e)
        return False, 0.0
    except (anthropic.RateLimitError, RetryError) as e:
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

    # Inyectar last_contact_at en `data_dict` para que ghost_score lo
    # pueda leer sin pasar otro argumento a persist_analysis.
    data_dict["_last_contact_at"] = computed.get("last_contact_at")

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

    # Regenerar automáticamente la KB si hubo leads analizados exitosamente.
    # Es una agregación SQL (no toca Claude), costo marginal. Controlado
    # por env var AUTO_REBUILD_KB (default true).
    auto_rebuild = os.getenv("AUTO_REBUILD_KB", "true").lower() in {"1", "true", "yes"}
    if auto_rebuild and ok > 0:
        try:
            from .knowledge_base import build_knowledge_base
            kb_summary = build_knowledge_base()
            log.info("KB regenerada automáticamente: %d entradas totales",
                     kb_summary.get("total_entries", 0))
        except Exception as e:
            log.warning("Fallo al regenerar KB automáticamente: %s", e)

    return {"ok": ok, "fallidos": fail, "costo_total": total_cost}
