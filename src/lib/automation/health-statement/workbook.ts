import * as XLSX from "xlsx";
import type { HealthStatementReport } from "./report";
import {
  HEALTH_DUPLICATE_HEADERS,
  HEALTH_PAYMENT_HEADERS,
  HEALTH_PRODUCER_HEADERS,
  healthDuplicateValues,
  healthPaymentValues,
  healthProducerValues,
} from "./table-data";

const SHEET_NAME = "Health_Statement_Result";

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

function setFormula(sheet: XLSX.WorkSheet, address: string, formula: string) {
  sheet[address] = { t: "n", f: formula.replace(/^=/, "") };
}

function addTable(
  sheet: XLSX.WorkSheet,
  origin: string,
  headers: string[],
  rows: Array<Array<string | number | null>>
) {
  XLSX.utils.sheet_add_aoa(sheet, [headers, ...rows], { origin });
}

function applySummary(sheet: XLSX.WorkSheet, report: HealthStatementReport) {
  const labels = [
    ["A9", "All Payment From Messer"],
    ["L9", "Payment For Producer"],
    ["Z9", "Unclaim Payment"],
    ["AK9", "Duplicated Payment"],
    ["B8", "Total Payment"],
    ["C8", "Used"],
    ["D8", "Unclaimed"],
    ["E8", "Duplicate"],
    ["F8", "Final"],
  ] as const;

  labels.forEach(([cell, label]) => setCell(sheet, cell, label));
  setFormula(sheet, "B9", "=SUM(G11:G10000)");
  setFormula(sheet, "M9", "=SUM(T11:T10000)");
  setFormula(sheet, "AA9", "=SUM(AF11:AF10000)");
  setFormula(sheet, "AL9", "=SUM(AL11:AL10000)");
  setFormula(sheet, "C9", "=M9");
  setFormula(sheet, "D9", "=AA9");
  setFormula(sheet, "E9", "=AL9");
  setFormula(sheet, "F9", "=C9 + D9 - E9");

  // Cached values let file viewers show totals before formulas recalculate.
  sheet.B9.v = report.totals.totalPayment;
  sheet.C9.v = report.totals.used;
  sheet.D9.v = report.totals.unclaimed;
  sheet.E9.v = report.totals.duplicate;
  sheet.F9.v = report.totals.final;
}

export function buildHealthStatementWorkbook(report: HealthStatementReport) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([]);

  addTable(
    sheet,
    "A10",
    HEALTH_PAYMENT_HEADERS,
    report.allPayment.map(healthPaymentValues)
  );

  addTable(
    sheet,
    "L10",
    HEALTH_PRODUCER_HEADERS,
    report.paymentForProducer.map(healthProducerValues)
  );

  addTable(
    sheet,
    "Z10",
    HEALTH_PAYMENT_HEADERS,
    report.unclaimedPayment.map(healthPaymentValues)
  );

  addTable(
    sheet,
    "AK10",
    HEALTH_DUPLICATE_HEADERS,
    report.duplicatedPayment.map(healthDuplicateValues)
  );

  applySummary(sheet, report);
  sheet["!cols"] = Array.from({ length: 43 }, () => ({ wch: 18 }));

  XLSX.utils.book_append_sheet(workbook, sheet, SHEET_NAME);
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}
