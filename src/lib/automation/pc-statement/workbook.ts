import * as XLSX from "xlsx";
import type {
  PcStatementReport,
} from "./report";
import {
  CLEAN_PAYMENT_HEADERS,
  STATEMENT_HEADERS,
  UNCLAIM_FEE_HEADERS,
  cleanPaymentValues,
  statementValues,
  unclaimFeeValues,
} from "./table-data";

const SHEET_NAME = "P&C_Statement_Result";
// Excel/OOXML không hỗ trợ open-ended range (D11:D) như Google Sheets.
const FORMULA_LAST_ROW = 100000;

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

// !ref chỉ tự cập nhật theo sheet_add_aoa, không theo cell gán trực tiếp.
// Mở rộng !ref để bao mọi ô đã ghi (nếu không, formula ngoài ref bị bỏ khi xuất xlsx).
function expandRef(sheet: XLSX.WorkSheet, lastColumn: number, lastRow: number) {
  const current = sheet["!ref"]
    ? XLSX.utils.decode_range(sheet["!ref"])
    : { s: { c: 0, r: 0 }, e: { c: 0, r: 0 } };
  const range = {
    s: { c: 0, r: 0 },
    e: {
      c: Math.max(current.e.c, lastColumn),
      r: Math.max(current.e.r, lastRow),
    },
  };
  sheet["!ref"] = XLSX.utils.encode_range(range);
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
  const R = FORMULA_LAST_ROW;
  setCell(sheet, "A8", "Payment Clean");
  setCell(sheet, "A9", "Total Premium");
  setFormula(sheet, "B9", `=SUM(D11:D${R})`, report.totals.totalPayment);
  setCell(sheet, "C8", "Base Policy");
  setFormula(sheet, "C9", `=SUM(R10:R${R})`, report.totals.basePolicy);
  setCell(sheet, "D8", "Additional Policy");
  setFormula(sheet, "D9", `=SUM(AN10:AN${R})`, report.totals.additional);
  setCell(sheet, "E8", "Unclaim Payment");
  setFormula(sheet, "E9", `=SUM(BH10:BH${R})`, report.totals.unclaimed);
  setCell(sheet, "F8", "Fee");
  setFormula(sheet, "F9", `=SUM(CB10:CB${R})`, report.totals.fee);
  setCell(sheet, "G8", "Sum Check");
  setFormula(sheet, "G9", "=C9+D9+E9+F9=B9", report.totals.balanced);

  setSection(
    sheet,
    "H8",
    "Policy In Month Report",
    "H9",
    "I9",
    `=SUM(R10:R${R})`,
    report.totals.basePolicy
  );
  setSection(
    sheet,
    "AD8",
    "Additional Policy",
    "AD9",
    "AE9",
    `=SUM(AN10:AN${R})`,
    report.totals.additional
  );
  setSection(
    sheet,
    "AX8",
    "Unclaim Payment",
    "AX9",
    "AY9",
    `=SUM(BH10:BH${R})`,
    report.totals.unclaimed
  );
  setSection(
    sheet,
    "BR8",
    "Fee",
    "BR9",
    "BS9",
    `=SUM(CB10:CB${R})`,
    report.totals.fee
  );
}

// Sheet đơn: 1 bảng, dòng 1 = title + Total Premium, dòng 3 = headers, data từ dòng 4.
function buildBlockSheet(
  title: string,
  headers: string[],
  rows: Array<Array<string | number | null>>,
  truePremiumColumn: string,
  total: number
) {
  const sheet = XLSX.utils.aoa_to_sheet([]);

  setCell(sheet, "A1", title);
  setCell(sheet, "C1", "Total Premium");
  setFormula(
    sheet,
    "D1",
    `=SUM(${truePremiumColumn}4:${truePremiumColumn}${FORMULA_LAST_ROW})`,
    total
  );

  addTable(sheet, "A3", headers, rows);
  // Bao ô D1 (Total Premium) + toàn bảng.
  expandRef(sheet, Math.max(3, headers.length - 1), rows.length + 3);
  sheet["!cols"] = Array.from({ length: headers.length }, () => ({ wch: 18 }));

  return sheet;
}

export function buildPcStatementWorkbook(report: PcStatementReport) {
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Summary all (mọi khối cạnh nhau).
  const summarySheet = XLSX.utils.aoa_to_sheet([]);

  addTable(
    summarySheet,
    "A10",
    CLEAN_PAYMENT_HEADERS,
    report.cleanPayment.map(cleanPaymentValues)
  );
  addTable(
    summarySheet,
    "H10",
    STATEMENT_HEADERS,
    report.policyInMonth.map(statementValues)
  );
  addTable(
    summarySheet,
    "AD10",
    STATEMENT_HEADERS,
    report.additionalPolicy.map(statementValues)
  );
  addTable(
    summarySheet,
    "AX10",
    UNCLAIM_FEE_HEADERS,
    report.unclaimedPayment.map(unclaimFeeValues)
  );
  addTable(
    summarySheet,
    "BR10",
    UNCLAIM_FEE_HEADERS,
    report.feePayment.map(unclaimFeeValues)
  );

  applySummary(summarySheet, report);
  // Bao hết 90 cột (0-89) + mọi dòng data của khối dài nhất.
  const maxBlockRows = Math.max(
    report.cleanPayment.length,
    report.policyInMonth.length,
    report.additionalPolicy.length,
    report.unclaimedPayment.length,
    report.feePayment.length
  );
  expandRef(summarySheet, 89, 10 + maxBlockRows);
  summarySheet["!cols"] = Array.from({ length: 90 }, () => ({ wch: 18 }));

  XLSX.utils.book_append_sheet(workbook, summarySheet, SHEET_NAME);

  // true_premium là cột thứ 11 (index 10) trong STATEMENT_HEADERS / UNCLAIM_FEE_HEADERS.
  // Sheet con bắt đầu ở cột A → true_premium ở cột K.
  XLSX.utils.book_append_sheet(
    workbook,
    buildBlockSheet(
      "Base Policy",
      STATEMENT_HEADERS,
      report.policyInMonth.map(statementValues),
      "K",
      report.totals.basePolicy
    ),
    "Base Policy"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    buildBlockSheet(
      "Additional Policy",
      STATEMENT_HEADERS,
      report.additionalPolicy.map(statementValues),
      "K",
      report.totals.additional
    ),
    "Additional Policy"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    buildBlockSheet(
      "Unclaim Payment",
      UNCLAIM_FEE_HEADERS,
      report.unclaimedPayment.map(unclaimFeeValues),
      "K",
      report.totals.unclaimed
    ),
    "Unclaim Payment"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    buildBlockSheet(
      "Fee",
      UNCLAIM_FEE_HEADERS,
      report.feePayment.map(unclaimFeeValues),
      "K",
      report.totals.fee
    ),
    "Fee"
  );

  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}
