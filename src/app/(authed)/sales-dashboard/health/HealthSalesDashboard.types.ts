// Types + constants thuần của HealthSalesDashboard (tách nguyên văn từ component).
import type {
  TrendComparisonChartLevel,
  TrendComparisonPeriodsByLevel,
} from "./HealthSalesTrendComparisonChart";

export type HealthSalesRow = {
  deal_name: string | null;
  state: string | null;
  carrier: string | null;
  plan_name: string | null;
  primary_member_id: string | null;
  agent: string | null;
  broker_effective_date: string | null;
  paid_to_date: string | null;
  paid_to_date_raw: string | null;
  report_month: string | null;
  carriers_messer_paid: number | null;
  agent_received: number | null;
  eps_override: number | null;
  eps_override_received: number | null;
  eps_split: number | null;
  messer_statement: string | null;
  num_client: number | null;
};

export type ReportMonthRange = {
  start: string | null;
  end: string | null;
};

export type FilterValues = {
  agent: string[];
  carrier: string[];
  reportMonthRange: ReportMonthRange;
  messerStatement: string[];
  primaryMemberId: string;
};

export type ClientFilterValues = Pick<
  FilterValues,
  "agent" | "carrier" | "primaryMemberId"
>;

export type FilterOptions = {
  agents: string[];
  carriers: string[];
};

export type Summary = {
  policyCount: number;
  paidPolicyCount: number;
  unpaidPolicyCount: number;
  clientCount: number;
  paidClientCount: number;
  unpaidClientCount: number;
  totalMesserPaid: number;
  agentReceived: number;
  epsCommission: number;
  epsOverride: number;
  epsSplit: number;
  activeAgentCount: number;
};

export type MonthlySummary = Summary & {
  monthKey: string;
};

export type SalesPeriodSummary = Summary & {
  periodKey: string;
  periodLabel: string;
};

export type SalesMomRow = SalesPeriodSummary & {
  policyChange: number | null;
  policyChangePercent: number | null;
  clientChange: number | null;
  clientChangePercent: number | null;
  messerPaidChange: number | null;
  messerPaidChangePercent: number | null;
  epsCommissionChange: number | null;
  epsCommissionChangePercent: number | null;
};

export type CombinedPaymentStatusMonth = {
  reportMonth: string;
  policyTotal: number;
  policyPaid: number;
  policyPaidRate: number;
  clientTotal: number;
  clientPaid: number;
  clientPaidRate: number;
};

export type CombinedCarrierPaymentStatusRow = {
  carrier: string;
  policyTotal: number;
  policyPaid: number;
  policyPaidRate: number;
  clientTotal: number;
  clientPaid: number;
  clientPaidRate: number;
};

export type CarrierPaidRateBreakdown = {
  reportMonth: string | null;
  rows: CombinedCarrierPaymentStatusRow[];
};

export type AgentDashboardRow = Summary & {
  agent: string;
  avgAgentCommissionPerMonth: number;
  paidPolicyPercent: number;
  revenueSharePercent: number;
};

export type AgentPeriodPivotRow = {
  periodKey: string;
  periodLabel: string;
  agentSummaries: Record<string, Summary>;
};

export type AgentPeriodPivotData = {
  agentNames: string[];
  rows: AgentPeriodPivotRow[];
};

export type CarrierDashboardRow = Summary & {
  carrier: string;
  paidPolicyPercent: number;
  revenueSharePercent: number;
  epsCommissionPercent: number;
  epsOverridePercent: number;
  epsSplitPercent: number;
};

export type StateDashboardRow = Summary & {
  state: string;
  policySharePercent: number;
  clientSharePercent: number;
  revenueSharePercent: number;
};

export type PolicyInfoRow = {
  dealName: string;
  agentName: string;
  carrier: string;
  primaryMemberId: string;
  totalPaid: number;
  months: {
    hasRecord: boolean;
    paid: number;
    paidToDate: string | null;
    paidToDateRaw: string | null;
  }[];
};

export type PolicyInfoSummary = {
  rows: PolicyInfoRow[];
  visibleMonthCount: number;
};

export type DashboardData = {
  overview: Summary;
  monthlyRows: MonthlySummary[];
  trendPeriodsByLevel: TrendComparisonPeriodsByLevel;
  commissionRowsByLevel: Record<TrendComparisonChartLevel, SalesPeriodSummary[]>;
  salesMomRowsByLevel: Record<TrendComparisonChartLevel, SalesMomRow[]>;
  carrierPaidRateBreakdown: CarrierPaidRateBreakdown;
  agentRows: AgentDashboardRow[];
  agentPivotByLevel: Record<TrendComparisonChartLevel, AgentPeriodPivotData>;
  carrierRows: CarrierDashboardRow[];
  stateRows: StateDashboardRow[];
  policyInfoRows: PolicyInfoRow[];
  policyInfoMonthCount: number;
};

export const TREND_MONTH_LIMIT = 12;
export const TREND_QUARTER_LIMIT = 8;
export const TREND_YEAR_LIMIT = 5;
export const TABLE_MONTH_LIMIT = 14;
export const CARRIER_ROW_LIMIT = 28;
export const STATE_TOP_LIMIT = 5;
export const PAID_RATE_VISIBLE_ROW_COUNT = 6;
export const PAID_RATE_HEADER_HEIGHT_PX = 72;
export const PAID_RATE_ROW_HEIGHT_PX = 64;
export const PAID_RATE_TABLE_MAX_HEIGHT =
  PAID_RATE_HEADER_HEIGHT_PX + PAID_RATE_VISIBLE_ROW_COUNT * PAID_RATE_ROW_HEIGHT_PX;
export const SALES_MOM_VISIBLE_ROW_COUNT = 6;
export const SALES_MOM_HEADER_HEIGHT_PX = 44;
export const SALES_MOM_ROW_HEIGHT_PX = 56;
export const SALES_MOM_SCROLL_MAX_HEIGHT =
  SALES_MOM_HEADER_HEIGHT_PX + SALES_MOM_VISIBLE_ROW_COUNT * SALES_MOM_ROW_HEIGHT_PX;
export const EMPTY_SUMMARY: Summary = {
  activeAgentCount: 0,
  agentReceived: 0,
  clientCount: 0,
  epsCommission: 0,
  epsOverride: 0,
  epsSplit: 0,
  paidClientCount: 0,
  paidPolicyCount: 0,
  policyCount: 0,
  totalMesserPaid: 0,
  unpaidClientCount: 0,
  unpaidPolicyCount: 0,
};
