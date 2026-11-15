import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { TableColumn } from "@/lib/table-config/types";
import {
  buildEnrollmentImportContext,
  buildEnrollmentTemplateSpec,
  matchEnrollmentHeaders,
  parseEnrollmentImportRows,
  recordsFromMatrix,
} from "./import";
import { templateFingerprint } from "@/lib/import-template/spec";
import { collectRowProblems, fillEnrollmentTemplate, labelsFromReason } from "./bot-template";

function column(key: string, label: string, type: TableColumn["type"] = "text", required = false): TableColumn {
  return {
    id: `col-${key}`, scope: "aca", key, label, type, width: 120, position: 10, pinned: false, show_in_detail: true,
    hidden_default: false, required, is_system: true, archived_at: null,
  } as unknown as TableColumn;
}

const COLUMNS = [
  column("client", "Client Name", "text", true),
  column("fub", "FUB Link", "link", true),
  column("agent", "Agent", "person", true),
  column("stage", "Stage", "dropdown"),
  column("carrier", "Carrier", "multiselect"),
  column("due", "Due Date", "date"),
  column("createdAt", "Created date", "date"),
];
const OPTIONS = [
  { id: "s1", set_key: "stage", label: "1-Need quote", archived_at: null },
  { id: "s2", set_key: "stage", label: "12-Terminated", archived_at: null },
  { id: "c1", set_key: "carrier", label: "Oscar HMO", archived_at: null },
];
const PEOPLE = [{ email: "bao@x.co", name: "Bao Vo" }];

/** File của người dùng: thứ tự cột khác, cột lạ, ngày số sê-ri, và 2 dòng lỗi. */
const SOURCE = [
  ["Agent", "Note", "Stage", "Client Name", "Due Date", "FUB Link", "Carrier"],
  ["Bao Vo", "ghi chú", "12-Terminated", "TEST A", 46356, "https://example.com/a", "Oscar HMO"],
  // Lỗi 2 ô (Stage, Carrier) và thiếu FUB Link: phải tô cả 3 ô, không chỉ ô đầu tiên.
  ["Bao Vo", null, "10 - DONE", "TEST BAD", null, null, "Oscar"],
  ["Bao Vo", null, "1-Need quote", "TEST B", null, "https://example.com/b", null],
];

async function fill(matrix: unknown[][]) {
  const sheet = recordsFromMatrix(matrix);
  const matched = matchEnrollmentHeaders(sheet.headers, COLUMNS, sheet.records);
  const context = buildEnrollmentImportContext(OPTIONS, PEOPLE, []);
  const parsed = parseEnrollmentImportRows(sheet.records, matched, COLUMNS, context, sheet.rowNumbers);
  const problems = collectRowProblems({
    records: sheet.records, rowNumbers: sheet.rowNumbers, skipped: parsed.skipped, failed: [], matched, columns: COLUMNS, context,
  });
  return fillEnrollmentTemplate({
    program: "aca", columns: COLUMNS, options: OPTIONS, columnOptions: [], people: PEOPLE, matched,
    records: sheet.records, rowNumbers: sheet.rowNumbers, problems,
  });
}

async function open(base64: string) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(base64, "base64") as never);
  return book;
}

const argb = (cell: ExcelJS.Cell) => (cell.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;

describe("labelsFromReason", () => {
  it("reads the column from each kind of import error", () => {
    expect(labelsFromReason('Carrier: unknown value "Oscar"')).toEqual(["Carrier"]);
    expect(labelsFromReason("FUB Link, Agent required.")).toEqual(["FUB Link", "Agent"]);
    expect(labelsFromReason("Missing Client Name")).toEqual(["Client Name"]);
  });
});

describe("fillEnrollmentTemplate", () => {
  it("returns the import template itself, data under the template's own columns, problem rows last", async () => {
    const result = await fill(SOURCE);
    if (!("file_base64" in result)) throw new Error("expected a file");
    const book = await open(result.file_base64);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["Data", "Lists", "_template"]);
    const spec = buildEnrollmentTemplateSpec("aca", COLUMNS, OPTIONS, [], PEOPLE);
    expect(book.getWorksheet("_template")!.getCell("B1").value).toBe(templateFingerprint(spec));
    const data = book.getWorksheet("Data")!;
    const values = (row: number) => (data.getRow(row).values as unknown[]).slice(1);
    // Đúng tiêu đề và thứ tự file mẫu; cột hệ thống (Created date) và cột lạ (Note) không có.
    expect(values(1)).toEqual(["Client Name", "FUB Link", "Agent", "Stage", "Carrier", "Due Date"]);
    expect(values(2)).toEqual(["TEST A", "https://example.com/a", "Bao Vo", "12-Terminated", "Oscar HMO", "2026-11-30"]);
    expect(values(3).slice(0, 4)).toEqual(["TEST B", "https://example.com/b", "Bao Vo", "1-Need quote"]);
    // Dòng lỗi không bị bỏ: nằm cuối, giữ giá trị gốc.
    expect(values(4).slice(0, 5)).toEqual(["TEST BAD", undefined, "Bao Vo", "10 - DONE", "Oscar"]);
    expect(result.problem_rows).toEqual([{ row: 4, reason: expect.stringContaining("Stage") }]);
  });

  it("paints the whole problem row light red and every cell to fix darker, with the reason as a note", async () => {
    const result = await fill(SOURCE);
    if (!("file_base64" in result)) throw new Error("expected a file");
    const data = (await open(result.file_base64)).getWorksheet("Data")!;
    const bad = data.getRow(4);
    // Client Name, Agent, Due Date: chỉ đỏ nhạt. FUB Link (thiếu), Stage, Carrier: đỏ đậm.
    expect([1, 3, 6].map((col) => argb(bad.getCell(col)))).toEqual(["FFFDE2E2", "FFFDE2E2", "FFFDE2E2"]);
    expect([2, 4, 5].map((col) => argb(bad.getCell(col)))).toEqual(["FFF4A3A3", "FFF4A3A3", "FFF4A3A3"]);
    expect(String(bad.getCell(2).note ?? bad.getCell(4).note)).toContain("Stage");
    expect(argb(data.getRow(2).getCell(4))).toBeUndefined();
  });

  it("reads back with every template column matched and nothing ignored", async () => {
    const result = await fill(SOURCE);
    if (!("file_base64" in result)) throw new Error("expected a file");
    const data = (await open(result.file_base64)).getWorksheet("Data")!;
    const matrix: unknown[][] = [];
    data.eachRow((row) => matrix.push((row.values as unknown[]).slice(1)));
    const sheet = recordsFromMatrix(matrix);
    expect(matchEnrollmentHeaders(sheet.headers, COLUMNS, sheet.records).ignored).toEqual([]);
    expect(sheet.records).toHaveLength(3);
  });

  it("does not convert a file that updates existing records", async () => {
    const result = await fill([["Record ID", "Client Name"], ["0b6f8a52-1c2d-4e5f-8a9b-0c1d2e3f4a5b", "TEST"]]);
    expect(result).toEqual({ unavailable: expect.stringContaining("Record ID") });
  });
});
