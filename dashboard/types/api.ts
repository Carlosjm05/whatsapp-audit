export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface FunnelStage {
  [key: string]: unknown;
  stage: string;
  count: number;
}

export interface StatusBucket {
  [key: string]: unknown;
  status: string;
  count: number;
}

export interface MonthlyVolume {
  [key: string]: unknown;
  month: string;
  count: number;
}

export interface OverviewResponse {
  totalConversations: number;
  totalLeads: number;
  funnel: FunnelStage[];
  statusDistribution: StatusBucket[];
  monthlyVolume: MonthlyVolume[];
  recoverableCount: number;
  totalRecoverableEstimatedValue: number;
  avgIntentScore: number;
  avgAdvisorScore: number;
}

export interface RecoverableLead {
  [key: string]: unknown;
  id: string;
  clientName: string;
  phone?: string;
  advisor?: string;
  status?: string;
  priority?: 'alta' | 'media' | 'baja' | string;
  recoveryProbability?: number;
  estimatedValue?: number;
  lastContactAt?: string;
  projectInterest?: string;
  intentScore?: number;
}

export interface RecoverableLeadsResponse {
  items: RecoverableLead[];
  total: number;
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

export interface AdvisorRanking {
  [key: string]: unknown;
  name: string;
  conversations: number;
  leads: number;
  conversionRate: number;
  avgResponseTimeMin: number;
  followupRate: number;
  overallScore: number;
  revenueAttributed?: number;
}

export interface AdvisorDetail extends AdvisorRanking {
  strengths?: string[];
  weaknesses?: string[];
  topProjects?: ProjectLeads[];
  monthly?: MonthlyAdvisor[];
  errorsByType?: TypeCount[];
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

export interface ProductIntel {
  budgetDistribution: RangeCount[];
  topZones: ZoneCount[];
  topProjects: ProjectConversions[];
  bedroomsDemand: BedroomsCount[];
  propertyTypes: TypeCount[];
}

export interface BucketCount extends ChartItem {
  bucket: string;
  count: number;
}

export interface ErrorsIntel {
  topErrors: TypeCount[];
  responseTimeHistogram: BucketCount[];
  followupStats: {
    withFollowup: number;
    withoutFollowup: number;
    avgFollowups: number;
    lostDueToNoFollowup: number;
  };
}

export interface CompetitorMention extends ChartItem {
  name: string;
  mentions: number;
  lostDeals: number;
}

export interface ReasonCount extends ChartItem {
  reason: string;
  count: number;
}

export interface CompetitorsIntel {
  topCompetitors: CompetitorMention[];
  lossReasons: ReasonCount[];
}

export interface KnowledgeEntry {
  [key: string]: unknown;
  id: string;
  entry_type: string;
  title: string;
  content: string;
  tags?: string[];
  createdAt?: string;
  sourceConversationId?: string;
}
