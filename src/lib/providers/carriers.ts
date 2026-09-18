import { parsePlanCell } from "./plans";

type ProviderPlanRow = {
  obamacare: string | null;
  medicare: string | null;
};

type ProviderLocationRow = {
  state: string | null;
  city: string | null;
};

/**
 * Carrier suggestions are the plan labels people can actually search for.
 * Keep the specific label (`Oscar EPO`, `CHC Premier`) instead of collapsing it
 * to a broad carrier name that may match the wrong network.
 */
export function providerCarrierOptions(rows: readonly ProviderPlanRow[]): string[] {
  const values = new Map<string, string>();
  for (const row of rows) {
    for (const plan of [...parsePlanCell(row.obamacare), ...parsePlanCell(row.medicare)]) {
      const key = plan.toLowerCase();
      if (!values.has(key)) values.set(key, plan);
    }
  }
  return [...values.values()].sort((a, b) => a.localeCompare(b));
}

/** Distinct location values used by the Provider Finder autocomplete fields. */
export function providerLocationOptions(
  rows: readonly ProviderLocationRow[],
  field: keyof ProviderLocationRow,
): string[] {
  const values = new Map<string, string>();
  for (const row of rows) {
    const value = row[field]?.trim() ?? "";
    if (!value) continue;
    const key = value.toLowerCase();
    if (!values.has(key)) values.set(key, value);
  }

  return [...values.values()].sort((a, b) => a.localeCompare(b));
}
