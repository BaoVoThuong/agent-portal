// Tính metric từ các dòng pc_mart đã lấy về. Hàm thuần, test được.
//
// Mọi định nghĩa khớp 1:1 với dashboard P&C (summarizeRows / estimateCommission
// trong AgentPcDashboard.tsx) để con số trả lời = con số dashboard:
//   premium      = max(true_premium ?? premium, 0)
//   policy "đếm" = unique theo policy_number, chỉ tính khi có premium > 0
//   active       = premium>0 và expired_date >= hôm nay
//   renewal      = status (trim, upper) === "RENEWAL"
//   unpaid       = paid_producer rỗng/null
//   estimate     = rate * premium * agencyFactor ; agentRate (FIONA=0.6 else 0.75)

import type {
  PcMetric,
  PcStructuredQuery,
  PcPaidFilter,
  PcPolicyScope,
} from "./pc-query-schema";

export type PcMartRow = {
  agent_name: string | null;
  agency_name: string | null;
  insured_name: string | null;
  type: string | null;
  company: string | null;
  policy_number: string | null;
  premium: number | null;
  true_premium: number | null;
  carrier_commission: number | null;
  agent_commission_amount: number | null;
  total_commission: number | null;
  eps_commission_amount: number | null;
  effective_date: string | null;
  expired_date: string | null;
  status: string | null;
  paid_producer: string | null;
  state: string | null;
  city: string | null;
};

export type AggregateGroup = { key: string; value: number };

export type PcAggregateResult = {
  metric: PcMetric;
  total: number;
  rowCount: number; // số DÒNG sau filter (một policy có thể nhiều dòng) — KHÔNG dùng làm "số policy"
  policyCount: number; // số POLICY UNIQUE (giống dashboard) — đây mới là "số policy"
  groups: AggregateGroup[];
  sample: PcMartRow[];
};

const SAMPLE_LIMIT = 20;

