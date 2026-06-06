import * as XLSX from "xlsx";

type CellValue = string | number | boolean | Date | null;
type Matrix = CellValue[][];

type MergeRange = {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

type ParsedSheet = {
  name: string;
  rows: Matrix;
  merges: MergeRange[];
};

type ColumnKind = "date" | "number" | "text";

type ColumnSpec = {
  label: string;
  kind: ColumnKind;
};

type ColumnKey =
  | "insured"
  | "policyNo"
  | "policyExpirationDate"
  | "invoiceDate"
  | "transactionCode"
  | "commissionablePremium"
  | "carrierRate"
  | "commissionPaidToTwfg"
  | "producerSplit"
  | "proRatedPremium"
  | "fixedAmount"
  | "producerCommission";

export type PcCleanPaymentRow = {
  insured: string;
  policyNo: string;
  policyExp: string;
  commissionablePremium: number | null;
  carrierRate: number | null;
  company: string;
  agency: string | null;
};

export type PcPaymentParseResult = {
  rows: PcCleanPaymentRow[];
  sheets: Array<{
    name: string;
    rowsExtracted: number;
    skipped?: string;
    columns?: Partial<Record<ColumnKey, string>>;
  }>;
};

const COLUMN_SPECS: Record<ColumnKey, ColumnSpec> = {
  insured: { label: "Insured", kind: "text" },
  policyNo: { label: "Policy No", kind: "text" },
  policyExpirationDate: { label: "Policy Exp", kind: "date" },
  invoiceDate: { label: "Inv Date", kind: "date" },
  transactionCode: { label: "Tran", kind: "text" },
  commissionablePremium: {
    label: "Commissionable Premium",
    kind: "number",
  },
  carrierRate: { label: "Carrier Rate (%)", kind: "number" },
  commissionPaidToTwfg: {
    label: "Commission Paid to TWFG",
    kind: "number",
  },
  producerSplit: { label: "Prod Split (%)", kind: "number" },
  proRatedPremium: { label: "Pro-Rated Premium", kind: "number" },
  fixedAmount: { label: "Fixed $", kind: "number" },
  producerCommission: { label: "Prod Comm", kind: "number" },
};

function normalizeLabel(value: CellValue | undefined) {
  return String(value ?? "")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isEmpty(value: CellValue | undefined) {
  return value === null || value === undefined || String(value).trim() === "";
}

function cleanText(value: CellValue | undefined) {
  if (isEmpty(value)) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  if (value instanceof Date) return value.toISOString();
  return String(value).replace(/\s+/g, " ").trim();
}

function parseNumber(value: CellValue | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const rawText = String(value).trim();
  if (!rawText) return null;
  const isNegative = rawText.startsWith("(") && rawText.endsWith(")");
  const text = rawText.replace(/[$,*]/g, "").replace(/[()]/g, "").trim();
  const number = Number(text);
  if (!Number.isFinite(number)) return null;
  return isNegative ? -number : number;
}

function parseDateValue(value: CellValue | undefined) {
  if (isEmpty(value)) return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    const date = new Date(Date.UTC(1899, 11, 30 + Math.trunc(value)));
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }

  const text = cleanText(value);
  const mdy = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    const year = Number(mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }

  const ymd = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;

  return text;
}

function formatPaymentDate(value: CellValue | undefined) {
  return parseDateValue(value);
}

function columnLetters(index: number) {
  let value = index + 1;
  let output = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }

  return output;
}

function rowNonEmpty(row: CellValue[] | undefined) {
  return (row ?? [])
    .map((value, col) => ({ col, value }))
    .filter(({ value }) => !isEmpty(value));
}

function regionCols(sheet: ParsedSheet, rowIndex: number, col: number) {
  const merge = sheet.merges.find(
    (item) =>
      item.startRow <= rowIndex &&
      rowIndex <= item.endRow &&
      item.startCol <= col &&
      col <= item.endCol
  );

  if (!merge) return [col];

  return Array.from(
    { length: merge.endCol - merge.startCol + 1 },
    (_, index) => merge.startCol + index
  );
}

function findLabelRegion(sheet: ParsedSheet, label: string) {
  const target = normalizeLabel(label);

  for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex += 1) {
    for (const { col, value } of rowNonEmpty(sheet.rows[rowIndex])) {
      if (normalizeLabel(value) === target) {
        return regionCols(sheet, rowIndex, col);
      }
    }
  }

  return [];
}

function isNumericCell(value: CellValue | undefined) {
  return parseNumber(value) !== null;
}

function scoreCandidateCol(rows: Matrix, col: number, kind: ColumnKind) {
  let nonEmptyCount = 0;
  let preferredCount = 0;

  for (const row of rows) {
    const value = row[col];
    if (isEmpty(value)) continue;

    nonEmptyCount += 1;
    if (kind === "number" && isNumericCell(value)) {
      preferredCount += 1;
    } else if (kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(parseDateValue(value))) {
      preferredCount += 1;
    } else if (kind === "text") {
      preferredCount += 1;
    }
  }

  return { preferredCount, nonEmptyCount };
}

function detectHeaderIndex(sheet: ParsedSheet) {
  return sheet.rows.findIndex((row) => {
    const labels = new Set(rowNonEmpty(row).map(({ value }) => normalizeLabel(value)));
    return labels.has("insured") && labels.has("policy no") && labels.has("tran");
  });
}

