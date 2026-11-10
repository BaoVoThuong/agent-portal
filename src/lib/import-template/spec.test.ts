import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { buildImportTemplateWorkbook } from "./download";
import {
  columnLetter,
  personChoiceLabels,
  readTemplateMarker,
  templateFingerprint,
  templateFreshness,
  type ImportTemplateSpec,
} from "./spec";

const SPEC: ImportTemplateSpec = {
  kind: "enrollment:aca",
  rows: 10,
  columns: [
    { header: "Client", example: "Nguyen Van A" },
    {
      header: "Stage",
      example: "1-Need quote",
      dropdown: { values: ["1-Need quote", "2-Quoted"], allowOther: false },
    },
    {
      header: "Agent",
      example: "Ann Strambler",
      dropdown: { values: ["Ann Strambler"], allowOther: false, tracked: false },
    },
    {
      header: "Carrier",
      example: "Ambetter",
      dropdown: { values: ["Ambetter", "Oscar"], allowOther: true },
    },
  ],
};

describe("columnLetter", () => {
  it("đếm như tên cột Excel", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual([
      "A",
      "Z",
      "AA",
      "AB",
      "ZZ",
      "AAA",
    ]);
  });
});

describe("personChoiceLabels", () => {
  const same = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

  it("dùng tên, tên trùng hoặc trống thì dùng email", () => {
    expect(
      personChoiceLabels(
        [
          { email: "Ann@x.com", name: "Ann Strambler" },
          { email: "phi1@x.com", name: "Phi Nguyen" },
          { email: "phi2@x.com", name: "phi  nguyen" },
          { email: "noname@x.com", name: null },
          { email: "ann@x.com", name: "Ann Strambler" },
        ],
        same,
      ),
    ).toEqual(["Ann Strambler", "noname@x.com", "phi1@x.com", "phi2@x.com"]);
  });
});

describe("templateFreshness", () => {
  it("đổi giá trị dropdown thì file cũ thành outdated", () => {
    const marker = { kind: SPEC.kind, fingerprint: templateFingerprint(SPEC) };
    expect(templateFreshness(marker, SPEC)).toEqual({ status: "current" });
    const renamed: ImportTemplateSpec = {
      ...SPEC,
      columns: SPEC.columns.map((column) =>
        column.header === "Stage"
          ? { ...column, dropdown: { values: ["1-Need Quote"], allowOther: false } }
          : column,
      ),
    };
    expect(templateFreshness(marker, renamed)).toEqual({ status: "outdated" });
  });

  it("thêm người mới không làm file cũ thành outdated", () => {
    const marker = { kind: SPEC.kind, fingerprint: templateFingerprint(SPEC) };
    const morePeople: ImportTemplateSpec = {
      ...SPEC,
      columns: SPEC.columns.map((column) =>
        column.header === "Agent"
          ? {
              ...column,
              dropdown: { values: ["Ann Strambler", "Thao Huynh"], allowOther: false, tracked: false },
            }
          : column,
      ),
    };
    expect(templateFreshness(marker, morePeople)).toEqual({ status: "current" });
  });

  it("file không có dấu thì không so; file của bảng khác thì báo", () => {
    expect(templateFreshness(null, SPEC)).toEqual({ status: "unknown" });
    expect(templateFreshness({ kind: "provider", fingerprint: "x" }, SPEC)).toEqual({
      status: "other",
      kind: "provider",
    });
  });
});

describe("buildImportTemplateWorkbook", () => {
  it("ghi Data trước, dropdown trỏ vào sheet Lists ẩn, và dấu phiên bản đọc lại được", async () => {
    const buffer = await buildImportTemplateWorkbook(SPEC);

    const book = XLSX.read(buffer, { type: "array" });
    expect(book.SheetNames[0]).toBe("Data");
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Data, { header: 1 });
    expect(rows[0]).toEqual(["Client", "Stage", "Agent", "Carrier"]);
    expect(rows[1]).toEqual(["Nguyen Van A", "1-Need quote", "Ann Strambler", "Ambetter"]);
    expect(readTemplateMarker(book)).toEqual({
      kind: "enrollment:aca",
      fingerprint: templateFingerprint(SPEC),
    });

    const zip = await JSZip.loadAsync(buffer);
    const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheetXml).toContain('sqref="B2:B11"');
    expect(sheetXml).toContain("Lists!$A$1:$A$2");
    expect(sheetXml).toContain('sqref="C2:C11"');
    expect(sheetXml).toContain("Lists!$B$1:$B$1");
    expect(sheetXml).toContain('sqref="D2:D11"');
    expect(sheetXml).toMatch(/errorStyle="warning"[^>]*sqref="D2:D11"|sqref="D2:D11"[^>]*errorStyle="warning"/);
    // Cột không có dropdown thì không có validation.
    expect(sheetXml).not.toContain('sqref="A2:A11"');

    const workbookXml = await zip.file("xl/workbook.xml")!.async("string");
    expect(workbookXml).toMatch(/name="Lists"[^>]*state="veryHidden"|state="veryHidden"[^>]*name="Lists"/);
  });
});