// ---- helpers khớp dashboard ----
function money(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}
function premiumOf(row: PcMartRow): number {
  return Math.max(money(row.true_premium ?? row.premium), 0);
}
function cleanLabel(value: string | null): string {
  return value?.trim() || "null";
}
function isPositive(row: PcMartRow): boolean {
  return premiumOf(row) > 0;
}
function isActive(row: PcMartRow, today: Date): boolean {
  if (!isPositive(row)) return false;
  if (!row.expired_date) return false;
  const d = new Date(`${row.expired_date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d >= today;
}
function isRenewal(row: PcMartRow): boolean {
  return cleanLabel(row.status).toUpperCase() === "RENEWAL";
}
function isUnpaid(row: PcMartRow): boolean {
  return cleanLabel(row.paid_producer) === "null";
}

// Ước tính commission cho 1 policy — copy đúng estimateCommission() của dashboard.
function avgCarrierRateByCompany(rows: PcMartRow[]): Map<string, number> {
  const totals = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const rate = row.carrier_commission;
    if (rate === null || !Number.isFinite(rate)) continue;
    const company = cleanLabel(row.company);
    const cur = totals.get(company) ?? { sum: 0, count: 0 };
    cur.sum += rate;
    cur.count += 1;
    totals.set(company, cur);
  }
  const avg = new Map<string, number>();
  for (const [company, { sum, count }] of totals) {
    if (count > 0) avg.set(company, sum / count);
  }
  return avg;
}
function estimateAgentCommission(
  row: PcMartRow,
  avgByCompany: Map<string, number>
): number {
  const premium = premiumOf(row);
  const rate =
    row.carrier_commission !== null && Number.isFinite(row.carrier_commission)
      ? row.carrier_commission
      : avgByCompany.get(cleanLabel(row.company)) ?? 0;
  const agency = cleanLabel(row.agency_name);
  const agencyFactor = agency === "DP" ? 0.75 : agency === "TWFG" ? 0.8 : 0;
  const total = rate * premium * agencyFactor;
  const agentRate = cleanLabel(row.agent_name).toUpperCase() === "FIONA" ? 0.6 : 0.75;
  return agentRate * total;
}

// ---- áp filter nghiệp vụ (scope/paid) trước khi tính ----
function applyBusinessFilters(
  rows: PcMartRow[],
  scope: PcPolicyScope | undefined,
  paid: PcPaidFilter | undefined,
  today: Date
): PcMartRow[] {
  let out = rows.filter(isPositive); // dashboard chỉ tính policy có premium>0
  if (scope === "active") out = out.filter((r) => isActive(r, today));
  else if (scope === "renewal") out = out.filter(isRenewal);
  if (paid === "unpaid") out = out.filter(isUnpaid);
  else if (paid === "paid") out = out.filter((r) => !isUnpaid(r));
  return out;
}

// Đếm policy unique theo policy_number (giống dashboard).
function uniquePolicyCount(rows: PcMartRow[]): number {
  const seen = new Set<string>();
  rows.forEach((row, i) => seen.add(cleanLabel(row.policy_number) || `row-${i}`));
  return seen.size;
}

function groupKey(row: PcMartRow, groupBy: NonNullable<PcStructuredQuery["groupBy"]>): string {
  switch (groupBy) {
    case "company":
      return cleanLabel(row.company);
    case "type":
      return cleanLabel(row.type);
    case "agency":
      return cleanLabel(row.agency_name);
    case "agent_name":
      return cleanLabel(row.agent_name);
    case "state":
      return cleanLabel(row.state);
    case "city":
      return cleanLabel(row.city);
    case "month":
      return row.effective_date?.slice(0, 7) || "null";
  }
}

// Tính giá trị metric trên một tập rows (đã filter nghiệp vụ).
function metricValue(
  rows: PcMartRow[],
  metric: PcMetric,
  avgByCompany: Map<string, number>,
  today: Date
): number {
  switch (metric) {
    case "count":
      return uniquePolicyCount(rows);
    case "active_count":
      return uniquePolicyCount(rows.filter((r) => isActive(r, today)));
    case "renewal_count":
      return uniquePolicyCount(rows.filter(isRenewal));
    case "renewal_rate": {
      const total = uniquePolicyCount(rows);
      return total === 0 ? 0 : (uniquePolicyCount(rows.filter(isRenewal)) / total) * 100;
    }
    case "sum_premium":
      return rows.reduce((s, r) => s + premiumOf(r), 0);
    case "sum_agent_commission":
      return rows.reduce((s, r) => s + money(r.agent_commission_amount), 0);
    case "sum_total_commission":
      return rows.reduce((s, r) => s + money(r.total_commission), 0);
    case "sum_eps_commission":
      return rows.reduce((s, r) => s + money(r.eps_commission_amount), 0);
    case "agent_commission_rate": {
      const prem = rows.reduce((s, r) => s + premiumOf(r), 0);
      return prem === 0
        ? 0
        : (rows.reduce((s, r) => s + money(r.agent_commission_amount), 0) / prem) * 100;
    }
    case "total_commission_rate": {
      const prem = rows.reduce((s, r) => s + premiumOf(r), 0);
      return prem === 0
        ? 0
        : (rows.reduce((s, r) => s + money(r.total_commission), 0) / prem) * 100;
    }
    case "eps_commission_rate": {
      const prem = rows.reduce((s, r) => s + premiumOf(r), 0);
      return prem === 0
        ? 0
        : (rows.reduce((s, r) => s + money(r.eps_commission_amount), 0) / prem) * 100;
    }
    case "estimate_unpaid_agent_commission":
      // rows đã được lọc về unpaid ở aggregatePcRows (xem chú thích bên dưới),
      // nên total/policyCount/groups đều nhất quán trên cùng tập unpaid.
      return rows.reduce((s, r) => s + estimateAgentCommission(r, avgByCompany), 0);
    case "avg_premium_per_policy": {
      const c = uniquePolicyCount(rows);
      return c === 0 ? 0 : rows.reduce((s, r) => s + premiumOf(r), 0) / c;
    }
    case "avg_agent_commission_per_policy": {
      const c = uniquePolicyCount(rows);
      return c === 0
        ? 0
        : rows.reduce((s, r) => s + money(r.agent_commission_amount), 0) / c;
    }
    case "list":
      return rows.length;
  }
}

export function aggregatePcRows(
  rawRows: PcMartRow[],
  query: PcStructuredQuery,
  today: Date = new Date()
): PcAggregateResult {
  const { metric, groupBy, filters } = query;

  // avg carrier rate tính trên TOÀN bộ rows (trước filter) — giống dashboard.
  const avgByCompany = avgCarrierRateByCompany(rawRows);

  // Metric "estimate unpaid" theo định nghĩa CHỈ tính trên policy chưa thanh toán.
  // Ép unpaid vào business filter để rows/policyCount/groups đều nhất quán (tránh
  // bug đếm cả paid lẫn unpaid như "685 policies").
  const paidFilter =
    metric === "estimate_unpaid_agent_commission" ? "unpaid" : filters.paid;

  const rows = applyBusinessFilters(rawRows, filters.policyScope, paidFilter, today);

  const total = metricValue(rows, metric, avgByCompany, today);

  const groups: AggregateGroup[] = [];
  if (groupBy) {
    const buckets = new Map<string, PcMartRow[]>();
    for (const row of rows) {
      const key = groupKey(row, groupBy);
      const arr = buckets.get(key) ?? [];
      arr.push(row);
      buckets.set(key, arr);
    }
    for (const [key, groupRows] of buckets) {
      groups.push({ key, value: metricValue(groupRows, metric, avgByCompany, today) });
    }
    groups.sort((a, b) => b.value - a.value);
  }

  return {
    metric,
    total,
    rowCount: rows.length,
    policyCount: uniquePolicyCount(rows),
    groups,
    sample: metric === "list" ? rows.slice(0, SAMPLE_LIMIT) : [],
  };
}
