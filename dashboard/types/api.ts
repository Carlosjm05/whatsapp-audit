export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// ─── GHOST LEADS (leads fantasma recuperables) ───────────────
export interface GhostLead {
  [key: string]: unknown;
  id: string;
  conversation_id?: string;
  phone?: string;
  real_name?: string;
  whatsapp_name?: string;
  city?: string;
  occupation?: string | null;
  age_range?: string | null;
  family_context?: string | null;
  advisor_name?: string | null;
  advisors_involved?: string[];
  speed_compliance?: boolean | null;
  followup_compliance?: boolean | null;
  overall_score?: number | string | null;
  intent_score?: number | string;
  urgency?: string;
  budget_estimated_cop?: number | string;
  budget_range?: string;
  product_type?: string;
  project_name?: string;
  final_status?: string;
  perdido_por?: string | null;
  recovery_probability?: string;
  recovery_priority?: string;
  loss_point_verbatim?: string | null;
  peak_intent_verbatim?: string | null;
  recovery_message_suggestion?: string | null;
  next_concrete_action?: string | null;
  alternative_product?: string | null;
  last_contact_at?: string;
  days_since_contact?: number;
}

export interface GhostLeadsResponse {
  total: number;
  rows: GhostLead[];
}

// ─── CATÁLOGOS ───────────────────────────────────────────────
export interface ProjectCatalog {
  id: string;
  canonical_name: string;
  aliases: string[];
  project_type?: string | null;
  city?: string | null;
  description?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AdvisorCatalog {
  id: string;
  canonical_name: string;
  aliases: string[];
  phone?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface FunnelStage {
  [key: string]: unknown;
  stage: string;
  count: number;
}

export interface StatusBucket {
  [key: string]: unknown;
  final_status: string;
  count: number;
}

export interface MonthlyVolume {
  [key: string]: unknown;
  month: string;
  count: number;
}

// El backend devuelve el funnel como objeto {contactado, calificado,
// visita, venta}; los Charts esperan array. El consumer convierte.
export interface FunnelCounts {
  contactado: number;
  calificado: number;
  visita: number;
  venta: number;
}

export interface OverviewResponse {
  total_conversations: number;
  total_leads: number;
  funnel: FunnelCounts;
  status_distribution: StatusBucket[];
  monthly_volume: MonthlyVolume[];
  recoverable_count: number;
  total_recoverable_estimated_value: number;
  avg_intent_score: number | null;
  avg_advisor_score: number | null;
  // Estado del análisis IA por lead.
  analyzed_count: number;
  pending_count: number;
  processing_count: number;
  failed_count: number;
  insufficient_count: number;
}

// Shape real que devuelve /api/leads/recoverable. Snake_case porque el
// router hace SELECT directo y no mapea (ver api/src/routers/leads.py).
export interface RecoverableLead {
  [key: string]: unknown;
  id: string;
  conversation_id?: string;
  phone?: string;
  whatsapp_name?: string;
  real_name?: string;
  city?: string;
  zone?: string;
  advisor_name?: string;
  final_status?: string;
  is_recoverable?: boolean;
  recovery_probability?: 'alta' | 'media' | 'baja' | 'no_aplica' | string;
  recovery_priority?: 'esta_semana' | 'este_mes' | 'puede_esperar' | 'no_aplica' | string;
  recovery_strategy?: string;
  recovery_message_suggestion?: string;
  intent_score?: number | string;
  urgency?: string;
  budget_estimated_cop?: number | string;
  budget_range?: string;
  product_type?: string;
  project_name?: string;
  first_contact_at?: string;
  last_contact_at?: string;
  overall_score?: number | string;
}

export interface RecoverableLeadsResponse {
  total: number;
  limit: number;
  offset: number;
  rows: RecoverableLead[];
}

// ─── LEAD DETAIL (estructura anidada que devuelve /api/leads/{id}) ──

export interface LeadRow {
  [key: string]: unknown;
  id: string;
  conversation_id?: string;
  phone?: string;
  whatsapp_name?: string;
  real_name?: string;
  city?: string;
  zone?: string;
  lead_source?: string;
  lead_source_detail?: string;
  first_contact_at?: string;
  last_contact_at?: string;
  conversation_days?: number;
  datos_insuficientes?: boolean;
  analysis_status?: string;
  analyzed_at?: string;
}

export interface LeadInterests {
  [key: string]: unknown;
  product_type?: string;
  project_name?: string;
  all_projects_mentioned?: string[];
  desired_zone?: string;
  desired_size?: string;
  desired_features?: string;
  purpose?: string;
  specific_conditions?: string;
}

export interface LeadFinancials {
  [key: string]: unknown;
  budget_verbatim?: string;
  budget_estimated_cop?: number;
  budget_range?: string;
  payment_method?: string;
  has_bank_preapproval?: string;
  offers_trade_in?: string;
  depends_on_selling?: string;
  positive_financial_signals?: string[];
  negative_financial_signals?: string[];
}

export interface LeadIntent {
  [key: string]: unknown;
  intent_score?: number;
  intent_justification?: string;
  urgency?: string;
  high_urgency_signals?: string[];
  low_urgency_signals?: string[];
  is_decision_maker?: string;
  comparing_competitors?: boolean;
}

export interface LeadObjection {
  [key: string]: unknown;
  objection_text?: string;
  objection_verbatim?: string;
  objection_type?: string;
  was_resolved?: boolean;
  advisor_response?: string;
  response_quality?: number;
  is_hidden_objection?: boolean;
}

export interface ConversationMetricsRow {
  [key: string]: unknown;
  total_messages?: number;
  advisor_messages?: number;
  lead_messages?: number;
  advisor_audios?: number;
  lead_audios?: number;
  sent_project_info?: boolean;
  sent_prices?: boolean;
  asked_qualification_questions?: boolean;
  offered_alternatives?: boolean;
  proposed_visit?: boolean;
  attempted_close?: boolean;
  did_followup?: boolean;
  followup_attempts?: number;
  unanswered_questions?: string[];
}

export interface ResponseTimesRow {
  [key: string]: unknown;
  first_response_minutes?: number;
  avg_response_minutes?: number;
  longest_gap_hours?: number;
  unanswered_messages_count?: number;
  lead_had_to_repeat?: boolean;
  advisor_active_hours?: string;
  response_time_category?: string;
}

export interface AdvisorScoreRow {
  [key: string]: unknown;
  advisor_name?: string;
  advisor_phone?: string;
  speed_score?: number;
  qualification_score?: number;
  product_presentation_score?: number;
  objection_handling_score?: number;
  closing_attempt_score?: number;
  followup_score?: number;
  overall_score?: number;
  errors_list?: string[];
  strengths_list?: string[];
}

export interface ConversationOutcomeRow {
  [key: string]: unknown;
  final_status?: string;
  loss_reason?: string;
  loss_point_description?: string;
  is_recoverable?: boolean;
  recovery_probability?: string;
  recovery_reason?: string;
  not_recoverable_reason?: string;
  recovery_strategy?: string;
  recovery_message_suggestion?: string;
  alternative_product?: string;
  recovery_priority?: string;
}

export interface CompetitorIntelRow {
  [key: string]: unknown;
  competitor_name?: string;
  competitor_offer?: string;
  why_considering?: string;
  went_with_competitor?: boolean;
  reason_chose_competitor?: string;
}

export interface ConversationSummaryRow {
  [key: string]: unknown;
  summary_text?: string;
  key_takeaways?: string[];
}

export interface LeadDetail {
  lead: LeadRow;
  interests?: LeadInterests | null;
  financials?: LeadFinancials | null;
  intent?: LeadIntent | null;
  objections: LeadObjection[];
  metrics?: ConversationMetricsRow | null;
  response_times?: ResponseTimesRow | null;
  advisor_score?: AdvisorScoreRow | null;
  outcome?: ConversationOutcomeRow | null;
  competitor_intel: CompetitorIntelRow[];
  summary?: ConversationSummaryRow | null;
}

// ─── CONVERSATION (mensajes individuales) ────────────────────
export interface ConversationMessage {
  [key: string]: unknown;
  id: string;
  message_id: string;
  timestamp: string;
  sender: 'lead' | 'asesor' | 'system';
  sender_name?: string;
  message_type: string;
  body?: string;
  media_path?: string;
  media_duration_sec?: number;
  media_mimetype?: string;
  transcription_text?: string;
  transcription_confidence?: number;
  is_forwarded?: boolean;
  is_reply?: boolean;
}

export interface ConversationResponse {
  conversation_id: string;
  chat_name?: string;
  phone?: string;
  messages: ConversationMessage[];
  total: number;
}

// ─── ANALYSIS HISTORY ────────────────────────────────────────
export interface AnalysisHistoryEntry {
  [key: string]: unknown;
  id: string;
  lead_id: string;
  triggered_by?: string;
  status: string;
  model_used?: string;
  cost_usd?: number;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  diff_summary?: string;
}

// ─── TRENDS ──────────────────────────────────────────────────
export interface TrendsResponse {
  volumeByMonth: MonthlyVolume[];
  conversionByMonth: MonthlyAdvisor[];
  intentScoreByMonth: { month: string; score: number }[];
  advisorScoreByMonth: { month: string; score: number }[];
  hourDayHeatmap: { dow: number; hour: number; count: number }[];
  productByMonth: { month: string; product: string; count: number }[];
  lossReasonsByMonth: { month: string; reason: string; count: number }[];
  responseTimeByMonth: { month: string; avg_min: number }[];
}

export interface ChartItem {
  [key: string]: unknown;
}

export interface ProjectLeads extends ChartItem {
  project: string;
  leads: number;
}

export interface MonthlyAdvisor extends ChartItem {
  month: string;
  leads: number;
  conversions: number;
}

export interface TypeCount extends ChartItem {
  type: string;
  count: number;
}

// ─── Errores detallados de un asesor ────────────────────────
export interface AdvisorErrorLead {
  lead_id: string;
  real_name?: string | null;
  whatsapp_name?: string | null;
  phone?: string | null;
  overall_score?: number | string | null;
  final_status?: string | null;
  first_response_minutes?: number | string | null;
  last_contact_at?: string | null;
}

export interface AdvisorErrorGroup {
  error_text: string;
  occurrences: number;
  leads: AdvisorErrorLead[];
}

export interface AdvisorErrorsResponse {
  advisor_name: string;
  errors: AdvisorErrorGroup[];
}

// Shape real de /api/advisors (snake_case).
export interface AdvisorRanking {
  [key: string]: unknown;
  advisor_name: string;
  total_leads: number;
  sold: number;
  recoverable: number;
  avg_overall_score: number | string | null;
  avg_first_response_minutes: number | string | null;
  common_errors?: { text: string; count: number }[];
  common_strengths?: { text: string; count: number }[];
}

export interface AdvisorDetail {
  summary: {
    advisor_name: string;
    total_leads: number;
    sold: number;
    recoverable: number;
    avg_overall_score: number | string | null;
    avg_speed_score: number | string | null;
    avg_qualification_score: number | string | null;
    avg_product_presentation_score: number | string | null;
    avg_objection_handling_score: number | string | null;
    avg_closing_attempt_score: number | string | null;
    avg_followup_score: number | string | null;
    avg_first_response_minutes: number | string | null;
    avg_response_minutes: number | string | null;
    avg_longest_gap_hours: number | string | null;
  };
  common_errors: { text: string; count: number }[];
  common_strengths: { text: string; count: number }[];
  outcome_distribution: { final_status: string; count: number }[];
  recent_leads: Array<{
    id: string;
    whatsapp_name?: string;
    real_name?: string;
    phone?: string;
    final_status?: string;
    is_recoverable?: boolean;
    overall_score?: number | string;
    last_contact_at?: string;
  }>;
}

export interface RangeCount extends ChartItem {
  range: string;
  count: number;
}

export interface ZoneCount extends ChartItem {
  zone: string;
  count: number;
}

export interface ProjectConversions extends ChartItem {
  project: string;
  leads: number;
  conversions: number;
}

export interface BedroomsCount extends ChartItem {
  bedrooms: string;
  count: number;
}

// Shape real que devuelve /api/product-intel (snake_case).
export interface ProductIntel {
  demand_by_product_type: Array<{ product_type: string; count: number; [key: string]: unknown }>;
  demand_by_zone: Array<{ zone: string; count: number; [key: string]: unknown }>;
  budget_range_distribution: Array<{ budget_range: string; count: number; [key: string]: unknown }>;
  top_projects_mentioned: Array<{ project: string; count: number; [key: string]: unknown }>;
  payment_method_distribution: Array<{ payment_method: string; count: number; [key: string]: unknown }>;
}

export interface BucketCount extends ChartItem {
  bucket: string;
  count: number;
}

// Shape real que devuelve /api/errors.
export interface ErrorsOverview {
  top_errors: Array<{ error_text: string; count: number; [key: string]: unknown }>;
  advisors_with_most_errors: Array<{
    advisor_name: string;
    total_errors: number;
    total_leads: number;
    avg_overall_score: number | string | null;
    [key: string]: unknown;
  }>;
  response_time_stats: {
    avg_first_response_minutes?: number | string | null;
    p50_first_response_minutes?: number | string | null;
    p95_first_response_minutes?: number | string | null;
    avg_response_minutes?: number | string | null;
    avg_longest_gap_hours?: number | string | null;
    // Métricas de domingo (separadas, no entran al SLA).
    sunday_avg_minutes?: number | string | null;
    sunday_total_responses?: number | string | null;
    leads_with_sunday_activity?: number | string | null;
  };
  pct_without_followup: number | null;
}

// Shape real que devuelve /api/competitors (snake_case).
export interface CompetitorsIntel {
  top_competitors: Array<{
    competitor_name: string;
    mentions: number;
    lost_to_competitor: number;
    [key: string]: unknown;
  }>;
  top_reasons_considering: Array<{
    reason: string;
    count: number;
    [key: string]: unknown;
  }>;
  loss_reasons: Array<{
    loss_reason: string;
    count: number;
    [key: string]: unknown;
  }>;
}

export interface KnowledgeEntry {
  [key: string]: unknown;
  id: string;
  entry_type: string;           // pregunta_frecuente, objecion_comun, etc.
  category?: string | null;     // tema (ej. "precio", "ubicacion")
  content_text: string;          // texto principal de la entrada
  verbatim_examples?: string[];
  frequency_count?: number;
  ideal_response?: string | null;
}

export interface KnowledgeBaseResponse {
  total: number;
  limit: number;
  offset: number;
  rows: KnowledgeEntry[];
}
