import * as XLSX from "xlsx";
import type {
  PcStatementReport,
} from "./report";
import {
  CLEAN_PAYMENT_HEADERS,
  STATEMENT_HEADERS,
  cleanPaymentValues,
  statementValues,
} from "./table-data";

const SHEET_NAME = "P&C_Statement_Result";

function setCell(
  sheet: XLSX.WorkSheet,
  address: string,
  value: string | number | boolean | null
) {
  sheet[address] = {
    t: typeof value === "number" ? "n" : typeof value === "boolean" ? "b" : "s",
    v: value ?? "",
  };
}

function setFormula(
  sheet: XLSX.WorkSheet,
  address: string,
  formula: string,
  cachedValue?: string | number | boolean
) {
  sheet[address] = {
    t: typeof cachedValue === "boolean" ? "b" : "n",
    f: formula.replace(/^=/, ""),
    v: cachedValue ?? 0,
  };
}

function addTable(
  sheet: XLSX.WorkSheet,
  origin: string,
  headers: string[],
  rows: Array<Array<string | number | null>>
) {
  XLSX.utils.sheet_add_aoa(sheet, [headers, ...rows], { origin });
}

function setSection(
  sheet: XLSX.WorkSheet,
  titleCell: string,
  title: string,
  labelCell: string,
  sumCell: string,
  formula: string,
  cachedValue: number
) {
  setCell(sheet, titleCell, title);
  setCell(sheet, labelCell, "Total Premium");
  setFormula(sheet, sumCell, formula, cachedValue);
}

function applySummary(sheet: XLSX.WorkSheet, report: PcStatementReport) {
  setCell(sheet, "A8", "Payment Clean");
  setCell(sheet, "A9", "Total Premium");
  setFormula(sheet, "B9", "=SUM(D11:D)", report.totals.totalPayment);
  setCell(sheet, "C8", "Base Policy");
  setFormula(sheet, "C9", "=SUM(R10:R)", report.totals.basePolicy);
  setCell(sheet, "D8", "Additional Policy");
  setFormula(sheet, "D9", "=SUM(AN10:AN)", report.totals.additional);
  setCell(sheet, "E8", "Unclaim Payment");
  setFormula(sheet, "E9", "=SUM(BH10:BH)", report.totals.unclaimed);
  setCell(sheet, "F8", "Sum Check");
  setFormula(sheet, "F9", "=C9+D9+E9=B9", report.totals.balanced);

  setSection(
    sheet,
    "H8",
    "Policy In Month Report",
    "H9",
    "I9",
    "=SUM(R10:R)",
    report.totals.basePolicy
  );
  setSection(
    sheet,
    "AD8",
    "Additional Policy",
    "AD9",
    "AE9",
    "=SUM(AN10:AN)",
    report.totals.additional
  );
  setSection(
    sheet,
    "AX8",
    "Unclaim Payment",
    "AX9",
    "AY9",
    "=SUM(BH10:BH)",
    report.totals.unclaimed
  );
}

export function buildPcStatementWorkbook(report: PcStatementReport) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([]);

  addTable(
    sheet,
    "A10",
    CLEAN_PAYMENT_HEADERS,
    report.cleanPayment.map(cleanPaymentValues)
  );
  addTable(
    sheet,
    "H10",
    STATEMENT_HEADERS,
    report.policyInMonth.map(statementValues)
  );
  addTable(
    sheet,
    "AD10",
    STATEMENT_HEADERS,
    report.additionalPolicy.map(statementValues)
  );
  addTable(
    sheet,
    "AX10",
    STATEMENT_HEADERS,
    report.unclaimedPayment.map(statementValues)
  );

  applySummary(sheet, report);
  sheet["!cols"] = Array.from({ length: 72 }, () => ({ wch: 18 }));

  XLSX.utils.book_append_sheet(workbook, sheet, SHEET_NAME);

  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}
