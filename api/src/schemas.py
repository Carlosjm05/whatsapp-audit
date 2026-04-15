"""Pydantic response schemas."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    db: str
    redis: str


class FunnelCounts(BaseModel):
    contactado: int = 0
    calificado: int = 0
    visita: int = 0
    venta: int = 0


class OverviewResponse(BaseModel):
    totalConversations: int
    totalLeads: int
    funnel: FunnelCounts
    statusDistribution: List[Dict[str, Any]]
    monthlyVolume: List[Dict[str, Any]]
    recoverableCount: int
    totalRecoverableEstimatedValue: int
    avgIntentScore: Optional[float]
    avgAdvisorScore: Optional[float]


class RecoverableLeadRow(BaseModel):
    id: int
    conversation_id: Optional[str] = None
    phone: Optional[str] = None
    whatsapp_name: Optional[str] = None
    real_name: Optional[str] = None
    city: Optional[str] = None
    zone: Optional[str] = None
    advisor_name: Optional[str] = None
    final_status: Optional[str] = None
    is_recoverable: Optional[bool] = None
    recovery_probability: Optional[str] = None
    recovery_priority: Optional[str] = None
    recovery_strategy: Optional[str] = None
    recovery_message_suggestion: Optional[str] = None
    intent_score: Optional[float] = None
    urgency: Optional[str] = None
    budget_estimated_cop: Optional[int] = None
    budget_range: Optional[str] = None
    product_type: Optional[str] = None
    project_name: Optional[str] = None
    first_contact_at: Optional[str] = None
    last_contact_at: Optional[str] = None
    overall_score: Optional[float] = None


class PagedRecoverableLeads(BaseModel):
    total: int
    limit: int
    offset: int
    rows: List[Dict[str, Any]]


class LeadDetail(BaseModel):
    lead: Dict[str, Any]
    interests: Optional[Dict[str, Any]] = None
    financials: Optional[Dict[str, Any]] = None
    intent: Optional[Dict[str, Any]] = None
    objections: List[Dict[str, Any]] = Field(default_factory=list)
    metrics: Optional[Dict[str, Any]] = None
    response_times: Optional[Dict[str, Any]] = None
    advisor_score: Optional[Dict[str, Any]] = None
    outcome: Optional[Dict[str, Any]] = None
    competitor_intel: List[Dict[str, Any]] = Field(default_factory=list)
    summary: Optional[Dict[str, Any]] = None


class AdvisorSummary(BaseModel):
    advisor_name: str
    total_leads: int
    sold: int
    recoverable: int
    avg_overall_score: Optional[float]
    avg_first_response_minutes: Optional[float]
    common_errors: List[Dict[str, Any]]
    common_strengths: List[Dict[str, Any]]


class ProductIntelResponse(BaseModel):
    demand_by_product_type: List[Dict[str, Any]]
    demand_by_zone: List[Dict[str, Any]]
    budget_range_distribution: List[Dict[str, Any]]
    top_projects_mentioned: List[Dict[str, Any]]
    payment_method_distribution: List[Dict[str, Any]]


class ErrorsResponse(BaseModel):
    top_errors: List[Dict[str, Any]]
    advisors_with_most_errors: List[Dict[str, Any]]
    response_time_stats: Dict[str, Any]
    pct_without_followup: Optional[float]


class CompetitorsResponse(BaseModel):
    top_competitors: List[Dict[str, Any]]
    top_reasons_considering: List[Dict[str, Any]]
    loss_reasons: List[Dict[str, Any]]


class KnowledgeBaseRow(BaseModel):
    id: Optional[int] = None
    entry_type: Optional[str] = None
    category: Optional[str] = None
    content_text: Optional[str] = None
    verbatim_examples: Optional[List[str]] = None
    frequency_count: Optional[int] = None
    ideal_response: Optional[str] = None
