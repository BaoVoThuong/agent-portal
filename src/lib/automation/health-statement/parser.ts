import * as XLSX from "xlsx";
import type { HealthStatementInput, PaymentSummaryRow } from "./types";

type CellValue = string | number | boolean | Date | null;
type Matrix = CellValue[][];

const SKIP_SHEETS = new Set([
  "summary",
  "health_statement_result",
  "p&c_statement_result",
  "eps - payment",
]);

const MONTH_NAMES = [
  ["01", "Jan", "January"],
  ["02", "Feb", "February"],
  ["03", "Mar", "March"],
  ["04", "Apr", "April"],
  ["05", "May", "May"],
  ["06", "Jun", "June"],
  ["07", "Jul", "July"],
  ["08", "Aug", "August"],
  ["09", "Sep", "September"],
  ["10", "Oct", "October"],
  ["11", "Nov", "November"],
  ["12", "Dec", "December"],
];

const DEFAULT_ALIASES = {
  customerId: [
    "customer id",
    "member id",
    "subscriber id",
    "primary member id",
    "issuer subscriber id",
  ],
  customerName: [
    "customer name",
    "subscriber name",
    "member name",
    "client name",
    "deal name",
  ],
  effective: [
    "effective date",
    "effective",
    "subscriber eff date",
    "broker effective",
  ],
  paidToDate: ["paid to date"],
  gross: [
    "gross compensation",
    "gross",
    "commission",
    "payment",
    "carriers / messer paid",
  ],
  trans: ["transaction id", "trans", "transaction"],
  agent: ["agent", "broker", "producer"],
};

const RENEWAL_AGENT_COLUMNS = {
  policyNumber: "policy number",
  policyholderName: "policyholder name",
  issueDate: "issue date",
  paidToDate: "paid to date",
  grossCommission: "gross commission",
  transactionId: "transaction id",
};

function cleanText(value: CellValue): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\r\n/g, "\n").trim();
  return text === "" ? null : text;
}

function normalizeHeader(value: CellValue): string {
  return String(value ?? "")
    .replace(/\n/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseMoney(value: CellValue): number | null {
  const text = cleanText(value);
  if (!text) return null;
  const normalized = text.replace(/[$,\s]/g, "");
  if (!normalized || /^(p|pending|n\/c|nc|no contract|no commission|chargeback)$/i.test(normalized)) {
    return null;
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function stripLeadingApostrophe(value: CellValue): string | null {
  const text = cleanText(value);
  return text ? text.replace(/^'+/, "") : null;
}

function workbookToSheets(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  return workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<CellValue[]>(workbook.Sheets[name], {
      header: 1,
      defval: "",
      raw: false,
    }) as Matrix,
  }));
}

function splitCarrierStatement(sheetName: string, fallbackCarrier: string, fallbackStatement: string) {
  const parts = sheetName.split("-");
  if (parts.length < 2) {
    return {
      carrier: fallbackCarrier,
      statement: fallbackStatement,
    };
  }

  return {
    carrier: parts[0]?.trim() || fallbackCarrier,
    statement: parts[1]?.trim() || fallbackStatement,
  };
}

function findHeaderRow(rows: Matrix): number {
  return rows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return (
      normalized.some((header) => DEFAULT_ALIASES.customerId.includes(header)) &&
      normalized.some((header) => DEFAULT_ALIASES.customerName.includes(header))
    );
  });
}

function findColumn(headers: CellValue[], aliases: string[]): number {
  const normalized = headers.map(normalizeHeader);
  return normalized.findIndex((header) => aliases.includes(header));
}

function findExactColumn(headers: CellValue[], headerName: string): number {
  const normalized = normalizeHeader(headerName);
  return headers.findIndex((header) => normalizeHeader(header) === normalized);
}

function buildRow(values: PaymentSummaryRow): PaymentSummaryRow {
  return values;
}

