// Số liệu cho các thẻ có line ở Personal Overview của P&C.
import { getPreviousMonthKey } from "./pc-line-of-service";

export type PcOverviewSummary = {
  policyCount: number;
  activePolicyCount: number;
  renewalPolicyCount: number;
  totalPremium: number;
  agentCommission: number;
};

export type PcOverviewPeriod = PcOverviewSummary & {
  periodKey: string;
  periodLabel: string;
};

export type PcCompanyOverviewSummary = PcOverviewSummary & {
  totalCommission: number;
  epsCommission: number;
};

export type PcCompanyOverviewPeriod = PcCompanyOverviewSummary & {
  periodKey: string;
  periodLabel: string;
};

export type PcMetricKind = "money" | "int" | "pct";

export type PcOverviewMetricKey =
  | "commission"
  | "premium"
  | "policies"
  | "active"
  | "renewalRate"
  | "commRate"
  | "avgPremium"
  | "avgComm"
  | "totalCommission"
  | "epsCommission"
  | "totalCommRate"
  | "epsCommRate";

export type PcMetricPoint = {
  label: string;
  value: number;
};

export type PcOverviewMetric<Key extends string = PcOverviewMetricKey> = {
  key: Key;
  label: string;
  kind: PcMetricKind;
  total: number;
  points: PcMetricPoint[];
  latest: PcMetricPoint | null;
  peak: PcMetricPoint | null;
  // null khi tháng liền trước không có dữ liệu: không có gì để so.
  previous: PcMetricPoint | null;
};

export type MetricDefinition<Summary, Key extends string = PcOverviewMetricKey> = {
  key: Key;
  label: string;
  kind: PcMetricKind;
  read: (summary: Summary) => number;
};

const AGENT_COMMISSION: MetricDefinition<PcOverviewSummary> = {
  key: "commission",
  label: "Agent Commission",
  kind: "money",
  read: (s) => s.agentCommission,
};
const WRITTEN_PREMIUM: MetricDefinition<PcOverviewSummary> = {
  key: "premium",
  label: "Written Premium",
  kind: "money",
  read: (s) => s.totalPremium,
};
const POLICIES: MetricDefinition<PcOverviewSummary> = {
  key: "policies",
  label: "Policies",
  kind: "int",
  read: (s) => s.policyCount,
};
const ACTIVE_POLICIES: MetricDefinition<PcOverviewSummary> = {
  key: "active",
  label: "Active Policies",
  kind: "int",
  read: (s) => s.activePolicyCount,
};
const RENEWAL_RATE: MetricDefinition<PcOverviewSummary> = {
  key: "renewalRate",
  label: "Renewal Rate",
  kind: "pct",
  read: (s) => share(s.renewalPolicyCount, s.policyCount) * 100,
};

const AVG_PREMIUM: MetricDefinition<PcOverviewSummary> = {
  key: "avgPremium",
  label: "Avg Premium / Policy",
  kind: "money",
  read: (s) => share(s.totalPremium, s.policyCount),
};

const AGENT_METRICS: MetricDefinition<PcOverviewSummary>[] = [
  AGENT_COMMISSION,
  WRITTEN_PREMIUM,
  POLICIES,
  ACTIVE_POLICIES,
  RENEWAL_RATE,
  {
    key: "commRate",
    label: "Agent Comm Rate",
    kind: "pct",
    read: (s) => share(s.agentCommission, s.totalPremium) * 100,
  },
  AVG_PREMIUM,
  {
    key: "avgComm",
    label: "Avg Comm / Policy",
    kind: "money",
    read: (s) => share(s.agentCommission, s.policyCount),
  },
];

const COMPANY_METRICS: MetricDefinition<PcCompanyOverviewSummary>[] = [
  WRITTEN_PREMIUM,
  {
    key: "totalCommission",
    label: "Commission Revenue",
    kind: "money",
    read: (s) => s.totalCommission,
  },
  AGENT_COMMISSION,
  {
    key: "epsCommission",
    label: "EPS Commission",
    kind: "money",
    read: (s) => s.epsCommission,
  },
  { ...POLICIES, label: "Policies Sold" },
  { ...AVG_PREMIUM, label: "Premium per Policy" },
  ACTIVE_POLICIES,
  RENEWAL_RATE,
  {
    key: "totalCommRate",
    label: "Commission Rate",
    kind: "pct",
    read: (s) => share(s.totalCommission, s.totalPremium) * 100,
  },
  {
    key: "epsCommRate",
    label: "EPS Comm Rate",
    kind: "pct",
    read: (s) => share(s.epsCommission, s.totalPremium) * 100,
  },
];

// Hợp đồng hiệu lực tháng sau chỉ mới có vài dòng: để vào line thì tháng cuối tụt
// giả, nên line và số so sánh dừng ở tháng hiện tại. Số tổng vẫn theo bộ lọc.
export function buildPcOverviewMetrics(
  overview: PcOverviewSummary,
  periods: PcOverviewPeriod[],
  currentMonthKey: string
) {
  return buildMetrics(AGENT_METRICS, overview, periods, currentMonthKey);
}

export function buildPcCompanyOverviewMetrics(
  overview: PcCompanyOverviewSummary,
  periods: PcCompanyOverviewPeriod[],
  currentMonthKey: string
) {
  return buildMetrics(COMPANY_METRICS, overview, periods, currentMonthKey);
}

export function buildMetrics<Summary, Key extends string>(
  definitions: MetricDefinition<Summary, Key>[],
  overview: Summary,
  periods: (Summary & { periodKey: string; periodLabel: string })[],
  currentMonthKey: string
): PcOverviewMetric<Key>[] {
  const shownPeriods = periods.filter(
    (period) => period.periodKey <= currentMonthKey
  );
  const lastPeriod = shownPeriods.at(-1) ?? null;
  const priorPeriod = shownPeriods.at(-2) ?? null;
  const hasPreviousMonth =
    lastPeriod !== null &&
    priorPeriod !== null &&
    priorPeriod.periodKey === getPreviousMonthKey(lastPeriod.periodKey);

  return definitions.map(({ key, label, kind, read }) => {
    const points = shownPeriods.map((period) => ({
      label: period.periodLabel,
      value: read(period),
    }));

    return {
      key,
      label,
      kind,
      total: read(overview),
      points,
      latest: points.at(-1) ?? null,
      peak: findPeak(points),
      previous: hasPreviousMonth ? points.at(-2) ?? null : null,
    };
  });
}

export function formatPcMetric(kind: PcMetricKind, value: number) {
  if (kind === "pct") return `${value.toFixed(2)}%`;
  if (kind === "int") return Math.round(value).toLocaleString("en-US");

  const sign = value < 0 ? "-" : "";
  const absValue = Math.abs(value);

  if (absValue >= 1000000) return `${sign}$${(absValue / 1000000).toFixed(2)}M`;
  if (absValue >= 1000) return `${sign}$${(absValue / 1000).toFixed(2)}K`;

  return `${sign}$${absValue.toFixed(2)}`;
}

export function formatPcMonthKey(monthKey: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${monthKey}-01T00:00:00Z`));
}

function findPeak(points: PcMetricPoint[]) {
  return points.reduce<PcMetricPoint | null>(
    (peak, point) => (peak === null || point.value > peak.value ? point : peak),
    null
  );
}

function share(value: number, total: number) {
  return total === 0 ? 0 : value / total;
}
