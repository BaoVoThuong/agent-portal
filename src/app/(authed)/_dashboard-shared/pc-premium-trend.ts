import { getPcLineLabel, type PcLineSourceRow } from "./pc-line-of-service";

export type PcPremiumTrendPoint = {
  label: string;
  policies: number;
  premium: number;
  premiumByLine: Record<string, number>;
  policiesByLine: Record<string, number>;
};

export type PcPremiumTrendPeriod = {
  key: string;
  label: string;
  policies: number;
  premium: number;
};

// Thứ tự cố định để mỗi line luôn giữ một màu; line nhỏ gom vào Other.
export const PC_TREND_LINES = [
  "Auto",
  "Home",
  "Dwelling",
  "Commercial",
  "Flood",
  "Renters",
  "Other",
] as const;

const OTHER_LINE = "Other";

export function buildPcPremiumTrendPoints<Row extends PcLineSourceRow>(
  periods: PcPremiumTrendPeriod[],
  rows: Row[],
  getPeriodKey: (row: Row) => string
): PcPremiumTrendPoint[] {
  const premiumByPeriod = new Map<string, Record<string, number>>();
  const policiesByPeriod = new Map<string, Record<string, Set<string>>>();

  rows.forEach((row, index) => {
    const premium = soldPremium(row);
    if (premium === 0) return;

    const periodKey = getPeriodKey(row);
    const line = trendLine(row.type);
    const premiumByLine = premiumByPeriod.get(periodKey) ?? {};
    const policiesByLine = policiesByPeriod.get(periodKey) ?? {};

    premiumByLine[line] = (premiumByLine[line] ?? 0) + premium;
    policiesByLine[line] ??= new Set();
    policiesByLine[line].add(row.policy_number?.trim() || `__row_${index}`);
    premiumByPeriod.set(periodKey, premiumByLine);
    policiesByPeriod.set(periodKey, policiesByLine);
  });

  return periods.map((period) => ({
    label: period.label,
    policies: period.policies,
    premium: period.premium,
    premiumByLine: premiumByPeriod.get(period.key) ?? {},
    policiesByLine: Object.fromEntries(
      Object.entries(policiesByPeriod.get(period.key) ?? {}).map(([line, policies]) => [
        line,
        policies.size,
      ])
    ),
  }));
}

function trendLine(type: string | null) {
  const label = getPcLineLabel(type);

  return (PC_TREND_LINES as readonly string[]).includes(label) ? label : OTHER_LINE;
}

function soldPremium(row: PcLineSourceRow) {
  const value = row.true_premium ?? row.premium;

  return typeof value === "number" && Number.isFinite(value) ? Math.max(value, 0) : 0;
}