function parseDefaultSheet(
  sheetName: string,
  rows: Matrix,
  input: HealthStatementInput
) {
  const headerIndex = findHeaderRow(rows);
  if (headerIndex === -1) return [];

  const headers = rows[headerIndex];
  const customerIdCol = findColumn(headers, DEFAULT_ALIASES.customerId);
  const customerNameCol = findColumn(headers, DEFAULT_ALIASES.customerName);
  const effectiveCol = findColumn(headers, DEFAULT_ALIASES.effective);
  const paidToCol = findColumn(headers, DEFAULT_ALIASES.paidToDate);
  const grossCol = findColumn(headers, DEFAULT_ALIASES.gross);
  const transCol = findColumn(headers, DEFAULT_ALIASES.trans);
  const agentCol = findColumn(headers, DEFAULT_ALIASES.agent);
  const { carrier, statement } = splitCarrierStatement(
    sheetName,
    input.carrier,
    input.statementNumber
  );

  if (customerIdCol === -1 || customerNameCol === -1) return [];

  return rows
    .slice(headerIndex + 1)
    .map((row) => {
      let customerId = cleanText(row[customerIdCol]);
      if (carrier.toUpperCase() === "BCBS" && customerId) {
        customerId = customerId.split("-")[0]?.trim() || customerId;
      }

      return buildRow({
        agent: agentCol === -1 ? null : cleanText(row[agentCol]),
        carrier_name: carrier,
        customer_id: customerId,
        customer_name: cleanText(row[customerNameCol]),
        effective_date: effectiveCol === -1 ? null : cleanText(row[effectiveCol]),
        paid_to_date: paidToCol === -1 ? null : cleanText(row[paidToCol]),
        gross_compensation: grossCol === -1 ? null : parseMoney(row[grossCol]),
        transaction_id: transCol === -1 ? null : cleanText(row[transCol]),
        statement,
      });
    })
    .filter((row) => row.customer_id || row.customer_name);
}

function canParseRenewalAgentSheet(rows: Matrix) {
  const headers = rows[0] ?? [];
  return (
    normalizeHeader(headers[0]) === "v20180401" &&
    findExactColumn(headers, RENEWAL_AGENT_COLUMNS.policyNumber) !== -1 &&
    findExactColumn(headers, RENEWAL_AGENT_COLUMNS.policyholderName) !== -1
  );
}

function parseRenewalAgentSheet(
  rows: Matrix,
  input: HealthStatementInput
) {
  const headers = rows[0] ?? [];
  const policyNumberCol = findExactColumn(headers, RENEWAL_AGENT_COLUMNS.policyNumber);
  const policyholderNameCol = findExactColumn(
    headers,
    RENEWAL_AGENT_COLUMNS.policyholderName
  );
  const issueDateCol = findExactColumn(headers, RENEWAL_AGENT_COLUMNS.issueDate);
  const paidToDateCol = findExactColumn(headers, RENEWAL_AGENT_COLUMNS.paidToDate);
  const grossCommissionCol = findExactColumn(
    headers,
    RENEWAL_AGENT_COLUMNS.grossCommission
  );
  const transactionIdCol = findExactColumn(
    headers,
    RENEWAL_AGENT_COLUMNS.transactionId
  );

  return rows
    .slice(1)
    .map((row) => {
      return buildRow({
        agent: null,
        carrier_name: input.carrier,
        customer_id: stripLeadingApostrophe(row[policyNumberCol]),
        customer_name: cleanText(row[policyholderNameCol]),
        effective_date: cleanText(row[issueDateCol]),
        paid_to_date: cleanText(row[paidToDateCol]),
        gross_compensation: parseMoney(row[grossCommissionCol]),
        transaction_id: cleanText(row[transactionIdCol]),
        statement: input.statementNumber,
      });
    })
    .filter((row) => row.customer_id || row.customer_name);
}

function monthVariants(monthReport: string) {
  const parts = monthReport.split("-");
  const month =
    parts.length === 2 && parts[0]?.length === 4
      ? parts[1]
      : parts[0] ?? monthReport.slice(0, 2);
  const normalizedMonth = month.padStart(2, "0");
  const match = MONTH_NAMES.find(([mm]) => mm === normalizedMonth);
  return match ? match.slice(1) : [normalizedMonth];
}

function paidDateForMonth(monthReport: string) {
  const [yearOrMonth, monthOrYear] = monthReport.split("-");
  const year = yearOrMonth.length === 4 ? Number(yearOrMonth) : Number(monthOrYear);
  const month = yearOrMonth.length === 4 ? Number(monthOrYear) : Number(yearOrMonth);
  if (!year || !month) return null;
  const lastDay = new Date(year, month, 0).getDate();
  return `${month}/${lastDay}/${year}`;
}

