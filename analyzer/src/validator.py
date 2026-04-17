from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from .enums import (
    BUDGET_RANGES,
    DECISION_MAKERS,
    FINAL_STATUSES,
    LEAD_SOURCES,
    OBJECTION_TYPES,
    PAYMENT_METHODS,
    PRODUCT_TYPES,
    PURPOSES,
    RECOVERY_PRIORITY,
    RECOVERY_PROB,
    URGENCIES,
    YES_NO_UNKNOWN,
)


def _in(s: set, default=None):
    """Validator que garantiza que el valor esté en `s`. Si no lo está,
    coacciona al `default` en vez de romper la validación. Esto evita
    que el analyzer marque leads como 'failed' por variaciones menores
    en la salida de Claude (que luego rompen el CHECK de Postgres).
    """
    def _v(cls, v):
        if v is None:
            return v
        if v in s:
            return v
        return default
    return _v


def _coerce_yes_no_unknown(v):
    """Coacciona bool/string a 'si'/'no'/'desconocido'. El prompt ya pide
    explícitamente strings, pero mantenemos esta coerción por si Claude
    regresa al bool (defensa en profundidad)."""
    if v is None:
        return "desconocido"
    if isinstance(v, bool):
        return "si" if v else "no"
    if isinstance(v, str):
        s = v.strip().lower()
        if s in {"si", "sí", "yes", "true"}:
            return "si"
        if s in {"no", "false"}:
            return "no"
        if s in YES_NO_UNKNOWN:
            return s
    return "desconocido"


AGE_RANGES = {"18-25", "25-35", "35-50", "50-65", "65+", "desconocido"}
ANALYSIS_CONFIDENCE = {"alta", "media", "baja"}


class LeadCore(BaseModel):
    real_name: Optional[str] = None
    city: Optional[str] = None
    zone: Optional[str] = None
    # Demografía inferida del chat (prompt v2).
    occupation: Optional[str] = None
    age_range: Optional[str] = None
    family_context: Optional[str] = None
    analysis_confidence: Optional[str] = None
    lead_source: Optional[str] = "desconocido"
    lead_source_detail: Optional[str] = None
    conversation_days: Optional[int] = None
    datos_insuficientes: bool = False

    _v_src = field_validator("lead_source")(_in(LEAD_SOURCES, default="desconocido"))
    _v_age = field_validator("age_range")(_in(AGE_RANGES, default=None))
    _v_conf = field_validator("analysis_confidence")(_in(ANALYSIS_CONFIDENCE, default=None))


class LeadInterest(BaseModel):
    product_type: Optional[str] = "otro"
    project_name: Optional[str] = None
    all_projects_mentioned: List[str] = Field(default_factory=list)
    desired_zone: Optional[str] = None
    desired_size: Optional[str] = None
    desired_features: Optional[str] = None
    purpose: Optional[str] = "no_especificado"
    specific_conditions: Optional[str] = None

    _v_pt = field_validator("product_type")(_in(PRODUCT_TYPES, default="otro"))
    _v_pu = field_validator("purpose")(_in(PURPOSES, default="no_especificado"))


class LeadFinancials(BaseModel):
    budget_verbatim: Optional[str] = None
    budget_estimated_cop: Optional[int] = None
    budget_range: Optional[str] = "no_especificado"
    payment_method: Optional[str] = "no_especificado"
    has_bank_preapproval: Optional[str] = "desconocido"
    offers_trade_in: Optional[str] = "desconocido"
    depends_on_selling: Optional[str] = "desconocido"
    positive_financial_signals: List[str] = Field(default_factory=list)
    negative_financial_signals: List[str] = Field(default_factory=list)

    _v_br = field_validator("budget_range")(_in(BUDGET_RANGES, default="no_especificado"))
    _v_pm = field_validator("payment_method")(_in(PAYMENT_METHODS, default="no_especificado"))
    _v_bp = field_validator("has_bank_preapproval")(_in(YES_NO_UNKNOWN, default="desconocido"))
    _v_ot = field_validator("offers_trade_in", mode="before")(
        lambda cls, v: _coerce_yes_no_unknown(v))
    _v_ds = field_validator("depends_on_selling", mode="before")(
        lambda cls, v: _coerce_yes_no_unknown(v))


class LeadIntent(BaseModel):
    intent_score: int = 5
    intent_justification: Optional[str] = None
    urgency: Optional[str] = "no_especificado"
    high_urgency_signals: List[str] = Field(default_factory=list)
    low_urgency_signals: List[str] = Field(default_factory=list)
    is_decision_maker: Optional[str] = "desconocido"
    comparing_competitors: bool = False

    _v_u = field_validator("urgency")(_in(URGENCIES, default="no_especificado"))
    _v_dm = field_validator("is_decision_maker")(_in(DECISION_MAKERS, default="desconocido"))

    @field_validator("intent_score")
    @classmethod
    def _score_range(cls, v):
        if v < 1:
            return 1
        if v > 10:
            return 10
        return v


