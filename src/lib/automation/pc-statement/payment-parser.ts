import * as XLSX from "xlsx";
import {
  columnIndex,
  columnLetters,
  missingPcInputs,
  pcInputLabel,
  PC_INPUT_FIELDS,
  type PcColumnMapping,
  type PcFileColumn,
  type PcInputField,
  type PcInputKind,
  type PcWorkbookInspection,
} from "./column-mapping";

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

type ColumnIndexes = Record<PcInputField, number>;

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
    columns?: Partial<Record<PcInputField, string>>;
  }>;
  /** Layout problems that would not stop the run but would make it wrong. */
  warnings: string[];
};

/** The file's headers do not name every input: the user has to map them. */
export class PcColumnMappingError extends Error {
  constructor(readonly missing: PcInputField[]) {
    super(`Map these columns before running: ${missing.map(pcInputLabel).join(", ")}.`);
    this.name = "PcColumnMappingError";
  }
}

/** Header rows above the one with the field names that still belong to the header (two-row headers). */
const MAX_EXTRA_HEADER_ROWS = 2;
const SAMPLE_COUNT = 3;

function normalizeLabel(value: CellValue | undefined) {
  return String(value ?? "")
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
  if (typeof value === "number") return String(value);
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

function isNumericCell(value: CellValue | undefined) {
  return parseNumber(value) !== null;
}

function scoreCandidateCol(rows: Matrix, col: number, kind: PcInputKind) {
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

function agencyFromProducerAccount(value: string) {
  const match = value.match(/\((TWFG|DP)\)/i);
  return match?.[1]?.toUpperCase() ?? null;
}

const KNOWN_HEADER_LABELS = new Set<string>(
  PC_INPUT_FIELDS.flatMap((field) => [...field.aliases]),
);

/**
 * The row naming the input columns. Prefer the row that names the most of
 * them; if the carrier renamed all of them, fall back to the last all-text
 * row (three or more cells) before the first row that carries numbers.
 */
function detectHeaderIndex(sheet: ParsedSheet) {
  let bestIndex = -1;
  let bestScore = 1;
  sheet.rows.forEach((row, index) => {
    const score = rowNonEmpty(row).filter(({ value }) =>
      KNOWN_HEADER_LABELS.has(normalizeLabel(value)),
    ).length;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  if (bestIndex !== -1) return bestIndex;

  let lastTextRow = -1;
  for (const [index, row] of sheet.rows.entries()) {
    const cells = rowNonEmpty(row);
    const numbers = cells.filter(({ value }) => isNumericCell(value)).length;
    if (cells.length >= 4 && numbers >= 2) return lastTextRow;
    if (cells.length >= 3 && numbers === 0) lastTextRow = index;
  }
  return -1;
}

/** Header text per column, across a two-row header and merged header cells. */
function headerLabels(sheet: ParsedSheet, headerIndex: number) {
  let firstHeaderRow = headerIndex;
  while (
    firstHeaderRow > 0 &&
    headerIndex - firstHeaderRow < MAX_EXTRA_HEADER_ROWS &&
    rowNonEmpty(sheet.rows[firstHeaderRow - 1]).length >= 2
  ) {
    firstHeaderRow -= 1;
  }

  const labels = new Map<number, string[]>();
  for (let rowIndex = firstHeaderRow; rowIndex <= headerIndex; rowIndex += 1) {
    for (const { col, value } of rowNonEmpty(sheet.rows[rowIndex])) {
      const text = cleanText(value);
      for (const target of regionCols(sheet, rowIndex, col)) {
        const current = labels.get(target) ?? [];
        if (!current.includes(text)) current.push(text);
        labels.set(target, current);
      }
    }
  }
  return labels;
}

/** Rows that look like payment lines: three or more cells, not a total or footer. */
function dataRows(sheet: ParsedSheet, headerIndex: number) {
  return sheet.rows.slice(headerIndex + 1).filter((row) => {
    const cells = rowNonEmpty(row);
    return cells.length >= 3 && !isSkipLabel(cleanText(cells[0].value));
  });
}

type SheetColumn = PcFileColumn & { index: number; labelParts: string[] };

function sampleText(value: CellValue, label: string) {
  if (typeof value === "number" && /date|exp|eff/i.test(label) && value > 20000 && value < 80000) {
    return parseDateValue(value);
  }
  const text = cleanText(value);
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

function sheetColumns(sheet: ParsedSheet, headerIndex: number, rows: Matrix): SheetColumn[] {
  const labels = headerLabels(sheet, headerIndex);
  const width = Math.max(0, ...rows.map((row) => row.length));
  const columns: SheetColumn[] = [];
  for (let index = 0; index < width; index += 1) {
    const values = rows.map((row) => row[index]).filter((value) => !isEmpty(value));
    if (values.length === 0) continue;
    const parts = labels.get(index) ?? [];
    const letter = columnLetters(index);
    // Show the lowest header line ("Insured", not "Company / Insured"); the
    // guess below still reads every line.
    const label = parts.length > 0 ? parts[parts.length - 1] : `Column ${letter}`;
    columns.push({
      index,
      letter,
      label,
      labelParts: parts.map((part) => normalizeLabel(part)),
      samples: values.slice(0, SAMPLE_COUNT).map((value) => sampleText(value, label)),
    });
  }
  return columns;
}

/** Pre-fill each input from a column whose header names it; a column serves one input. */
function suggestMapping(columns: SheetColumn[], rows: Matrix): Partial<PcColumnMapping> {
  const used = new Set<number>();
  const suggested: Partial<PcColumnMapping> = {};
  for (const field of PC_INPUT_FIELDS) {
    const aliases = field.aliases as readonly string[];
    const candidates = columns.filter(
      (column) => !used.has(column.index) && column.labelParts.some((part) => aliases.includes(part)),
    );
    if (candidates.length === 0) continue;
    const best = candidates.reduce((bestColumn, column) => {
      const bestScore = scoreCandidateCol(rows, bestColumn.index, field.kind);
      const nextScore = scoreCandidateCol(rows, column.index, field.kind);
      if (nextScore.preferredCount !== bestScore.preferredCount) {
        return nextScore.preferredCount > bestScore.preferredCount ? column : bestColumn;
      }
      if (nextScore.nonEmptyCount !== bestScore.nonEmptyCount) {
        return nextScore.nonEmptyCount > bestScore.nonEmptyCount ? column : bestColumn;
      }
      return column.index < bestColumn.index ? column : bestColumn;
    });
    used.add(best.index);
    suggested[field.key] = best.letter;
  }
  return suggested;
}

function toIndexes(mapping: PcColumnMapping): ColumnIndexes {
  return Object.fromEntries(
    PC_INPUT_FIELDS.map((field) => [field.key, columnIndex(mapping[field.key])]),
  ) as ColumnIndexes;
}

function isDetailRow(row: CellValue[], columns: ColumnIndexes) {
  const insured = cleanText(row[columns.insured]);
  if (!insured || isSkipLabel(insured)) return false;
  return isNumericCell(row[columns.premium]) || Boolean(cleanText(row[columns.policyNo]));
}

/**
 * The column holding the carrier name. The report puts it alone on the row
 * right above that carrier's payments (column C in the TWFG export, while
 * the producer address lines sit alone in column A). Read it from the file
 * rather than assume C, so a shifted layout still finds the carriers.
 */
function detectCompanyColumn(sheet: ParsedSheet, headerIndex: number, columns: ColumnIndexes) {
  const counts = new Map<number, number>();
  let pending: number | null = null;
  for (const row of sheet.rows.slice(headerIndex + 1)) {
    const cells = rowNonEmpty(row);
    if (cells.length === 0) continue;
    if (isDetailRow(row, columns)) {
      if (pending !== null) counts.set(pending, (counts.get(pending) ?? 0) + 1);
      pending = null;
      continue;
    }
    const text = cleanText(cells[0].value);
    pending =
      cells.length === 1 && !isStatusRow(text) && !agencyFromProducerAccount(text) && !isSkipLabel(text)
        ? cells[0].col
        : null;
  }
  let best: number | null = null;
  for (const [col, count] of counts) {
    if (best === null || count > (counts.get(best) ?? 0)) best = col;
  }
  return best;
}

function rowToCleanPayment(
  row: CellValue[],
  columns: ColumnIndexes,
  company: string,
  agency: string | null
): PcCleanPaymentRow {
  return {
    insured: cleanText(row[columns.insured]),
    policyNo: cleanText(row[columns.policyNo]),
    policyExp: parseDateValue(row[columns.policyExp]),
    commissionablePremium: parseNumber(row[columns.premium]),
    carrierRate: parseNumber(row[columns.carrierRate]),
    company,
    agency,
  };
}

function inspectSheet(sheet: ParsedSheet, headerIndex: number) {
  const rows = dataRows(sheet, headerIndex);
  const columns = sheetColumns(sheet, headerIndex, rows);
  return { columns, suggested: suggestMapping(columns, rows) };
}

function parseSheet(sheet: ParsedSheet, mapping: PcColumnMapping | null) {
  const headerIndex = detectHeaderIndex(sheet);
  if (headerIndex === -1) {
    return {
      rows: [],
      foundCompanyColumn: false,
      summary: { name: sheet.name, rowsExtracted: 0, skipped: "header_not_found" },
    };
  }

  let resolved = mapping;
  if (!resolved) {
    const { suggested } = inspectSheet(sheet, headerIndex);
    const missing = missingPcInputs(suggested);
    if (missing.length > 0) throw new PcColumnMappingError(missing);
    resolved = suggested as PcColumnMapping;
  }
  const columns = toIndexes(resolved);
  const companyColumn = detectCompanyColumn(sheet, headerIndex, columns);
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

      if (col === companyColumn && !normalizeLabel(text).startsWith("total ")) {
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
    foundCompanyColumn: companyColumn !== null,
    summary: {
      name: sheet.name,
      rowsExtracted: rows.length,
      columns: { ...resolved },
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

/**
 * The columns of a payment file, for the mapping step: the first sheet with a
 * header row, each column that carries data with its header text and a few
 * sample values, plus the mapping guessed from the header text.
 */
export function inspectPcPaymentWorkbook(buffer: Buffer): PcWorkbookInspection {
  for (const sheet of workbookToSheets(buffer)) {
    const headerIndex = detectHeaderIndex(sheet);
    if (headerIndex === -1) continue;
    const { columns, suggested } = inspectSheet(sheet, headerIndex);
    return {
      sheet: sheet.name,
      headerRow: headerIndex + 1,
      columns: columns.map(({ letter, label, samples }) => ({ letter, label, samples })),
      suggested,
    };
  }
  return { sheet: null, headerRow: null, columns: [], suggested: {} };
}

/**
 * Clean payment rows from every sheet. `mapping` is the user's choice from the
 * mapping step and applies to every sheet of this file; without one the
 * header text must name all five inputs (PcColumnMappingError otherwise).
 */
export function parsePcPaymentWorkbook(
  buffer: Buffer,
  mapping: PcColumnMapping | null = null,
): PcPaymentParseResult {
  const output: PcCleanPaymentRow[] = [];
  const sheets = [];
  let foundCompanyColumn = false;

  for (const sheet of workbookToSheets(buffer)) {
    const parsed = parseSheet(sheet, mapping);
    output.push(...parsed.rows);
    sheets.push(parsed.summary);
    foundCompanyColumn ||= parsed.foundCompanyColumn;
  }

  const warnings: string[] = [];
  if (output.length > 0) {
    const percentRates = output.filter((row) => (row.carrierRate ?? 0) > 1).length;
    if (percentRates > 0) {
      warnings.push(
        `Carrier Rate is above 100% on ${percentRates} row(s). It should read like 0.15, not 15 — check the Carrier Rate column.`,
      );
    }
    if (output.every((row) => !row.agency)) {
      warnings.push(
        "No producer line with (TWFG) or (DP) was found, so the TWFG/DP commission split stays blank.",
      );
    }
    if (!foundCompanyColumn || output.every((row) => !row.company)) {
      warnings.push("No carrier (company) rows were found above the payments.");
    }
  }

  return { rows: output, sheets, warnings };
}
