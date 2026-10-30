import { paidDates, parseMoney, type HealthCommissionRow } from "./values";

export const AMOUNT_FIELDS = ["mp", "ar", "sp"] as const;
export type AmountField = (typeof AMOUNT_FIELDS)[number];

/** One deal across the months of its year, like a line of the yearly sheet. */
export type DealLine = {
  key: string;
  y: number;
  /** The deal's latest month: its name, carrier, plan… as they stand now. */
  last: HealthCommissionRow;
  months: Partial<Record<number, HealthCommissionRow>>;
  firstRowId: number;
  /** Sum of each amount over the months that hold money. */
  totals: Record<AmountField, number>;
  /** Earliest / latest Paid-to-date among the months the agent was paid. */
  firstPaid: Date | null;
  lastPaid: Date | null;
};

const round = (value: number) => Math.round(value * 100) / 100;

export function groupDeals(rows: readonly HealthCommissionRow[], keys: ReadonlyMap<number, string>): DealLine[] {
  const deals = new Map<string, DealLine>();
  for (const row of rows) {
    const key = keys.get(row.id) ?? String(row.id);
    let deal = deals.get(key);
    if (!deal) {
      deal = { key, y: row.y, last: row, months: {}, firstRowId: row.id, totals: { mp: 0, ar: 0, sp: 0 }, firstPaid: null, lastPaid: null };
      deals.set(key, deal);
    }
    deal.months[row.m] = row;
    if (row.m >= deal.last.m) deal.last = row;
    if (row.id < deal.firstRowId) deal.firstRowId = row.id;
  }

  for (const deal of deals.values()) {
    for (const row of Object.values(deal.months)) {
      if (!row) continue;
      for (const field of AMOUNT_FIELDS) deal.totals[field] += parseMoney(row[field]) ?? 0;
      if (parseMoney(row.ar) === null) continue;
      for (const date of paidDates(row.ptd)) {
        if (!deal.firstPaid || date < deal.firstPaid) deal.firstPaid = date;
        if (!deal.lastPaid || date > deal.lastPaid) deal.lastPaid = date;
      }
    }
    for (const field of AMOUNT_FIELDS) deal.totals[field] = round(deal.totals[field]);
  }
  return [...deals.values()];
}

const monthKeyOf = (date: Date) => date.getFullYear() * 100 + date.getMonth() + 1;
const nextMonthKey = (key: number) => (key % 100 === 12 ? (Math.floor(key / 100) + 1) * 100 + 1 : key + 1);
const previousMonthKey = (key: number) => (key % 100 === 1 ? (Math.floor(key / 100) - 1) * 100 + 12 : key - 1);

/** A Paid-to-date typed with last year's year ("5/31/2025" on a May 2026 row) reads as the row's year. */
function paidToMonth(date: Date, reportKey: number): number {
  const key = monthKeyOf(date);
  const monthsBefore = (Math.floor(reportKey / 100) - date.getFullYear()) * 12 + (reportKey % 100) - (date.getMonth() + 1);
  return monthsBefore > 9 ? Math.floor(reportKey / 100) * 100 + (date.getMonth() + 1) : key;
}

/**
 * Months (yyyymm) between the deal's Broker Effective month and the last month
 * that should be paid by now that no payment covers.
 *
 * - "Should be paid" stops a month before the newest report (carriers such as
 *   Christus pay a month late), before the first Terminated month, and at the
 *   deal's last month in the data (the 2025 tab has no T, a deal just stops).
 * - Months marked NC / N/C are not owed, nor are months whose row has no
 *   amount and no code (the 2025 tab leaves 18% of its rows blank).
 * - A payment covers the month of its Paid-to-date (a P6 month paid in June
 *   counts as paid), and the months before it when it is a multiple of the
 *   deal's smallest payment ($29.10 against $14.55 pays two months).
 */
/**
 * Unpaid months are only worked out from 2026 on (user's call, 2026-10-30):
 * the 2025 tab has no status codes and leaves rows blank, so it cannot tell
 * "not paid" from "not recorded".
 */
export const UNPAID_CHECK_FROM_YEAR = 2026;

export function unpaidMonths(deal: DealLine, latestReport: number): number[] {
  if (deal.y < UNPAID_CHECK_FROM_YEAR) return [];
  const rows = Object.values(deal.months).filter((row): row is HealthCommissionRow => Boolean(row));
  const effective = paidDates(deal.last.be)[0] ?? paidDates(deal.last.pe)[0];
  if (!effective || rows.length === 0) return [];

  let end = previousMonthKey(Math.min(latestReport, deal.y * 100 + 12));
  end = Math.min(end, deal.y * 100 + Math.max(...rows.map((row) => row.m)));
  const firstTerminated = rows
    .filter((row) => row.ar.trim().toUpperCase() === "T")
    .reduce((first, row) => Math.min(first, deal.y * 100 + row.m), Infinity);
  if (firstTerminated !== Infinity) end = Math.min(end, previousMonthKey(firstTerminated));

  const payments = rows.flatMap((row) => {
    const amount = parseMoney(row.ar);
    return amount !== null && amount > 0 ? [{ row, amount }] : [];
  });
  const smallest = Math.min(...payments.map((payment) => payment.amount));
  const covered = new Set<number>();
  for (const { row, amount } of payments) {
    const months = Math.max(1, Math.round(amount / smallest));
    for (const date of paidDates(row.ptd)) {
      let key = paidToMonth(date, deal.y * 100 + row.m);
      for (let n = 0; n < months; n += 1, key = previousMonthKey(key)) covered.add(key);
    }
  }
  const notOwed = new Set(
    rows.filter((row) => ["NC", "N/C", ""].includes(row.ar.trim().toUpperCase())).map((row) => deal.y * 100 + row.m),
  );

  const missing: number[] = [];
  for (let key = Math.max(monthKeyOf(effective), deal.y * 100 + 1); key <= end; key = nextMonthKey(key)) {
    if (!covered.has(key) && !notOwed.has(key)) missing.push(key);
  }
  return missing;
}