class Objection(BaseModel):
    objection_text: str
    objection_verbatim: Optional[str] = None
    objection_type: Optional[str] = "otro"
    was_resolved: bool = False
    advisor_response: Optional[str] = None
    response_quality: int = 5
    is_hidden_objection: bool = False

    _v_obt = field_validator("objection_type")(_in(OBJECTION_TYPES, default="otro"))

    @field_validator("response_quality")
    @classmethod
    def _q(cls, v):
        return max(1, min(10, v))


class ConversationMetrics(BaseModel):
    """Solo los campos que el prompt pide a Claude. Los contadores
    (total_messages, advisor_messages, etc.) los calcula `analyzer.py`
    directamente a partir de los mensajes — no vienen en el JSON de Claude."""
    sent_project_info: bool = False
    sent_prices: bool = False
    asked_qualification_questions: bool = False
    offered_alternatives: bool = False
    proposed_visit: bool = False
    attempted_close: bool = False
    did_followup: bool = False
    followup_attempts: int = 0
    used_generic_messages: bool = False
    answered_all_questions: bool = False
    unanswered_questions: List[str] = Field(default_factory=list)


class ResponseTimes(BaseModel):
    """Solo lo que el prompt pide a Claude. Los campos
    first_response_minutes, avg_response_minutes, longest_gap_hours,
    advisor_active_hours y response_time_category los calcula
    `analyzer.py` directamente."""
    unanswered_messages_count: int = 0
    lead_had_to_repeat: bool = False
    repeat_count: int = 0


class AdvisorScores(BaseModel):
    advisor_name: Optional[str] = None
    advisors_involved: List[str] = Field(default_factory=list)
    advisor_phone: Optional[str] = None
    speed_score: int = 5
    qualification_score: int = 5
    product_presentation_score: int = 5
    objection_handling_score: int = 5
    closing_attempt_score: int = 5
    followup_score: int = 5
    overall_score: float = 5.0
    # Compliance binarios (SLA 10 min + seguimiento).
    speed_compliance: Optional[bool] = None
    followup_compliance: Optional[bool] = None
    errors_list: List[str] = Field(default_factory=list)
    strengths_list: List[str] = Field(default_factory=list)

    @field_validator(
        "speed_score", "qualification_score", "product_presentation_score",
        "objection_handling_score", "closing_attempt_score", "followup_score",
    )
    @classmethod
    def _clip(cls, v):
        return max(1, min(10, int(v)))

    @field_validator("overall_score")
    @classmethod
    def _oclip(cls, v):
        return round(max(1.0, min(10.0, float(v))), 2)


PERDIDO_POR = {
    "asesor_lento", "asesor_sin_seguimiento", "asesor_no_califico",
    "asesor_no_cerro", "asesor_info_incompleta",
    "asesor_no_consulto_de_vuelta",
    "lead_desaparecio", "lead_fuera_portafolio", "lead_sin_decision",
    "lead_presupuesto", "lead_competencia", "ambos", "no_aplica",
}


class ConversationOutcome(BaseModel):
    final_status: Optional[str] = "nunca_calificado"
    loss_reason: Optional[str] = None
    loss_point_description: Optional[str] = None
    loss_point_verbatim: Optional[str] = None
    peak_intent_verbatim: Optional[str] = None
    is_recoverable: bool = False
    recovery_probability: Optional[str] = "no_aplica"
    recovery_reason: Optional[str] = None
    not_recoverable_reason: Optional[str] = None
    recovery_strategy: Optional[str] = None
    recovery_message_suggestion: Optional[str] = None
    alternative_product: Optional[str] = None
    recovery_priority: Optional[str] = "no_aplica"
    perdido_por: Optional[str] = None
    next_concrete_action: Optional[str] = None

    _v_fs = field_validator("final_status")(_in(FINAL_STATUSES, default="nunca_calificado"))
    _v_rp = field_validator("recovery_probability")(_in(RECOVERY_PROB, default="no_aplica"))
    _v_rpr = field_validator("recovery_priority")(_in(RECOVERY_PRIORITY, default="no_aplica"))
    _v_pp = field_validator("perdido_por")(_in(PERDIDO_POR, default=None))


class CompetitorIntel(BaseModel):
    competitor_name: str
    competitor_offer: Optional[str] = None
    why_considering: Optional[str] = None
    went_with_competitor: bool = False
    reason_chose_competitor: Optional[str] = None


class ConversationSummary(BaseModel):
    summary_text: str = ""
    key_takeaways: List[str] = Field(default_factory=list)


class AnalysisOutput(BaseModel):
    lead: LeadCore
    interest: LeadInterest = Field(default_factory=LeadInterest)
    financials: LeadFinancials = Field(default_factory=LeadFinancials)
    intent: LeadIntent = Field(default_factory=LeadIntent)
    objections: List[Objection] = Field(default_factory=list)
    metrics: ConversationMetrics = Field(default_factory=ConversationMetrics)
    response_times: ResponseTimes = Field(default_factory=ResponseTimes)
    advisor: AdvisorScores = Field(default_factory=AdvisorScores)
    outcome: ConversationOutcome = Field(default_factory=ConversationOutcome)
    competitors: List[CompetitorIntel] = Field(default_factory=list)
    summary: ConversationSummary = Field(default_factory=ConversationSummary)