function detectColumns(sheet: ParsedSheet, headerIndex: number) {
  const dataRows = sheet.rows.slice(headerIndex + 1);
  const output = {} as Record<ColumnKey, number>;

  for (const [field, spec] of Object.entries(COLUMN_SPECS) as Array<
    [ColumnKey, ColumnSpec]
  >) {
    const candidates = findLabelRegion(sheet, spec.label);
    if (candidates.length === 0) {
      throw new Error(`Could not detect column: ${spec.label}`);
    }

    output[field] = candidates.reduce((bestCol, col) => {
      const bestScore = scoreCandidateCol(dataRows, bestCol, spec.kind);
      const nextScore = scoreCandidateCol(dataRows, col, spec.kind);

      if (nextScore.preferredCount !== bestScore.preferredCount) {
        return nextScore.preferredCount > bestScore.preferredCount ? col : bestCol;
      }

      if (nextScore.nonEmptyCount !== bestScore.nonEmptyCount) {
        return nextScore.nonEmptyCount > bestScore.nonEmptyCount ? col : bestCol;
      }

      return col < bestCol ? col : bestCol;
    });
  }

  return output;
}

function isStatusRow(text: string) {
  return ["paid items", "unpaid items"].includes(normalizeLabel(text));
}

function isSkipLabel(text: string) {
  const normalized = normalizeLabel(text);
  return (
    normalized.startsWith("total ") ||
    normalized.startsWith("grand total") ||
    normalized.startsWith("twfg total") ||
    normalized.startsWith("closed ") ||
    normalized.startsWith("please direct") ||
    normalized.startsWith("*") ||
    ["producer", "paid items", "unpaid items"].includes(normalized)
  );
}

function isDetailRow(row: CellValue[], columns: Record<ColumnKey, number>) {
  const insured = cleanText(row[columns.insured]);
  if (!insured || isSkipLabel(insured)) return false;

  return (
    Boolean(cleanText(row[columns.transactionCode])) ||
    isNumericCell(row[columns.commissionablePremium]) ||
    isNumericCell(row[columns.producerCommission])
  );
}

function rowToCleanPayment(
  row: CellValue[],
  columns: Record<ColumnKey, number>,
  company: string,
  agency: string | null
): PcCleanPaymentRow {
  return {
    insured: cleanText(row[columns.insured]),
    policyNo: cleanText(row[columns.policyNo]),
    policyExp: formatPaymentDate(row[columns.policyExpirationDate]),
    commissionablePremium: parseNumber(row[columns.commissionablePremium]),
    carrierRate: parseNumber(row[columns.carrierRate]),
    company,
    agency,
  };
}

function agencyFromProducerAccount(value: string) {
  const match = value.match(/\((TWFG|DP)\)/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function parseSheet(sheet: ParsedSheet) {
  const headerIndex = detectHeaderIndex(sheet);
  if (headerIndex === -1) {
    return {
      rows: [],
      summary: { name: sheet.name, rowsExtracted: 0, skipped: "header_not_found" },
    };
  }

  const columns = detectColumns(sheet, headerIndex);
  const rows: PcCleanPaymentRow[] = [];
  let company = "";
  let agency: string | null = null;

  for (const row of sheet.rows.slice(headerIndex + 1)) {
    const nonEmpty = rowNonEmpty(row);
    if (nonEmpty.length === 0) continue;

    if (nonEmpty.length === 1) {
      const [{ col, value }] = nonEmpty;
      const text = cleanText(value);

      const rowAgency = agencyFromProducerAccount(text);
      if (isStatusRow(text) || rowAgency) {
        if (isStatusRow(text)) company = "";
        agency = rowAgency ?? agency;
        continue;
      }

      if (col === 2 && !normalizeLabel(text).startsWith("total ")) {
        company = text;
        continue;
      }
    }

    const firstText = cleanText(nonEmpty[0]?.value);
    if (firstText.toLowerCase().startsWith("closed ")) continue;

    if (isDetailRow(row, columns)) {
      rows.push(rowToCleanPayment(row, columns, company, agency));
    }
  }

  return {
    rows,
    summary: {
      name: sheet.name,
      rowsExtracted: rows.length,
      columns: Object.fromEntries(
        Object.entries(columns).map(([field, col]) => [field, columnLetters(col)])
      ) as Partial<Record<ColumnKey, string>>,
    },
  };
}

function workbookToSheets(buffer: Buffer): ParsedSheet[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });

  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
    }) as Matrix;

    return {
      name,
      rows,
      merges: (sheet["!merges"] ?? []).map((merge) => ({
        startRow: merge.s.r,
        startCol: merge.s.c,
        endRow: merge.e.r,
        endCol: merge.e.c,
      })),
    };
  });
}

export function parsePcPaymentWorkbook(buffer: Buffer): PcPaymentParseResult {
  const output: PcCleanPaymentRow[] = [];
  const sheets = [];

  for (const sheet of workbookToSheets(buffer)) {
    const parsed = parseSheet(sheet);
    output.push(...parsed.rows);
    sheets.push(parsed.summary);
  }

  return { rows: output, sheets };
}
