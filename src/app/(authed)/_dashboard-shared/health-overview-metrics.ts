// Số liệu cho các thẻ có line ở phần overview của dashboard Health.
import {
  buildMetrics,
  type MetricDefinition,
  type PcOverviewMetric,
} from "./pc-overview-metrics";

// Report Month không có tháng tương lai nên không cắt như P&C.
const NO_MONTH_CUTOFF = "9999-12";

export type HealthCompanySummary = {
  totalMesserPaid: number;
  agentReceived: number;
  epsCommission: number;
  epsSplit: number;
  epsOverride: number;
  policyCount: number;
  clientCount: number;
  paidPolicyCount: number;
  unpaidPolicyCount: number;
  activeAgentCount: number;
};

export type HealthCompanyPeriod = HealthCompanySummary & {
  periodKey: string;
  periodLabel: string;
};

export type HealthCompanyMetricKey =
  | "agentCommission"
  | "epsCommission"
  | "epsSplit"
  | "epsOverride"
  | "agentCommRate"
  | "epsCommRate"
  | "epsSplitRate"
  | "epsOverrideRate"
  | "policies"
  | "clients"
  | "paidPolicies"
  | "unpaidPolicies"
  | "activeAgents";

export type HealthAgentPeriod = {
  periodKey: string;
  periodLabel: string;
  policyCount: number;
  clientCount: number;
  agentReceived: number;
  paidPolicyCount: number;
  unpaidPolicyCount: number;
  paidClientCount: number;
  unpaidClientCount: number;
  policyPaidRate: number;
  clientPaidRate: number;
};

export type HealthAgentMetricKey =
  | "policies"
  | "clients"
  | "monthlyCommission"
  | "yearCommission"
  | "paidPolicyRate"
  | "paidClientRate"
  | "avgCommPolicy"
  | "avgCommMonth"
  | "paidPolicies"
  | "unpaidPolicies"
  | "paidClients"
  | "unpaidClients";

export type HealthReportYearCommission = {
  value: number;
  averageMonthlyCommission: number;
  reportYear: number | null;
};

const COMPANY_METRICS: MetricDefinition<HealthCompanySummary, HealthCompanyMetricKey>[] = [
  { key: "agentCommission", label: "Agent Commission", kind: "money", read: (s) => s.agentReceived },
  { key: "epsCommission", label: "EPS Commission", kind: "money", read: (s) => s.epsCommission },
  { key: "epsSplit", label: "EPS Split", kind: "money", read: (s) => s.epsSplit },
  { key: "epsOverride", label: "EPS Override", kind: "money", read: (s) => s.epsOverride },
  { key: "agentCommRate", label: "Agent Comm Rate", kind: "pct", read: (s) => rateOfPaid(s, s.agentReceived) },
  { key: "epsCommRate", label: "EPS Comm Rate", kind: "pct", read: (s) => rateOfPaid(s, s.epsCommission) },
  { key: "epsSplitRate", label: "EPS Split Rate", kind: "pct", read: (s) => rateOfPaid(s, s.epsSplit) },
  { key: "epsOverrideRate", label: "EPS Override Rate", kind: "pct", read: (s) => rateOfPaid(s, s.epsOverride) },
  { key: "policies", label: "Policies", kind: "int", read: (s) => s.policyCount },
  { key: "clients", label: "Clients", kind: "int", read: (s) => s.clientCount },
  { key: "paidPolicies", label: "Paid Policies", kind: "int", read: (s) => s.paidPolicyCount },
  { key: "unpaidPolicies", label: "Unpaid Policies", kind: "int", read: (s) => s.unpaidPolicyCount },
  { key: "activeAgents", label: "Active Agents", kind: "int", read: (s) => s.activeAgentCount },
];

const AGENT_MONTH_METRICS: MetricDefinition<HealthAgentPeriod, HealthAgentMetricKey>[] = [
  { key: "policies", label: "Active Policies", kind: "int", read: (s) => s.policyCount },
  { key: "clients", label: "Active Clients", kind: "int", read: (s) => s.clientCount },
  { key: "monthlyCommission", label: "Monthly Commission", kind: "money", read: (s) => s.agentReceived },
  { key: "paidPolicyRate", label: "Paid Policy Rate", kind: "pct", read: (s) => s.policyPaidRate },
  { key: "paidClientRate", label: "Paid Client Rate", kind: "pct", read: (s) => s.clientPaidRate },
  { key: "avgCommPolicy", label: "Avg Comm / Policy", kind: "money", read: (s) => share(s.agentReceived, s.policyCount) },
  { key: "paidPolicies", label: "Paid Policies", kind: "int", read: (s) => s.paidPolicyCount },
  { key: "unpaidPolicies", label: "Unpaid Policies", kind: "int", read: (s) => s.unpaidPolicyCount },
  { key: "paidClients", label: "Paid Clients", kind: "int", read: (s) => s.paidClientCount },
  { key: "unpaidClients", label: "Unpaid Clients", kind: "int", read: (s) => s.unpaidClientCount },
];

const EMPTY_AGENT_PERIOD: HealthAgentPeriod = {
  periodKey: "",
  periodLabel: "",
  policyCount: 0,
  clientCount: 0,
  agentReceived: 0,
  paidPolicyCount: 0,
  unpaidPolicyCount: 0,
  paidClientCount: 0,
  unpaidClientCount: 0,
  policyPaidRate: 0,
  clientPaidRate: 0,
};

// Công ty: số lớn là tổng theo bộ lọc, giống P&C.
export function buildHealthCompanyMetrics(
  overview: HealthCompanySummary,
  periods: HealthCompanyPeriod[]
) {
  return buildMetrics(COMPANY_METRICS, overview, periods, NO_MONTH_CUTOFF);
}

// Agent: policy và client đang active là số của tháng mới nhất, không cộng dồn các tháng.
export function buildHealthAgentMetrics(
  periods: HealthAgentPeriod[],
  year: HealthReportYearCommission
): PcOverviewMetric<HealthAgentMetricKey>[] {
  const latest = periods.at(-1) ?? EMPTY_AGENT_PERIOD;
  const yearPeriods = periods.filter((period) =>
    period.periodKey.startsWith(`${year.reportYear}-`)
  );
  const buildYearMetric = (
    key: HealthAgentMetricKey,
    label: string,
    agentReceived: number
  ) =>
    buildMetrics(
      [{ key, label, kind: "money" as const, read: (s: HealthAgentPeriod) => s.agentReceived }],
      { ...latest, agentReceived },
      yearPeriods,
      NO_MONTH_CUTOFF
    );

  return [
    ...buildMetrics(AGENT_MONTH_METRICS, latest, periods, NO_MONTH_CUTOFF),
    ...buildYearMetric(
      "yearCommission",
      `${year.reportYear ?? "Report Year"} Commission`,
      year.value
    ),
    // Số trung bình không có "tháng trước" để so.
    ...buildYearMetric("avgCommMonth", "Avg Comm / Month", year.averageMonthlyCommission).map(
      (metric) => ({ ...metric, previous: null })
    ),
  ];
}

function rateOfPaid(summary: HealthCompanySummary, value: number) {
  return share(value, summary.totalMesserPaid) * 100;
}

function share(value: number, total: number) {
  return total === 0 ? 0 : value / total;
}
