from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


LEAD_SOURCES = {
    "anuncio_facebook", "anuncio_instagram", "google_ads", "referido",
    "busqueda_organica", "portal_inmobiliario", "otro", "desconocido",
}
PRODUCT_TYPES = {
    "lote", "arriendo", "compra_inmueble", "inversion", "local_comercial",
    "bodega", "finca", "otro",
}
PURPOSES = {
    "vivienda_propia", "inversion", "negocio", "arrendar_terceros", "otro",
    "no_especificado",
}
BUDGET_RANGES = {
    "menos_50m", "50_100m", "100_200m", "200_500m", "mas_500m",
    "no_especificado",
}
PAYMENT_METHODS = {
    "contado", "credito_bancario", "leasing", "financiacion_directa",
    "cuotas", "subsidio", "mixto", "no_especificado",
}
YES_NO_UNKNOWN = {"si", "no", "desconocido"}
URGENCIES = {
    "comprar_ya", "1_3_meses", "3_6_meses", "mas_6_meses", "no_sabe",
    "no_especificado",
}
DECISION_MAKERS = {"si", "no_pareja", "no_socio", "no_familiar", "desconocido"}
OBJECTION_TYPES = {
    "precio", "ubicacion", "confianza", "tiempo", "financiacion",
    "competencia", "condiciones_inmueble", "documentacion", "otro",
}
RESPONSE_TIME_CATEGORIES = {"excelente", "bueno", "regular", "malo", "critico"}
FINAL_STATUSES = {
    "venta_cerrada", "visita_agendada", "negociacion_activa",
    "seguimiento_activo", "se_enfrio", "ghosteado_por_asesor",
    "ghosteado_por_lead", "descalificado", "nunca_calificado", "spam",
    "numero_equivocado", "datos_insuficientes",
}
RECOVERY_PROB = {"alta", "media", "baja", "no_aplica"}
RECOVERY_PRIORITY = {"esta_semana", "este_mes", "puede_esperar", "no_aplica"}


def _in(s: set):
    def _v(cls, v):
        if v is None:
            return v
        if v not in s:
            raise ValueError(f"value {v!r} not in {s}")
        return v
    return _v


class LeadCore(BaseModel):
    real_name: Optional[str] = None
    city: Optional[str] = None
    zone: Optional[str] = None
    lead_source: Optional[str] = "desconocido"
    lead_source_detail: Optional[str] = None
    conversation_days: Optional[int] = None
    datos_insuficientes: bool = False

    _v_src = field_validator("lead_source")(_in(LEAD_SOURCES))


class LeadInterest(BaseModel):
    product_type: Optional[str] = "otro"
    project_name: Optional[str] = None
    all_projects_mentioned: List[str] = Field(default_factory=list)
    desired_zone: Optional[str] = None
    desired_size: Optional[str] = None
    desired_features: Optional[str] = None
    purpose: Optional[str] = "no_especificado"
    specific_conditions: Optional[str] = None

    _v_pt = field_validator("product_type")(_in(PRODUCT_TYPES))
    _v_pu = field_validator("purpose")(_in(PURPOSES))


class LeadFinancials(BaseModel):
    budget_verbatim: Optional[str] = None
    budget_estimated_cop: Optional[int] = None
    budget_range: Optional[str] = "no_especificado"
    payment_method: Optional[str] = "no_especificado"
    has_bank_preapproval: Optional[str] = "desconocido"
    offers_trade_in: Optional[bool] = False
    depends_on_selling: Optional[bool] = False
    positive_financial_signals: List[str] = Field(default_factory=list)
    negative_financial_signals: List[str] = Field(default_factory=list)

    _v_br = field_validator("budget_range")(_in(BUDGET_RANGES))
    _v_pm = field_validator("payment_method")(_in(PAYMENT_METHODS))
    _v_bp = field_validator("has_bank_preapproval")(_in(YES_NO_UNKNOWN))


class LeadIntent(BaseModel):
    intent_score: int = 1
    intent_justification: Optional[str] = None
    urgency: Optional[str] = "no_especificado"
    high_urgency_signals: List[str] = Field(default_factory=list)
    low_urgency_signals: List[str] = Field(default_factory=list)
    is_decision_maker: Optional[str] = "desconocido"
    comparing_competitors: bool = False

    _v_u = field_validator("urgency")(_in(URGENCIES))
    _v_dm = field_validator("is_decision_maker")(_in(DECISION_MAKERS))

    @field_validator("intent_score")
    @classmethod
    def _score_range(cls, v):
        if v < 1: return 1
        if v > 10: return 10
        return v


class Objection(BaseModel):
    objection_text: str
    objection_verbatim: Optional[str] = None
    objection_type: Optional[str] = "otro"
    was_resolved: bool = False
    advisor_response: Optional[str] = None
    response_quality: int = 5
    is_hidden_objection: bool = False

    _v_ot = field_validator("objection_type")(_in(OBJECTION_TYPES))

    @field_validator("response_quality")
    @classmethod
    def _q(cls, v):
        return max(1, min(10, v))


class ConversationMetrics(BaseModel):
    total_messages: int = 0
    advisor_messages: int = 0
    lead_messages: int = 0
    advisor_audios: int = 0
    lead_audios: int = 0
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
    first_response_minutes: Optional[float] = None
    avg_response_minutes: Optional[float] = None
    longest_gap_hours: Optional[float] = None
    unanswered_messages_count: int = 0
    lead_had_to_repeat: bool = False
    repeat_count: int = 0
    advisor_active_hours: Optional[str] = None
    response_time_category: Optional[str] = "regular"

    _v_c = field_validator("response_time_category")(_in(RESPONSE_TIME_CATEGORIES))


class AdvisorScores(BaseModel):
    advisor_name: Optional[str] = None
    advisor_phone: Optional[str] = None
    speed_score: int = 5
    qualification_score: int = 5
    product_presentation_score: int = 5
    objection_handling_score: int = 5
    closing_attempt_score: int = 5
    followup_score: int = 5
    overall_score: float = 5.0
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


class ConversationOutcome(BaseModel):
    final_status: Optional[str] = "nunca_calificado"
    loss_reason: Optional[str] = None
    loss_point_description: Optional[str] = None
    is_recoverable: bool = False
    recovery_probability: Optional[str] = "no_aplica"
    recovery_reason: Optional[str] = None
    not_recoverable_reason: Optional[str] = None
    recovery_strategy: Optional[str] = None
    recovery_message_suggestion: Optional[str] = None
    alternative_product: Optional[str] = None
    recovery_priority: Optional[str] = "no_aplica"

    _v_fs = field_validator("final_status")(_in(FINAL_STATUSES))
    _v_rp = field_validator("recovery_probability")(_in(RECOVERY_PROB))
    _v_rpr = field_validator("recovery_priority")(_in(RECOVERY_PRIORITY))


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
