import * as XLSX from "xlsx";
import type {
  DuplicatePaymentRow,
  HealthStatementReport,
  ProducerPaymentRow,
} from "./report";
import type { PaymentSummaryRow } from "./types";

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

function paymentRows(rows: PaymentSummaryRow[]) {
  return rows.map((row) => [
    row.agent,
    row.carrier_name,
    row.customer_id,
    row.customer_name,
    row.effective_date,
    row.paid_to_date,
    row.gross_compensation,
    row.transaction_id,
    row.statement,
  ]);
}

function producerRows(rows: ProducerPaymentRow[]) {
  return rows.map((row) => [
    row.agent,
    row.deal_number,
    row.deal_name,
    row.carrier,
    row.state,
    row.plan_name,
    row.primary_member_id,
    row.broker_effective_date,
    row.carriers_messer_paid,
    row.paid_to_date,
    row.transaction_id,
    row.statement,
  ]);
}

function duplicateRows(rows: DuplicatePaymentRow[]) {
  return rows.map((row) => [
    row.transaction_id,
    row.carriers_messer_paid,
    row.duplicate_count,
  ]);
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
    [
      "Agent",
      "Carrier_Name",
      "Customer_ID",
      "Customer_Name",
      "Effective_Date",
      "Paid_To_Date",
      "Carriers_Messer_Paid",
      "Transaction_ID",
      "Statement",
    ],
    paymentRows(report.allPayment)
  );

  addTable(
    sheet,
    "L10",
    [
      "Agent",
      "Num_Client",
      "Deal_Name",
      "Carrier",
      "State",
      "Plan_Name",
      "Primary_Member_ID",
      "Broker_Effective_Date",
      "Carriers_Messer_Paid",
      "Paid_To_Date",
      "Transaction_ID",
      "Statement",
    ],
    producerRows(report.paymentForProducer)
  );

  addTable(
    sheet,
    "Z10",
    [
      "Agent",
      "Carrier_Name",
      "Customer_ID",
      "Customer_Name",
      "Effective_Date",
      "Paid_To_Date",
      "Carriers_Messer_Paid",
      "Transaction_ID",
      "Statement",
    ],
    paymentRows(report.unclaimedPayment)
  );

  addTable(
    sheet,
    "AK10",
    ["Transaction_ID", "Carriers_Messer_Paid", "Duplicate_Count"],
    duplicateRows(report.duplicatedPayment)
  );

  applySummary(sheet, report);
  sheet["!cols"] = Array.from({ length: 43 }, () => ({ wch: 18 }));

  XLSX.utils.book_append_sheet(workbook, sheet, SHEET_NAME);
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}
