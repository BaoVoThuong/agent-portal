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

const FORMULA_LAST_ROW = 10000;

function addTable(
  sheet: XLSX.WorkSheet,
  origin: string,
  headers: string[],
  rows: Array<Array<string | number | null>>
) {
  XLSX.utils.sheet_add_aoa(sheet, [headers, ...rows], { origin });
}

// !ref chỉ tự cập nhật theo sheet_add_aoa, không theo cell gán trực tiếp.
// Mở rộng !ref để bao mọi ô đã ghi (nếu không, formula ngoài ref bị bỏ khi xuất xlsx).
function expandRef(sheet: XLSX.WorkSheet, lastColumn: number, lastRow: number) {
  const current = sheet["!ref"]
    ? XLSX.utils.decode_range(sheet["!ref"])
    : { s: { c: 0, r: 0 }, e: { c: 0, r: 0 } };
  sheet["!ref"] = XLSX.utils.encode_range({
    s: { c: 0, r: 0 },
    e: {
      c: Math.max(current.e.c, lastColumn),
      r: Math.max(current.e.r, lastRow),
    },
  });
}

// Sheet đơn: dòng 1 = title + Total, dòng 3 = headers, data từ dòng 4.
function buildBlockSheet(
  title: string,
  headers: string[],
  rows: Array<Array<string | number | null>>,
  totalColumn: string,
  total: number
) {
  const sheet = XLSX.utils.aoa_to_sheet([]);

  setCell(sheet, "A1", title);
  setCell(sheet, "C1", "Total");
  sheet["D1"] = {
    t: "n",
    f: `SUM(${totalColumn}4:${totalColumn}${FORMULA_LAST_ROW})`,
    v: total,
  };

  addTable(sheet, "A3", headers, rows);
  expandRef(sheet, Math.max(3, headers.length - 1), rows.length + 3);
  sheet["!cols"] = Array.from({ length: headers.length }, () => ({ wch: 18 }));

  return sheet;
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

  // Sheet 1: Summary (mọi khối cạnh nhau).
  const summarySheet = XLSX.utils.aoa_to_sheet([]);

  addTable(
    summarySheet,
    "A10",
    HEALTH_PAYMENT_HEADERS,
    report.allPayment.map(healthPaymentValues)
  );
  addTable(
    summarySheet,
    "L10",
    HEALTH_PRODUCER_HEADERS,
    report.paymentForProducer.map(healthProducerValues)
  );
  addTable(
    summarySheet,
    "Z10",
    HEALTH_PAYMENT_HEADERS,
    report.unclaimedPayment.map(healthPaymentValues)
  );
  addTable(
    summarySheet,
    "AK10",
    HEALTH_DUPLICATE_HEADERS,
    report.duplicatedPayment.map(healthDuplicateValues)
  );

  applySummary(summarySheet, report);
  const maxBlockRows = Math.max(
    report.allPayment.length,
    report.paymentForProducer.length,
    report.unclaimedPayment.length,
    report.duplicatedPayment.length
  );
  expandRef(summarySheet, 42, 10 + maxBlockRows);
  summarySheet["!cols"] = Array.from({ length: 43 }, () => ({ wch: 18 }));

  XLSX.utils.book_append_sheet(workbook, summarySheet, SHEET_NAME);

  // Carriers_Messer_Paid trong sheet con (bắt đầu cột A):
  //  - Producer headers: index 8 → cột I
  //  - Payment headers (Unclaim): index 6 → cột G
  //  - Duplicate headers: index 1 → cột B
  XLSX.utils.book_append_sheet(
    workbook,
    buildBlockSheet(
      "Payment For Producer",
      HEALTH_PRODUCER_HEADERS,
      report.paymentForProducer.map(healthProducerValues),
      "I",
      report.totals.used
    ),
    "Payment For Producer"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    buildBlockSheet(
      "Unclaim Payment",
      HEALTH_PAYMENT_HEADERS,
      report.unclaimedPayment.map(healthPaymentValues),
      "G",
      report.totals.unclaimed
    ),
    "Unclaim Payment"
  );

  // Sheet Duplicate chỉ tạo nếu có dòng.
  if (report.duplicatedPayment.length > 0) {
    XLSX.utils.book_append_sheet(
      workbook,
      buildBlockSheet(
        "Duplicated Payment",
        HEALTH_DUPLICATE_HEADERS,
        report.duplicatedPayment.map(healthDuplicateValues),
        "B",
        report.totals.duplicate
      ),
      "Duplicated Payment"
    );
  }

  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}
