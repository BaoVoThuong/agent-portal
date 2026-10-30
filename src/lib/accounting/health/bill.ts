import { groupDeals, type DealLine } from "./deals";
import { commissionStatus, parseCount, parseMoney, type HealthCommissionRow } from "./values";

/** The fields at the top of the bill the accountant may overwrite. */
export type BillHeader = {
  transactionDate: string;
  payee: string;
  statementNo: string;
  payRate: string;
  balance: string;
  checkNo: string;
  totalMembers: string;
  paidMembers: string;
  unpaidMembers: string;
  noContract: string;
  terminated: string;
  unpaidPremium: string;
};

export type Bill = {
  agent: string;
  year: number;
  /** Cycle month, 1–12; the bill shows Jan…month of the same year. */
  month: number;
  cycle: string;
  /** Sum of Agent Received in the cycle month. */
  payout: number;
  lines: Array<DealLine & { paidToDate: number }>;
  /** Pre-filled from the data; the accountant decides the final values. */
  suggested: BillHeader;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase())
    .join("");
}

function percentLabel(rate: string) {
  return /^0?\.\d+$/.test(rate) ? `${Math.round(Number.parseFloat(rate) * 100)}%` : rate;
}

/**
 * An agent's commission statement for one month, laid out like the "bill" tab:
 * every deal of theirs that has a row in that year up to the cycle month, its
 * Agent Received (or code) per month, and Paid to date.
 */
export function buildBill(
  rows: readonly HealthCommissionRow[],
  keys: ReadonlyMap<number, string>,
  agent: string,
  year: number,
  month: number,
): Bill {
  const own = rows.filter((row) => row.agent === agent && row.y === year && row.m <= month);
  const lines = groupDeals(own, keys)
    .sort((a, b) => a.firstRowId - b.firstRowId)
    .map((deal) => ({ ...deal, paidToDate: deal.totals.ar }));

  const cycleRows = own.filter((row) => row.m === month);
  const members = (match: (row: HealthCommissionRow) => boolean) =>
    String(cycleRows.filter(match).reduce((sum, row) => sum + parseCount(row.n), 0));
  const status = (row: HealthCommissionRow) => commissionStatus(row.ar);

  const rateCounts = new Map<string, number>();
  for (const row of cycleRows) if (row.rate) rateCounts.set(row.rate, (rateCounts.get(row.rate) ?? 0) + 1);
  const rate = [...rateCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  const payout = cycleRows.reduce((sum, row) => sum + (parseMoney(row.ar) ?? 0), 0);

  return {
    agent,
    year,
    month,
    cycle: `${mm}/01 - ${mm}/${lastDay}/${year}`,
    payout: Math.round(payout * 100) / 100,
    lines,
    suggested: {
      transactionDate: "",
      payee: agent,
      statementNo: `EPSHEALTH - ${initials(agent)}${mm}- ${agent}`,
      payRate: percentLabel(rate),
      balance: "$ -",
      checkNo: "",
      totalMembers: members(() => true),
      paidMembers: members((row) => status(row) === "Paid"),
      unpaidMembers: members((row) => status(row) === "P" || status(row) === "P2–P8"),
      noContract: members((row) => status(row) === "N/C"),
      terminated: members((row) => status(row) === "T"),
      unpaidPremium: members((row) => status(row) === "UP"),
    },
  };
}
