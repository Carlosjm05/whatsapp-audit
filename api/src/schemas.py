"""Schemas Pydantic de respuesta."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str


class FunnelCounts(BaseModel):
    contactado: int = 0
    calificado: int = 0
    visita: int = 0
    venta: int = 0


class OverviewResponse(BaseModel):
    total_conversations: int
    total_leads: int
    funnel: FunnelCounts
    status_distribution: List[Dict[str, Any]]
    monthly_volume: List[Dict[str, Any]]
    recoverable_count: int
    total_recoverable_estimated_value: int
    avg_intent_score: Optional[float] = None
    avg_advisor_score: Optional[float] = None
    # Estado del análisis IA por lead (agregado 2026-04-23 — el panel
    # confundía total_leads con "analizados" cuando en realidad son
    # leads creados, muchos de ellos pending).
    analyzed_count: int = 0
    pending_count: int = 0
    processing_count: int = 0
    failed_count: int = 0
    insufficient_count: int = 0


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
    pct_without_followup: Optional[float] = None


class CompetitorsResponse(BaseModel):
    top_competitors: List[Dict[str, Any]]
    top_reasons_considering: List[Dict[str, Any]]
    loss_reasons: List[Dict[str, Any]]
