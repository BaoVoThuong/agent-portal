// Types + constants thuần của PcSalesDashboard (tách nguyên văn từ component).
import type { CommissionTrendRow } from "./PcCommissionMetricTrendChart";

export type PcSalesRow = {
  agent_name: string | null;
  agency_name: string | null;
  insured_name: string | null;
  type: string | null;
  company: string | null;
  policy_number: string | null;
  premium: number | null;
  effective_date: string | null;
  expired_date: string | null;
  carrier_commission: number | null;
  paid_producer: string | null;
  statement_number: string | null;
  true_premium: number | null;
  expired_month_year: string | null;
  effective_month_year: string | null;
  status: string | null;
  city: string | null;
  state: string | null;
  total_commission: number | null;
  agent_commission_amount: number | null;
  eps_commission_amount: number | null;
};

export type FilterValues = {
  policyNumber: string;
  agent: string;
  agency: string;
  paidProducer: string[];
  statementNumber: string[];
  reportMonthRange: ReportMonthRange;
};

export type ReportMonthRange = {
  start: string | null;
  end: string | null;
};

export type TrendLevel = "month" | "quarter" | "year";

export type FilterOptions = {
  agents: string[];
  agencies: string[];
  paidProducers: string[];
  statementNumbers: string[];
};

export type Summary = {
  policyCount: number;
  activePolicyCount: number;
  renewalPolicyCount: number;
  totalPremium: number;
  totalCommission: number;
  agentCommission: number;
  epsCommission: number;
};

export type MonthlySummary = Summary & {
  monthKey: string;
  periodKey: string;
  policyChange: number | null;
  policyChangePercent: number | null;
  premiumChange: number | null;
  premiumChangePercent: number | null;
  commissionChange: number | null;
  commissionChangePercent: number | null;
  epsCommissionChange: number | null;
  epsCommissionChangePercent: number | null;
};

export type UnpaidMonthRow = Summary & {
  monthKey: string;
  isTotal: boolean;
  // "total" = dòng tổng tháng; "agent" = dòng con theo agent.
  level: "total" | "agent";
  agent: string;
};

export type UnpaidAgentRow = {
  agent: string;
  isTotal: boolean;
  policyCount: number;
  totalPremium: number;
  estAgentCommission: number;
};

export type AgencyMonthRow = Summary & {
  agency: string;
  isTotal: boolean;
  monthKey: string;
  // "agency" = dòng tổng của agency; "producer" = dòng con theo Paid Producer Date.
  level: "agency" | "producer";
  paidProducerDate: string;
  // Các statement number thuộc nhóm paid producer date này (hiển thị nhỏ trong ô).
  statementNumbers: string;
};

export type AgentPaidDateRow = {
  agency: string;
  paidProducerDate: string;
  statementNumbers: string;
  isTotal: boolean;
  policies: Record<string, number>;
  premium: Record<string, number>;
  commission: Record<string, number>;
};

export type AgentPaidDateGroup = {
  monthKey: string;
  rows: AgentPaidDateRow[];
  monthlyTotal: AgentPaidDateRow;
};

export type CarrierRow = Summary & {
  company: string;
  policySharePercent: number;
  averageCommissionRate: number;
};

export type AgentPerformanceRow = Summary & {
  agent: string;
  averageAgentCommissionPerMonth: number;
  averageCommissionRate: number;
  policySharePercent: number;
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

export type ExpiredMonthRow = {
  monthKey: string;
  policyCount: number;
  totalPremium: number;
};

export type PolicyDetailRow = {
  agent: string;
  agency: string;
  insuredName: string;
  policyNumber: string;
  state: string;
  city: string;
  company: string;
  truePremium: number;
  agentCommission: number;
  effectiveDate: string | null;
  expiredDate: string | null;
  status: string;
  paid: string;
};

export type DashboardData = {
  overview: Summary;
  monthlyRows: MonthlySummary[];
  trendRows: MonthlySummary[];
  unpaidTrendRows: CommissionTrendRow[];
  agencyMonthRows: AgencyMonthRow[];
  agentNames: string[];
  agentPaidDateGroups: AgentPaidDateGroup[];
  unpaidMonthRows: UnpaidMonthRow[];
  unpaidAgentRows: UnpaidAgentRow[];
  carrierRows: CarrierRow[];
  stateGroups: StateGroup[];
  statePolicyCounts: Record<string, number>;
  expiredRows: ExpiredMonthRow[];
  policyDetailRows: PolicyDetailRow[];
};

export type SortDirection = "asc" | "desc";
export type PolicySortKey =
  | "agent"
  | "agency"
  | "insuredName"
  | "policyNumber"
  | "state"
  | "city"
  | "company"
  | "truePremium"
  | "agentCommission"
  | "effectiveDate"
  | "expiredDate"
  | "status"
  | "paid";
export type PolicySortState = { key: PolicySortKey; direction: SortDirection };
export type PolicyFilterOption = { label: string; value: string };
export type DateRange = { from: string; to: string };

export const UNPAID_PRODUCER_LABEL = "Unpaid";
export const TREND_MONTH_LIMIT = 17;