function processChcSheet(
  rows: Matrix,
  input: HealthStatementInput
) {
  let payee: string | null = null;
  for (const row of rows) {
    for (const cell of row) {
      const text = cleanText(cell);
      if (!payee && text && /^\d{6,}$/.test(text)) payee = text;
    }
  }
  if (!payee) return [];

  let headerRow = -1;
  let startCol = -1;
  let endRow = rows.length;

  rows.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (cleanText(cell) === "Subscriber ID") {
        headerRow = rowIndex;
        startCol = colIndex;
      }
    });
    if (row.map(cleanText).join(" ").includes("Broker Subtotal")) {
      endRow = rowIndex;
    }
  });
  if (headerRow === -1 || startCol === -1) return [];

  const block = rows.slice(Math.max(headerRow - 2, 0), endRow).map((row) => row.slice(startCol));
  if (block.length < 4) return [];

  ["Subscriber ID", "Subscriber Name"].forEach((columnName) => {
    const idx = block[2].findIndex((cell) => cleanText(cell) === columnName);
    if (idx === -1) return;
    let last: CellValue = "";
    block.forEach((row) => {
      if (cleanText(row[idx]) === null && cleanText(last)) row[idx] = last;
      else if (cleanText(row[idx])) last = row[idx];
    });
  });

  for (let col = 0; col < block[0].length; col += 1) {
    const monthHeader = cleanText(block[1][col])?.replace(/\n/g, " ").trim();
    const header = cleanText(block[2][col])?.replace(/\n/g, " ").trim();
    if (header === "Paid" && monthHeader) block[2][col] = `Paid ${monthHeader}`;
  }

  const header = block[2].map((cell) =>
    String(cell ?? "").replace(/\s+/g, " ").trim()
  );
  const variants = monthVariants(input.monthReport).map((month) => `Paid ${month}`);
  const paidCol = header.findIndex((column) => variants.includes(column));
  if (paidCol === -1) return [];

  const idx: Record<string, number> = {};
  header.forEach((column, index) => {
    idx[column] = index;
  });

  return block
    .slice(3)
    .map((row) => {
      const gross = parseMoney(row[paidCol]);
      if (!gross) return null;
      return buildRow({
        agent: null,
        carrier_name: "CHC",
        customer_id: cleanText(row[idx["Issuer Subscriber ID"]]),
        customer_name: cleanText(row[idx["Subscriber Name"]]),
        effective_date: cleanText(row[idx["Subscriber Eff Date"]]),
        paid_to_date: paidDateForMonth(input.monthReport),
        gross_compensation: gross,
        transaction_id: cleanText(row[idx["Subscriber ID"]]),
        statement: payee,
      });
    })
    .filter((row): row is PaymentSummaryRow => row !== null);
}

export function parseHealthPaymentWorkbook(
  buffer: Buffer,
  input: HealthStatementInput
): PaymentSummaryRow[] {
  const output: PaymentSummaryRow[] = [];
  const selectedCarrier = input.carrier.trim().toUpperCase();
  const sheets = workbookToSheets(buffer).filter(
    (sheet) => !SKIP_SHEETS.has(sheet.name.trim().toLowerCase())
  );
  const shouldProcessSingleSheet = sheets.length === 1;

  for (const sheet of sheets) {
    const normalizedName = sheet.name.trim().toLowerCase();
    const sheetCarrier = splitCarrierStatement(
      sheet.name,
      input.carrier,
      input.statementNumber
    ).carrier.toUpperCase();
    const shouldProcess =
      shouldProcessSingleSheet ||
      selectedCarrier === "" ||
      sheetCarrier.includes(selectedCarrier) ||
      normalizedName.includes(selectedCarrier.toLowerCase());

    if (!shouldProcess) {
      continue;
    }

    const parsed =
      selectedCarrier === "CHC" || normalizedName.includes("chc")
        ? processChcSheet(sheet.rows, input)
        : canParseRenewalAgentSheet(sheet.rows)
          ? parseRenewalAgentSheet(sheet.rows, input)
          : parseDefaultSheet(sheet.name, sheet.rows, input);
    output.push(...parsed);
  }

  return output;
}
