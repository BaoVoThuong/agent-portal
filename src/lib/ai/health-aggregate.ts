// Tính metric Health từ rows health_mart. Hàm thuần, test được.
//
// Khớp 1:1 HealthSalesDashboard: buildEligiblePolicyRows (dedup theo report_month +
// primary_member_id, chọn effective mới nhất) -> đếm policy unique, client = sum(
// max(num_client) theo policy), paid theo paid_to_date, commission agent/eps,
// rate trên carriers_messer_paid.

import type {
  HealthMetric,
  HealthStructuredQuery,
  HealthPaidFilter,
} from "./health-query-schema";

export type HealthMartRow = {
  deal_name: string | null;
  state: string | null;
  carrier: string | null;
  plan_name: string | null;
  primary_member_id: string | null;
  agent: string | null;
  broker_effective_date: string | null;
  paid_to_date: string | null;
  report_month: string | null;
  carriers_messer_paid: number | null;
  agent_received: number | null;
  eps_override_received: number | null;
  eps_split: number | null;
  num_client: number | null;
};

export type AggregateGroup = { key: string; value: number };

export type HealthAggregateResult = {
  metric: HealthMetric;
  total: number;
  rowCount: number; // số dòng eligible (KHÔNG phải số policy)
  policyCount: number; // số POLICY unique
  clientCount: number; // tổng client
  groups: AggregateGroup[];
  sample: HealthMartRow[];
};

const SAMPLE_LIMIT = 20;

// ---- helpers khớp dashboard ----
function money(value: number | null | undefined): number {
  return Number.isFinite(value ?? NaN) ? Number(value) : 0;
}
function cleanText(value: string | null): string {
  return value?.trim() || "";
}
function cleanLabel(value: string | null): string {
  return cleanText(value) || "null";
}
function monthKey(value: string | null): string {
  const t = value?.trim();
  if (!t) return "";
  const m = t.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  const slashDate = t.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/);
  if (slashDate) return `${slashDate[2]}-${slashDate[1].padStart(2, "0")}`;
  const slashMonth = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (slashMonth) return `${slashMonth[2]}-${slashMonth[1].padStart(2, "0")}`;
  return "";
}
function isPaid(row: HealthMartRow): boolean {
  return Boolean(cleanText(row.paid_to_date));
}
function epsCommissionOf(row: HealthMartRow): number {
  return money(row.carriers_messer_paid) - money(row.agent_received);
}

// Copy buildEligiblePolicyRows: 1 dòng / (report_month, member), effective <= report,
// chọn effective mới nhất (tie-break carriers_messer_paid lớn hơn).
function buildEligibleRows(rows: HealthMartRow[]): HealthMartRow[] {
  const selected = new Map<string, HealthMartRow>();
  for (const row of rows) {
    const report = monthKey(row.report_month);
    const effective = monthKey(row.broker_effective_date);
    const memberId = cleanText(row.primary_member_id).toUpperCase();
    if (!report || !effective || !memberId) continue;
    if (effective.localeCompare(report) > 0) continue;

    const key = `${report}${memberId}`;
    const current = selected.get(key);
    if (!current || compareEffective(row, current) > 0) {
      selected.set(key, row);
    }
  }
  return [...selected.values()];
}
function compareEffective(a: HealthMartRow, b: HealthMartRow): number {
  const ae = cleanText(a.broker_effective_date);
  const be = cleanText(b.broker_effective_date);
  if (ae !== be) return ae.localeCompare(be);
  return money(a.carriers_messer_paid) - money(b.carriers_messer_paid);
}

// Gom theo POLICY = primary_member_id UNIQUE (xuyên mọi tháng trong phạm vi hỏi).
// Khớp dashboard buildChartPeriods/summarizeRows: một member chỉ tính 1 LẦN dù
// xuất hiện ở nhiều report_month; client của member = MAX(num_client) qua các tháng;
// clientCount = sum các max đó. (Xác minh trên data thật 2026: 859 policy / 1570
// client, khớp dashboard.) KHONG đếm theo từng tháng rồi cộng dồn.
function policyBuckets(rows: HealthMartRow[]) {
  const policies = new Map<string, { paid: boolean; clients: number }>();
  rows.forEach((row, index) => {
    const id = cleanText(row.primary_member_id) || `__row_${index}`;
    const cur = policies.get(id) ?? { paid: false, clients: 0 };
    cur.paid = cur.paid || isPaid(row);
    cur.clients = Math.max(cur.clients, row.num_client ?? 0);
    policies.set(id, cur);
  });
  return policies;
}

function applyPaidFilter(
  rows: HealthMartRow[],
  paid: HealthPaidFilter | undefined
): HealthMartRow[] {
  if (paid === "paid") return rows.filter(isPaid);
  if (paid === "unpaid") return rows.filter((r) => !isPaid(r));
  return rows;
}

function groupKey(
  row: HealthMartRow,
  groupBy: NonNullable<HealthStructuredQuery["groupBy"]>
): string {
  switch (groupBy) {
    case "carrier":
      return cleanLabel(row.carrier);
    case "state":
      return cleanLabel(row.state);
    case "agent":
      return cleanLabel(row.agent);
    case "plan":
      return cleanLabel(row.plan_name);
    case "month":
      return monthKey(row.report_month) || "null";
  }
}

