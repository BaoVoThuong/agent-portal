import { parsePlanCell } from "./plans";

type ProviderPlanRow = {
  obamacare: string | null;
  medicare: string | null;
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
