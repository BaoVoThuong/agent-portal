import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  inspectPcPaymentWorkbook,
  parsePcPaymentWorkbook,
  PcColumnMappingError,
} from "./payment-parser";
import type { PcColumnMapping } from "./column-mapping";

// Same layout as the TWFG "Producer Commission Register" export (checked
// against the 2026-10 file): a two-row header with merged cells, the producer
// line carrying "(TWFG)", address lines in column A, the carrier name alone in
// column C above its payments, totals and a footer. No customer data.

type Cell = string | number | null;
const WIDTH = 24;
const col = (letter: string) => letter.charCodeAt(0) - 65;

function line(cells: Record<string, Cell>): Cell[] {
  const row: Cell[] = Array(WIDTH).fill(null);
  for (const [letter, value] of Object.entries(cells)) row[col(letter)] = value;
  return row;
}

function payment(insured: string, policy: string, premium: number, rate: number): Cell[] {
  return line({
    A: insured,
    D: policy,
    F: 46625, // 2027-08-26
    H: 46283,
    J: "NBS",
    K: premium,
    N: rate,
    Q: Math.round(premium * rate * 100) / 100,
    S: 0.8,
    T: Math.round(premium * 0.8 * 100) / 100,
    V: 0,
    X: Math.round(premium * rate * 0.8 * 100) / 100,
  });
}