function countPolicies(rows: HealthMartRow[]): number {
  return policyBuckets(rows).size;
}
function countPaidPolicies(rows: HealthMartRow[]): number {
  return [...policyBuckets(rows).values()].filter((p) => p.paid).length;
}
function countClients(rows: HealthMartRow[]): number {
  return [...policyBuckets(rows).values()].reduce((s, p) => s + p.clients, 0);
}
// Lọc về report month MỚI NHẤT có data (cho scorecard "Active ..."): dashboard lấy
// tháng report gần nhất, không phải tháng lịch hiện tại (tháng này có thể rỗng).
function latestMonthRows(rows: HealthMartRow[]): HealthMartRow[] {
  let latest = "";
  for (const r of rows) {
    const m = monthKey(r.report_month);
    if (m > latest) latest = m;
  }
  return latest ? rows.filter((r) => monthKey(r.report_month) === latest) : [];
}

function metricValue(rows: HealthMartRow[], metric: HealthMetric): number {
  switch (metric) {
    case "policy_count":
      return countPolicies(rows);
    case "client_count":
      return countClients(rows);
    case "active_policy_count":
      return countPolicies(latestMonthRows(rows));
    case "active_client_count":
      return countClients(latestMonthRows(rows));
    case "paid_policy_count":
      return countPaidPolicies(rows);
    case "unpaid_policy_count":
      return Math.max(countPolicies(rows) - countPaidPolicies(rows), 0);
    case "policy_paid_rate": {
      const total = countPolicies(rows);
      return total === 0 ? 0 : (countPaidPolicies(rows) / total) * 100;
    }
    case "sum_agent_commission":
      return rows.reduce((s, r) => s + money(r.agent_received), 0);
    case "sum_eps_commission":
      return rows.reduce((s, r) => s + epsCommissionOf(r), 0);
    case "sum_eps_override":
      return rows.reduce((s, r) => s + money(r.eps_override_received), 0);
    case "sum_eps_split":
      return rows.reduce((s, r) => s + money(r.eps_split), 0);
    case "sum_carrier_paid":
      return rows.reduce((s, r) => s + money(r.carriers_messer_paid), 0);
    case "agent_commission_rate": {
      const base = rows.reduce((s, r) => s + money(r.carriers_messer_paid), 0);
      return base === 0
        ? 0
        : (rows.reduce((s, r) => s + money(r.agent_received), 0) / base) * 100;
    }
    case "eps_commission_rate": {
      const base = rows.reduce((s, r) => s + money(r.carriers_messer_paid), 0);
      return base === 0
        ? 0
        : (rows.reduce((s, r) => s + epsCommissionOf(r), 0) / base) * 100;
    }
    case "eps_split_rate": {
      const base = rows.reduce((s, r) => s + money(r.carriers_messer_paid), 0);
      return base === 0
        ? 0
        : (rows.reduce((s, r) => s + money(r.eps_split), 0) / base) * 100;
    }
    case "eps_override_rate": {
      const base = rows.reduce((s, r) => s + money(r.carriers_messer_paid), 0);
      return base === 0
        ? 0
        : (rows.reduce((s, r) => s + money(r.eps_override_received), 0) / base) * 100;
    }
    case "list":
      return rows.length;
  }
}

export function aggregateHealthRows(
  rawRows: HealthMartRow[],
  query: HealthStructuredQuery
): HealthAggregateResult {
  const { metric, groupBy, filters } = query;

  const eligible = buildEligibleRows(rawRows);
  // Các metric paid-status TỰ encode trạng thái paid theo từng member (bool_or).
  // Nếu áp thêm filter paid (lọc dòng) sẽ phá logic -> đếm sai. Bỏ qua filter paid
  // cho nhóm metric này (khớp dashboard: unpaid = member không tháng nào được trả).
  const PAID_STATUS_METRICS = new Set<HealthMetric>([
    "paid_policy_count",
    "unpaid_policy_count",
    "policy_paid_rate",
  ]);
  const effectivePaid = PAID_STATUS_METRICS.has(metric) ? undefined : filters.paid;
  const rows = applyPaidFilter(eligible, effectivePaid);

  const total = metricValue(rows, metric);

  const groups: AggregateGroup[] = [];
  if (groupBy) {
    const buckets = new Map<string, HealthMartRow[]>();
    for (const row of rows) {
      const key = groupKey(row, groupBy);
      const arr = buckets.get(key) ?? [];
      arr.push(row);
      buckets.set(key, arr);
    }
    for (const [key, groupRows] of buckets) {
      groups.push({ key, value: metricValue(groupRows, metric) });
    }
    groups.sort((a, b) => b.value - a.value);
  }

  return {
    metric,
    total,
    rowCount: rows.length,
    policyCount: countPolicies(rows),
    clientCount: countClients(rows),
    groups,
    sample: metric === "list" ? rows.slice(0, SAMPLE_LIMIT) : [],
  };
}
