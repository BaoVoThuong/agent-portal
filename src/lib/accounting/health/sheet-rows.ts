import type { HealthCommissionRow, RowField } from "./values";

/**
 * Reading commission rows out of a table of cells — the Google Sheet tabs (CSV)
 * on the server, an uploaded month file in the browser. Headers are matched
 * loosely: case, spaces, "_" and "-" do not matter, and both the 2025 tab's
 * spelling ("Deal name", "Messer Statement") and the "2026 clean" tab's
 * ("deal_name", "statement") are understood.
 */
const HEADER_FIELDS: Record<string, RowField | "month"> = {
  agent: "agent",
  numbercus: "n",
  numclient: "n",
  numberofmembers: "n",
  dealname: "deal",
  stage: "stage",
  dealstage: "stage",
  state: "state",
  carrier: "carrier",
  planname: "plan",
  primarymemberid: "mid",
  primaryid: "mid",
  planeffectivedate: "pe",
  planeffetivedate: "pe",
  brokereffectivedate: "be",
  brokereffective: "be",
  paidthrudate: "pt",
  carriersmesserpaid: "mp",
  payratelevel: "rate",
  agentreceived: "ar",
  epsoverride: "ov",
  epsoverridereceived: "ovr",
  epssplit: "sp",
  paidtodate: "ptd",
  transactionid: "tid",
  statement: "st",
  messerstatement: "st",
  monthreport: "month",
};

/** Columns a month file cannot do without. */
export const REQUIRED_FIELDS: readonly RowField[] = ["agent", "deal", "carrier", "mid", "ar"];

const headerKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const clean = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

/** "01/2025", "1/2025", "01-2026", "1/1/2026", "2026-08" → [year, month]. */
export function parseReportMonth(value: string): [number, number] | null {
  const text = value.trim();
  let match = text.match(/^(\d{1,2})[/-](\d{4})$/);
  if (match) return [Number(match[2]), Number(match[1])];
  match = text.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/);
  if (match) return [Number(match[2]), Number(match[1])];
  match = text.match(/^(\d{4})-(\d{2})/);
  if (match) return [Number(match[1]), Number(match[2])];
  return null;
}

export type SheetRow = Omit<HealthCommissionRow, "id" | "y" | "m"> & { month: [number, number] | null };

export type SheetRowsResult = {
  rows: SheetRow[];
  /** Required columns the header row does not name. */
  missing: RowField[];
  /** Header row not found among the first rows. */
  noHeader: boolean;
};

/**
 * The header row is the first of the top 25 that names five or more known
 * columns (a month file may have a title above it). Lines with neither a deal
 * name nor a member ID are skipped.
 */
export function rowsFromTable(table: readonly (readonly unknown[])[]): SheetRowsResult {
  let headerIndex = -1;
  let columns: Array<RowField | "month" | undefined> = [];
  for (let i = 0; i < Math.min(table.length, 25); i += 1) {
    const mapped = table[i].map((cell) => HEADER_FIELDS[headerKey(String(cell ?? ""))]);
    if (mapped.filter(Boolean).length >= 5) {
      headerIndex = i;
      columns = mapped;
      break;
    }
  }
  if (headerIndex === -1) return { rows: [], missing: [...REQUIRED_FIELDS], noHeader: true };

  // First column wins when two headers map to the same field.
  const at = new Map<RowField | "month", number>();
  columns.forEach((field, index) => {
    if (field && !at.has(field)) at.set(field, index);
  });

  const rows: SheetRow[] = [];
  for (const line of table.slice(headerIndex + 1)) {
    const cell = (field: RowField) => {
      const index = at.get(field);
      return index === undefined ? "" : clean(String(line[index] ?? ""));
    };
    const row: SheetRow = {
      agent: cell("agent"), n: cell("n"), deal: cell("deal"), stage: cell("stage"), state: cell("state"),
      carrier: cell("carrier"), plan: cell("plan"), mid: cell("mid"), pe: cell("pe"), be: cell("be"), pt: cell("pt"),
      mp: cell("mp"), rate: cell("rate"), ar: cell("ar"), ov: cell("ov"), ovr: cell("ovr"), sp: cell("sp"),
      ptd: cell("ptd"), tid: cell("tid"), st: cell("st"),
      month: at.has("month") ? parseReportMonth(String(line[at.get("month")!] ?? "")) : null,
    };
    if (!row.deal && !row.mid) continue;
    rows.push(row);
  }
  return { rows, missing: REQUIRED_FIELDS.filter((field) => !at.has(field)), noHeader: false };
}

/** RFC 4180 CSV: quoted cells may hold commas, doubled quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