function buildWorkbook({
  headerTop = {
    A: "Company",
    K: "Commissionable Premium",
    N: "Carrier Rate (%)",
    P: "Ag Comm",
    S: "Prod Split\r\n(%)",
    T: "Pro-Rated Premium",
    V: "Fixed $",
  } as Record<string, Cell>,
  producer = "Pham, Vuong (TWFG) (BR930)",
  companyColumn = "C",
  rates = [0.15, 0.13] as [number, number],
} = {}) {
  const rows: Cell[][] = [
    line({ A: "Producer Commission Register" }),
    line({ A: "10/17/2026", U: "Page 1" }),
    line({ A: "12:40:21 PM" }),
    line({ A: "Vuong Pham" }),
    line({ A: "Closed 2026-09-28 16:00:49 IS 09/30/26" }),
    line({}),
    line({ A: "Producer" }),
    line(headerTop),
    line({ A: "Insured", D: "Policy No", F: "Policy Exp", H: "Inv Date", J: "Tran", X: "Prod Comm" }),
    line({ A: producer }),
    line({ A: "10300 Westoffice Drive" }),
    line({ A: "Houston, TX 77042" }),
    line({ [companyColumn]: "American Risk Insurance" }),
    payment("Client One", "HB100", 626, rates[0]),
    payment("Client Two", "HB200", 1696, rates[0]),
    line({ A: "Total American Risk Insurance", K: 2322 }),
    line({ [companyColumn]: "SageSure" }),
    payment("Client Three", "SS300", -261, rates[1]),
    line({ K: "** 2,061.00" }),
    line({ A: "Grand Total", O: "** 300.00", T: "* 1,648.80" }),
    line({ A: "Please direct all correspondence to:" }),
    line({ A: "10055 Grogans Mill Rd" }),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  // "Ag Comm" sits in P but is merged over Q, where its numbers are.
  sheet["!merges"] = [{ s: { r: 7, c: col("P") }, e: { r: 7, c: col("Q") } }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "ProducerCommissionReport");
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}

describe("inspectPcPaymentWorkbook", () => {
  it("lists the file's data columns with their header text and samples", () => {
    const inspection = inspectPcPaymentWorkbook(buildWorkbook());
    expect(inspection.headerRow).toBe(9);
    expect(inspection.columns.map((column) => column.letter)).toEqual([
      "A", "D", "F", "H", "J", "K", "N", "Q", "S", "T", "V", "X",
    ]);
    const byLetter = Object.fromEntries(inspection.columns.map((column) => [column.letter, column]));
    expect(byLetter.A.label).toBe("Insured");
    expect(byLetter.Q.label).toBe("Ag Comm");
    expect(byLetter.S.label).toBe("Prod Split (%)");
    expect(byLetter.F.samples[0]).toBe("2027-08-26");
    expect(byLetter.K.samples).toEqual(["626", "1696", "-261"]);
  });

  it("previews the first data rows, one cell per listed column", () => {
    const inspection = inspectPcPaymentWorkbook(buildWorkbook());
    expect(inspection.preview.length).toBeGreaterThan(0);
    for (const row of inspection.preview) expect(row).toHaveLength(inspection.columns.length);
    const premium = inspection.columns.findIndex((column) => column.letter === "K");
    expect(inspection.preview.map((row) => row[premium]).filter(Boolean).slice(0, 3)).toEqual([
      "626", "1696", "-261",
    ]);
  });

  it("pre-fills the five inputs from the header text", () => {
    expect(inspectPcPaymentWorkbook(buildWorkbook()).suggested).toEqual({
      insured: "A",
      policyNo: "D",
      policyExp: "F",
      premium: "K",
      carrierRate: "N",
    });
  });

  it("leaves a renamed input empty for the user to map", () => {
    const inspection = inspectPcPaymentWorkbook(
      buildWorkbook({ headerTop: { A: "Company", K: "Comm. Prem", N: "Carrier Rate (%)", P: "Ag Comm" } }),
    );
    expect(inspection.suggested.premium).toBeUndefined();
    expect(inspection.columns.find((column) => column.letter === "K")?.label).toBe("Comm. Prem");
  });
});

describe("parsePcPaymentWorkbook", () => {
  it("cleans the payments without the columns it never used (the Ag Comm rename)", () => {
    const result = parsePcPaymentWorkbook(buildWorkbook());
    expect(result.rows).toEqual([
      { insured: "Client One", policyNo: "HB100", policyExp: "2027-08-26", commissionablePremium: 626, carrierRate: 0.15, company: "American Risk Insurance", agency: "TWFG" },
      { insured: "Client Two", policyNo: "HB200", policyExp: "2027-08-26", commissionablePremium: 1696, carrierRate: 0.15, company: "American Risk Insurance", agency: "TWFG" },
      { insured: "Client Three", policyNo: "SS300", policyExp: "2027-08-26", commissionablePremium: -261, carrierRate: 0.13, company: "SageSure", agency: "TWFG" },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("asks for a mapping when the header does not name an input, and uses the user's", () => {
    const file = buildWorkbook({ headerTop: { A: "Company", K: "Comm. Prem", N: "Carrier Rate (%)" } });
    expect(() => parsePcPaymentWorkbook(file)).toThrow(PcColumnMappingError);
    try {
      parsePcPaymentWorkbook(file);
    } catch (error) {
      expect((error as PcColumnMappingError).missing).toEqual(["premium"]);
    }

    const mapping: PcColumnMapping = { insured: "A", policyNo: "D", policyExp: "F", premium: "K", carrierRate: "N" };
    const result = parsePcPaymentWorkbook(file, mapping);
    expect(result.rows.map((row) => row.commissionablePremium)).toEqual([626, 1696, -261]);
  });

  it("reads exactly the columns the user dragged in", () => {
    // Map the premium input onto Pro-Rated Premium (T) to prove the mapping wins.
    const mapping: PcColumnMapping = { insured: "A", policyNo: "D", policyExp: "F", premium: "T", carrierRate: "N" };
    const result = parsePcPaymentWorkbook(buildWorkbook(), mapping);
    expect(result.rows.map((row) => row.commissionablePremium)).toEqual([500.8, 1356.8, -208.8]);
  });

  it("finds the carrier names when they move out of column C", () => {
    const result = parsePcPaymentWorkbook(buildWorkbook({ companyColumn: "B" }));
    expect(result.rows.map((row) => row.company)).toEqual([
      "American Risk Insurance",
      "American Risk Insurance",
      "SageSure",
    ]);
  });

  it("warns when the rate reads like a whole percent", () => {
    const result = parsePcPaymentWorkbook(buildWorkbook({ rates: [15, 13] }));
    expect(result.warnings).toEqual([
      expect.stringContaining("Carrier Rate is above 100% on 3 row(s)"),
    ]);
  });

  it("warns when no producer line says TWFG or DP", () => {
    const result = parsePcPaymentWorkbook(buildWorkbook({ producer: "Pham, Vuong (BR930)" }));
    expect(result.rows.every((row) => row.agency === null)).toBe(true);
    expect(result.warnings).toEqual([expect.stringContaining("(TWFG) or (DP)")]);
  });
});
