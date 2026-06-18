// Types + constants thuần của AgentPcDashboard (tách nguyên văn từ component).
export type AgentPcRow = {
  agent_name: string | null;
  agency_name: string | null;
  insured_name: string | null;
  type: string | null;
  company: string | null;
  policy_number: string | null;
  premium: number | null;
  true_premium: number | null;
  carrier_commission: number | null;
  effective_date: string | null;
  expired_date: string | null;
  status: string | null;
  paid_producer: string | null;
  statement_number: string | null;
  agent_commission_amount: number | null;
  state: string | null;
  city: string | null;
};

export type AgentPcExpiredMonthRow = {
  monthKey: string;
  policyCount: number;
  totalPremium: number;
};

export type AgentPcFilterOptions = {
  agencies: string[];
  paidDates: string[];
};

export type AgentPcFilterValues = {
  agency: string;
  paidDate: string;
  policyNumber: string;
};

export const UNPAID_PAID_DATE_LABEL = "Unpaid";

export type TrendLevel = "month" | "quarter" | "year";
export type CommissionView = "paid" | "unpaid";

export type Summary = {
  policyCount: number;
  activePolicyCount: number;
  renewalPolicyCount: number;
  totalPremium: number;
  agentCommission: number;
};

export type PeriodSummary = Summary & {
  periodKey: string;
  periodLabel: string;
};

export type PeriodGrowthRow = PeriodSummary & {
  agentCommissionChange: number | null;
  agentCommissionChangePercent: number | null;
  policyChange: number | null;
  policyChangePercent: number | null;
  premiumChange: number | null;
  premiumChangePercent: number | null;
};

export type CarrierSummary = Summary & {
  company: string;
  policySharePercent: number;
  agentCommissionRate: number;
};

export type StateCityRow = Summary & {
  state: string;
  city: string;
  isTotal: boolean;
  policySharePercent: number;
};

export type StateGroup = {
  state: string;
  rows: StateCityRow[];
};

export type PolicyDetailRow = {
  agency: string;
  agent: string;
  carrier: string;
  effectiveDate: string | null;
  expiredDate: string | null;
  insuredName: string;
  policyNumber: string;
  paid: string;
  premium: number;
  agentCommission: number;
  status: string;
  type: string;
};

export type UnpaidPeriodSummary = {
  periodKey: string;
  periodLabel: string;
  policyCount: number;
  totalPremium: number;
  agentCommission: number;
};

export type DashboardData = {
  carrierRows: CarrierSummary[];
  stateGroups: StateGroup[];
  statePolicyCounts: Record<string, number>;
  overview: Summary;
  growthRowsByLevel: Record<TrendLevel, PeriodGrowthRow[]>;
  policyDetailRows: PolicyDetailRow[];
  periodsByLevel: Record<TrendLevel, PeriodSummary[]>;
  unpaidPeriodsByLevel: Record<TrendLevel, UnpaidPeriodSummary[]>;
};

export type SortDirection = "asc" | "desc";
export type PolicySortKey =
  | "agent"
  | "insuredName"
  | "policyNumber"
  | "carrier"
  | "agency"
  | "paid"
  | "premium"
  | "agentCommission"
  | "effectiveDate"
  | "expiredDate"
  | "status";
export type PolicySortState = { key: PolicySortKey; direction: SortDirection };
export type PolicyFilterOption = { label: string; value: string };
export type DateRange = { from: string; to: string };

export const TREND_LIMIT_BY_LEVEL: Record<TrendLevel, number> = {
  month: 12,
  quarter: 8,
  year: 5,
};
export const SALES_MOM_VISIBLE_ROW_COUNT = 6;
export const SALES_MOM_HEADER_HEIGHT_PX = 44;
export const SALES_MOM_ROW_HEIGHT_PX = 56;
export const SALES_MOM_SCROLL_MAX_HEIGHT =
  SALES_MOM_HEADER_HEIGHT_PX +
  SALES_MOM_VISIBLE_ROW_COUNT * SALES_MOM_ROW_HEIGHT_PX;
export const POLICY_DETAIL_VISIBLE_ROW_COUNT = 10;
export const POLICY_DETAIL_HEADER_HEIGHT_PX = 48;
export const POLICY_DETAIL_ROW_HEIGHT_PX = 48;
export const POLICY_DETAIL_TABLE_MAX_HEIGHT =
  POLICY_DETAIL_HEADER_HEIGHT_PX +
  POLICY_DETAIL_VISIBLE_ROW_COUNT * POLICY_DETAIL_ROW_HEIGHT_PX;
