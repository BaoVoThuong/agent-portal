// Phép tính cho score card và Line of Service của 2 dashboard P&C.
// Một policy chỉ được tính khi có premium dương, giống summarizeRows của dashboard,
// để New Business / Renewals khớp với Policies Sold và Renewal Rate trên cùng trang.

export type PcLineSourceRow = {
  type: string | null;
  company: string | null;
  policy_number: string | null;
  premium: number | null;
  true_premium: number | null;
  effective_date: string | null;
  status: string | null;
  agent_commission_amount: number | null;
  total_commission?: number | null;
  eps_commission_amount?: number | null;
};

export type PcChangeMetric = {
  total: number;
  latest: number;
  // null khi tháng liền trước không có trong dữ liệu đang lọc: không có gì để so.
  change: number | null;
};

export type PcPlainMetric = {
  total: number;
  latest: number;
};

export type PcScoreCardData = {
  latestMonthKey: string | null;
  newBusiness: PcChangeMetric;
  renewals: PcChangeMetric;
  cancellations: PcChangeMetric;
  carriers: PcPlainMetric;
  lines: PcPlainMetric;
};

export type PcLineRow = {
  label: string;
  policyCount: number;
  totalPremium: number;
  premiumSharePercent: number;
  policySharePercent: number;
  premiumPerPolicy: number;
  totalCommission: number;
  agentCommission: number;
  epsCommission: number;
};

export const UNSPECIFIED_LINE_LABEL = "Unspecified";

export function getPcLineLabel(type: string | null) {
  const key = type?.trim().toUpperCase() ?? "";

  if (!key) return UNSPECIFIED_LINE_LABEL;

  return toTitleCase(key);
}

// maxMonthKey: tháng mới nhất và số so sánh không vượt quá tháng này.
export function buildPcScoreCards(
  rows: PcLineSourceRow[],
  maxMonthKey?: string
): PcScoreCardData {
  const rowsByMonth = groupBy(
    rows.filter((row) => getMonthKey(row.effective_date)),
    (row) => getMonthKey(row.effective_date)
  );
  const latestMonthKey =
    [...rowsByMonth.keys()]
      .filter((monthKey) => !maxMonthKey || monthKey <= maxMonthKey)
      .sort()
      .at(-1) ?? null;
  const overall = summarizeScores(rows);
  const latest = summarizeScores(
    latestMonthKey ? rowsByMonth.get(latestMonthKey) ?? [] : []
  );
  const previousRows = latestMonthKey
    ? rowsByMonth.get(getPreviousMonthKey(latestMonthKey))
    : undefined;
  const previous = previousRows ? summarizeScores(previousRows) : null;

  function changeMetric(key: "cancellations" | "newBusiness" | "renewals") {
    return {
      total: overall[key],
      latest: latest[key],
      change: previous ? latest[key] - previous[key] : null,
    };
  }

  return {
    latestMonthKey,
    newBusiness: changeMetric("newBusiness"),
    renewals: changeMetric("renewals"),
    cancellations: changeMetric("cancellations"),
    carriers: { total: overall.carrierCount, latest: latest.carrierCount },
    lines: { total: overall.lineCount, latest: latest.lineCount },
  };
}

export function buildPcLineRows(rows: PcLineSourceRow[]): PcLineRow[] {
  const totals = summarizeLine(rows);

  return [...groupBy(rows, (row) => getPcLineLabel(row.type)).entries()]
    .map(([label, group]) => toLineRow(label, summarizeLine(group), totals))
    .sort(compareLineRows);
}

