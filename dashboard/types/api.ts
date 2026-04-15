export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface FunnelStage {
  stage: string;
  count: number;
}

export interface StatusBucket {
  status: string;
  count: number;
}

export interface MonthlyVolume {
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

export interface LeadDetail extends RecoverableLead {
  email?: string;
  budgetMin?: number;
  budgetMax?: number;
  preferredZones?: string[];
  bedrooms?: number;
  objections?: { text: string; category?: string; createdAt?: string }[];
  timeline?: { at: string; type: string; summary: string }[];
  advisorScoring?: {
    responseTimeScore?: number;
    followupScore?: number;
    qualityScore?: number;
    overall?: number;
    notes?: string;
  };
  recoveryStrategy?: {
    recommendedAction?: string;
    scriptSuggestion?: string;
    bestChannel?: string;
    bestTimeToContact?: string;
    nextSteps?: string[];
  };
  financials?: {
    estimatedValue?: number;
    commissionEstimate?: number;
    financingInterest?: boolean;
    downPaymentPct?: number;
  };
  notes?: string;
}

export interface AdvisorRanking {
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
  topProjects?: { project: string; leads: number }[];
  monthly?: { month: string; leads: number; conversions: number }[];
  errorsByType?: { type: string; count: number }[];
}

export interface ProductIntel {
  budgetDistribution: { range: string; count: number }[];
  topZones: { zone: string; count: number }[];
  topProjects: { project: string; leads: number; conversions: number }[];
  bedroomsDemand: { bedrooms: string; count: number }[];
  propertyTypes: { type: string; count: number }[];
}

export interface ErrorsIntel {
  topErrors: { type: string; count: number }[];
  responseTimeHistogram: { bucket: string; count: number }[];
  followupStats: {
    withFollowup: number;
    withoutFollowup: number;
    avgFollowups: number;
    lostDueToNoFollowup: number;
  };
}

export interface CompetitorsIntel {
  topCompetitors: { name: string; mentions: number; lostDeals: number }[];
  lossReasons: { reason: string; count: number }[];
}

export interface KnowledgeEntry {
  id: string;
  entry_type: string;
  title: string;
  content: string;
  tags?: string[];
  createdAt?: string;
  sourceConversationId?: string;
}
