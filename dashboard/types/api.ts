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
