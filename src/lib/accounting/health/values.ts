/**
 * Health commission rows as the accountant keeps them: one row per deal per
 * month, every cell the text that was typed into the yearly sheet ("$21.00",
 * "P6", "N/C"…). Nothing here computes commission — the accountant brings the
 * numbers; these helpers only read them. Shared by server and client.
 */

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Column order of the "2026 clean" tab, minus month_report (kept as y/m). */
export const ROW_FIELDS = [
  "agent", // agent
  "n", // number_cus
  "deal", // deal_name
  "stage",
  "state",
  "carrier",
  "plan", // plan_name
  "mid", // primary_member_id
  "pe", // plan_effective_date
  "be", // broker_effective_date
  "pt", // paid_thru_date
  "mp", // carriers_messer_paid
  "rate", // pay_rate_level
  "ar", // agent_received
  "ov", // eps_override
  "ovr", // eps_override_received
  "sp", // eps_split
  "ptd", // paid_to_date
  "tid", // transaction_id
  "st", // statement
] as const;

export type RowField = (typeof ROW_FIELDS)[number];

export type HealthCommissionRow = { id: number; y: number; m: number } & Record<RowField, string>;

/** Rows sent to the browser: each cell an index into one string table (~3× smaller). */
export type PackedHealthRows = {
  fields: readonly RowField[];
  strings: string[];
  rows: number[][];
};

export function packRows(rows: Omit<HealthCommissionRow, "id">[]): PackedHealthRows {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const id = (value: string) => {
    let at = index.get(value);
    if (at === undefined) {
      at = strings.length;
      strings.push(value);
      index.set(value, at);
    }
    return at;
  };
  return {
    fields: ROW_FIELDS,
    strings,
    rows: rows.map((row) => [row.y, row.m, ...ROW_FIELDS.map((field) => id(row[field] ?? ""))]),
  };
}

export function unpackRows(packed: PackedHealthRows): HealthCommissionRow[] {
  return packed.rows.map((cells, index) => {
    const row = { id: index + 1, y: cells[0], m: cells[1] } as HealthCommissionRow;
    packed.fields.forEach((field, at) => {
      row[field] = packed.strings[cells[at + 2]] ?? "";
    });
    return row;
  });
}

/** "$1,234.50", "-$84.00", "(12.00)", "21" → number; a status code or blank → null. */
export function parseMoney(value: string | null | undefined): number | null {
  if (value == null) return null;
  const text = String(value).replace(/[$,\s]/g, "");
  if (!/^\(?-?\d*\.?\d+\)?$/.test(text)) return null;
  const amount = Number.parseFloat(text.replace(/[()]/g, ""));
  return text.startsWith("(") ? -amount : amount;
}

export function parseCount(value: string | null | undefined): number {
  const count = Number.parseInt(String(value ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(count) ? count : 0;
}

export function formatMoney(value: number): string {
  const text = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? "-$" : "$"}${text}`;
}

export const COMMISSION_STATUSES = ["Paid", "P", "P2–P8", "NC", "N/C", "T", "UP", "C", "NE", "Blank", "Other"] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

/** What an amount cell says: money, or one of the codes on the bill legend. */
export function commissionStatus(value: string | null | undefined): CommissionStatus {
  const text = String(value ?? "").trim().toUpperCase();
  if (!text) return "Blank";
  if (parseMoney(text) !== null) return "Paid";
  if (text === "P") return "P";
  if (/^P\d+$/.test(text)) return "P2–P8";
  if (text === "NC" || text === "N/C" || text === "T" || text === "UP" || text === "NE") return text;
  if (text === "C" || text === "CHARGEBACK") return "C";
  return "Other";
}

const DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;

/** Every m/d/yyyy in a Paid-to-date cell (some hold two: "07/31/2026  6/30/2026"). */
export function paidDates(value: string | null | undefined): Date[] {
  return [...String(value ?? "").matchAll(DATE_RE)].map(
    (match) => new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2])),
  );
}

export function formatDate(date: Date | null): string {
  if (!date) return "";
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${date.getFullYear()}`;
}

/** 2026-08 → 202608, so months sort as numbers. */
export const monthKey = (year: number, month: number) => year * 100 + month;
export const monthKeyLabel = (key: number) => `${MONTHS[(key % 100) - 1]} ${Math.floor(key / 100)}`;

const squash = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The deal a row belongs to, within its year: agent + member ID + deal name.
 * The same three on two rows of one month are two deals (#1, #2) — the sheet
 * has a handful of those.
 */
export function dealKeys(rows: readonly HealthCommissionRow[]): Map<number, string> {
  const keys = new Map<number, string>();
  const seen = new Map<string, number>();
  for (const row of rows) {
    const base = `${row.y}|${squash(row.agent)}|${squash(row.mid)}|${squash(row.deal)}`;
    const slot = `${base}|${row.m}`;
    const occurrence = (seen.get(slot) ?? 0) + 1;
    seen.set(slot, occurrence);
    keys.set(row.id, `${base}#${occurrence}`);
  }
  return keys;
}
