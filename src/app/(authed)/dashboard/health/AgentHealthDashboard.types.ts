// Types + constants thuần của AgentHealthDashboard (tách nguyên văn từ component
// để giảm kích thước file, KHÔNG đổi định nghĩa). Chỉ dùng nội bộ dashboard này.
import type { ChartLevel } from "./AgentHealthDashboardChart";

export type HealthMartRow = {
  deal_name: string | null;
  carrier: string | null;
  state: string | null;
  primary_member_id: string | null;
  broker_effective_date: string | null;
  report_month: string | null;
  paid_to_date: string | null;
  paid_to_date_raw: string | null;
  agent_received: number | null;
  num_client: number | null;
};

export type ScoreCards = {
  activePolicy: ScoreCardMetric;
  activeClient: ScoreCardMetric;
  totalCommission: ScoreCardMetric;
  totalCommissionInReportYear: ReportYearCommissionMetric;
};

export type ScoreCardMetric = {
  value: number;
  changePercent: number | null;
};

export type ReportYearCommissionMetric = {
  value: number;
  averageMonthlyCommission: number;
  reportYear: number | null;
};

export type DashboardMonth = {
  periodKey: string;
  periodLabel: string;
  policyCount: number;
  clientCount: number;
  agentReceived: number;
};

export type ChartPeriodsByLevel = Record<ChartLevel, DashboardMonth[]>;

export type PaymentStatusMonth = {
  reportMonth: string;
  total: number;
  paid: number;
  unpaid: number;
  paidRate: number;
};

export type CarrierPaymentStatusRow = {
  carrier: string;
  total: number;
  paid: number;
  unpaid: number;
  paidRate: number;
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

export type MemberPaymentRow = {
  dealName: string;
  carrier: string;
  primaryMemberId: string;
  totalPaid: number;
  months: {
    reportMonth: string;
    hasRecord: boolean;
    paid: number;
    paidToDate: string | null;
    paidToDateRaw: string | null;
  }[];
};

export type MemberPaymentSummary = {
  rows: MemberPaymentRow[];
  reportMonths: string[];
};

export type MixBreakdownRow = {
  label: string;
  sharePercent: number;
  policyCount: number;
  clientCount: number;
  totalCommission: number;
};

export type LatestMonthMixBreakdown = {
  reportMonth: string | null;
  carrierRows: MixBreakdownRow[];
  stateRows: MixBreakdownRow[];
};

export type CarrierPaymentStatusBreakdown = {
  reportMonth: string | null;
  policyRows: CarrierPaymentStatusRow[];
  clientRows: CarrierPaymentStatusRow[];
};

export type DashboardData = {
  scoreCards: ScoreCards;
  memberPayments: MemberPaymentRow[];
  memberPaymentReportMonths: string[];
  chartPeriodsByLevel: ChartPeriodsByLevel;
  policyPaymentStatus: PaymentStatusMonth[];
  clientPaymentStatus: PaymentStatusMonth[];
  carrierPaymentStatus: CarrierPaymentStatusBreakdown;
  latestMonthMixBreakdown: LatestMonthMixBreakdown;
};

export type ReportMonthRange = {
  start: string | null;
  end: string | null;
};

export type MonthlyDashboardSummary = {
  reportMonth: string;
  policyIds: Set<string>;
  maxClientByMemberId: Map<string, number>;
  agentReceived: number;
};

export const CHART_MONTH_LIMIT = 12;
export const CHART_QUARTER_LIMIT = 8;
export const CHART_YEAR_LIMIT = 5;
export const MEMBER_PAYMENT_REPORT_YEAR = "2026";
export const MIX_BREAKDOWN_TOP_LIMIT = 5;
export const PAID_RATE_VISIBLE_ROW_COUNT = 6;
export const PAID_RATE_HEADER_HEIGHT_PX = 72;
export const PAID_RATE_ROW_HEIGHT_PX = 64;
export const PAID_RATE_TABLE_MAX_HEIGHT =
  PAID_RATE_HEADER_HEIGHT_PX + PAID_RATE_VISIBLE_ROW_COUNT * PAID_RATE_ROW_HEIGHT_PX;
