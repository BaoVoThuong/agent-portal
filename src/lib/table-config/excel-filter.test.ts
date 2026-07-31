import { describe, expect, it } from "vitest";
import {
  applyExcelFilters,
  compareByType,
  distinctColumnValues,
  sortByColumn,
} from "./excel-filter";

type Row = { id: string; values: Record<string, unknown> };
const accessor = (row: Row, key: string) => row.values[key];

const rows: Row[] = [
  { id: "1", values: { stage: "Open", age: 10, due: "2026-07-31" } },
  { id: "2", values: { stage: "Done", age: 2, due: "2026-07-01" } },
  { id: "3", values: { stage: "", age: null, due: null } },
];

describe("distinctColumnValues", () => {
  it("collects distinct values with a blank bucket", () => {
    expect(
      distinctColumnValues(rows, "stage", accessor, (value) => String(value)).map(
        (item) => item.label
      )
    ).toEqual(["(Blank)", "Done", "Open"]);
  });
});

describe("applyExcelFilters", () => {
  it("ANDs column filters", () => {
    const filters = new Map([["stage", new Set(["Open"])]]);
    expect(applyExcelFilters(rows, filters, accessor).map((row) => row.id)).toEqual(["1"]);
  });
});

describe("compareByType", () => {
  it("compares number/date and places blanks last", () => {
    expect(compareByType("number", 2, 10)).toBeLessThan(0);
    expect(compareByType("date", "2026-07-01", "2026-07-31")).toBeLessThan(0);
    expect(compareByType("text", null, "a")).toBeGreaterThan(0);
  });
});

describe("sortByColumn", () => {
  it("sorts by typed values", () => {
    expect(sortByColumn(rows, "age", "number", "asc", accessor).map((row) => row.id))
      .toEqual(["2", "1", "3"]);
  });
});