function groupBy(
  rows: PcLineSourceRow[],
  getKey: (row: PcLineSourceRow) => string
) {
  const groups = new Map<string, PcLineSourceRow[]>();

  for (const row of rows) {
    const key = getKey(row);
    const group = groups.get(key);

    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  return groups;
}

function summarizeScores(rows: PcLineSourceRow[]) {
  const policies = new Map<
    string,
    { cancelled: boolean; isNew: boolean; positive: boolean; renewal: boolean }
  >();
  const carriers = new Set<string>();
  const lines = new Set<string>();

  rows.forEach((row, index) => {
    const policyId = getPolicyId(row, index);
    const current = policies.get(policyId) ?? {
      cancelled: false,
      isNew: false,
      positive: false,
      renewal: false,
    };
    const status = row.status?.trim() ?? "";
    const rowPremium = getRowPremium(row);

    current.cancelled = current.cancelled || status === "CANCEL";
    current.isNew = current.isNew || status === "NEW";
    current.renewal = current.renewal || status === "RENEWAL";
    current.positive = current.positive || rowPremium > 0;
    policies.set(policyId, current);

    if (rowPremium <= 0) return;

    const carrier = row.company?.trim();
    if (carrier) carriers.add(carrier);

    const line = getPcLineLabel(row.type);
    if (line !== UNSPECIFIED_LINE_LABEL) lines.add(line);
  });

  const values = [...policies.values()];
  const sold = values.filter((policy) => policy.positive);

  return {
    // Hợp đồng huỷ thường chỉ còn dòng premium âm nên không lọc theo premium dương.
    cancellations: values.filter((policy) => policy.cancelled).length,
    carrierCount: carriers.size,
    lineCount: lines.size,
    newBusiness: sold.filter((policy) => policy.isNew).length,
    renewals: sold.filter((policy) => policy.renewal).length,
  };
}

function summarizeLine(rows: PcLineSourceRow[]) {
  const positivePolicies = new Set<string>();
  let totalPremium = 0;
  let totalCommission = 0;
  let agentCommission = 0;
  let epsCommission = 0;

  rows.forEach((row, index) => {
    const rowPremium = getRowPremium(row);

    if (rowPremium > 0) {
      positivePolicies.add(getPolicyId(row, index));
      totalPremium += rowPremium;
    }

    totalCommission += moneyValue(row.total_commission);
    agentCommission += moneyValue(row.agent_commission_amount);
    epsCommission += moneyValue(row.eps_commission_amount);
  });

  return {
    agentCommission,
    epsCommission,
    policyCount: positivePolicies.size,
    totalCommission,
    totalPremium,
  };
}

type LineTotals = ReturnType<typeof summarizeLine>;

function toLineRow(
  label: string,
  line: LineTotals,
  totals: LineTotals
): PcLineRow {
  return {
    ...line,
    label,
    policySharePercent: percentOf(line.policyCount, totals.policyCount),
    premiumPerPolicy: divide(line.totalPremium, line.policyCount),
    premiumSharePercent: percentOf(line.totalPremium, totals.totalPremium),
  };
}

function compareLineRows(a: PcLineRow, b: PcLineRow) {
  const aUnspecified = a.label === UNSPECIFIED_LINE_LABEL;
  const bUnspecified = b.label === UNSPECIFIED_LINE_LABEL;

  if (aUnspecified !== bUnspecified) return aUnspecified ? 1 : -1;

  return (
    b.totalPremium - a.totalPremium ||
    b.policyCount - a.policyCount ||
    a.label.localeCompare(b.label)
  );
}

export function percentOf(value: number, total: number) {
  return total === 0 ? 0 : (value / total) * 100;
}

function divide(value: number, total: number) {
  return total === 0 ? 0 : value / total;
}

function getPolicyId(row: PcLineSourceRow, index: number) {
  return row.policy_number?.trim() || `__row_${index}`;
}

function getRowPremium(row: PcLineSourceRow) {
  return moneyValue(row.true_premium ?? row.premium);
}

function moneyValue(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getMonthKey(date: string | null) {
  const monthKey = date?.slice(0, 7) ?? "";

  return /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : "";
}

export function getPreviousMonthKey(monthKey: string) {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));

  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
