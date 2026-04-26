"""Score de priorización para /ghosts (#10).

Hoy `is_recoverable` es un booleano — no permite ordenar por ROI real de
recuperación. Este módulo calcula un score 0..100 ponderando:

- intent_score:             peso 30 (señal principal)
- urgency:                  peso 15 (comprar_ya > mas_6_meses)
- budget:                   peso 15 (más plata potencial = más prioritario)
- recency decay:            peso 20 (chats recientes > viejos)
- advisor fault:            peso 10 (culpa asesor = fácil de recuperar)
- IS_recoverable del análisis: peso 10 (señal compuesta del LLM)

Diseño: scores bajos NO son 0 — damos un mínimo de 5 para que todos los
leads recuperables aparezcan, solo con distinta prioridad.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, Optional


_URGENCY_WEIGHT = {
    "comprar_ya":      1.00,
    "1_3_meses":       0.80,
    "3_6_meses":       0.55,
    "mas_6_meses":     0.30,
    "no_sabe":         0.50,
    "no_especificado": 0.40,
}

_BUDGET_WEIGHT = {
    "mas_500m":        1.00,
    "200_500m":        0.85,
    "100_200m":        0.65,
    "50_100m":         0.45,
    "menos_50m":       0.25,
    "no_especificado": 0.40,
}

# perdido_por: si es culpa del asesor, es MÁS fácil de resucitar (basta
# con que Óscar asigne a otro asesor y retome). Si es del lead, es más difícil.
_FAULT_WEIGHT = {
    "asesor_lento":                 1.00,
    "asesor_sin_seguimiento":       1.00,
    "asesor_no_califico":           0.95,
    "asesor_no_cerro":              0.90,
    "asesor_info_incompleta":       0.90,
    "asesor_no_consulto_de_vuelta": 0.95,
    "lead_desaparecio":             0.60,
    "lead_fuera_portafolio":        0.30,
    "lead_sin_decision":            0.55,
    "lead_presupuesto":             0.35,
    "lead_competencia":             0.25,
    "ambos":                        0.70,
    "no_aplica":                    0.50,
}


def _recency_decay(last_contact_at: Any) -> float:
    """Decay exponencial APLANADO: 1.0 en el día, ~0.78 a 30 días,
    ~0.47 a 90 días, ~0.22 a 180 días, ~0.05 a 360 días.

    Antes era e^(-days/45) — descartaba leads viejos demasiado rápido.
    Óscar dice (2026-04-26): "nunca es muy tarde para retomar un lead,
    a las personas hay que escribirles hasta que se cansen". Curva más
    suave deja que leads de 6+ meses sigan apareciendo en /ghosts con
    score moderado en vez de aparecer al fondo.

    Si no hay fecha, asume 90 días (~0.47).
    """
    if last_contact_at is None:
        return 0.47
    try:
        if isinstance(last_contact_at, str):
            # ISO 8601 con Z o offset.
            dt = datetime.fromisoformat(last_contact_at.replace("Z", "+00:00"))
        else:
            dt = last_contact_at
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        delta_days = (datetime.now(timezone.utc) - dt).days
    except (ValueError, TypeError, AttributeError):
        return 0.47
    delta_days = max(0, delta_days)
    return math.exp(-delta_days / 120.0)


def compute_ghost_score(
    intent_score: Optional[int],
    urgency: Optional[str],
    budget_range: Optional[str],
    last_contact_at: Any,
    perdido_por: Optional[str],
    is_recoverable: Optional[bool],
    final_status: Optional[str],
) -> int:
    """Devuelve un entero 0..100. Si el lead está cerrado (venta o cliente
    existente o spam), devuelve 0 porque no hay nada que recuperar."""
    # Cortes duros: leads que NO son recuperables → 0.
    if final_status in {"venta_cerrada", "cliente_existente", "spam",
                        "numero_equivocado", "descalificado",
                        "datos_insuficientes"}:
        return 0

    # Factor principal: intent_score en escala 0..1.
    intent_norm = (max(1, min(10, int(intent_score))) / 10.0) if intent_score else 0.3
    urgency_w = _URGENCY_WEIGHT.get((urgency or "").lower(), 0.4)
    budget_w = _BUDGET_WEIGHT.get((budget_range or "").lower(), 0.4)
    recency_w = _recency_decay(last_contact_at)
    fault_w = _FAULT_WEIGHT.get((perdido_por or "").lower(), 0.5)
    rec_bonus = 0.85 if is_recoverable else 0.6

    # Suma ponderada de factores (cada uno contribuye su peso × factor [0..1]).
    score = (
        30.0 * intent_norm +
        15.0 * urgency_w +
        15.0 * budget_w +
        20.0 * recency_w +
        10.0 * fault_w +
        10.0 * rec_bonus
    )
    # Clip [5, 100] — nunca devolvemos 0 para leads no-cerrados, así el
    # dashboard los muestra todos con algo de prioridad.
    return int(round(max(5.0, min(100.0, score))))


def compute_from_analysis(data: Dict[str, Any], last_contact_at: Any) -> int:
    """Helper: extrae los campos del JSON validado de Claude y llama
    compute_ghost_score."""
    intent = data.get("intent") or {}
    fin = data.get("financials") or {}
    outcome = data.get("outcome") or {}
    return compute_ghost_score(
        intent_score=intent.get("intent_score"),
        urgency=intent.get("urgency"),
        budget_range=fin.get("budget_range"),
        last_contact_at=last_contact_at,
        perdido_por=outcome.get("perdido_por"),
        is_recoverable=outcome.get("is_recoverable"),
        final_status=outcome.get("final_status"),
    )
