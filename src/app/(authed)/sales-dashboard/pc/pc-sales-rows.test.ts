import { describe, expect, it } from "vitest";
import { selectPcExpiredRows, selectPcRowsInRange } from "./pc-sales-rows";

const effective = (...dates: (string | null)[]) =>
  dates.map((effective_date) => ({ effective_date }));

describe("selectPcRowsInRange", () => {
  const rows = effective("2026-12-01", "2026-11-30", "2026-06-15", "2025-01-01", null);

  it("keeps whole months of the requested range", () => {
    expect(
      selectPcRowsInRange(rows, { start: "2026-06-01", end: "2026-06-01" }, "2026-11")
    ).toEqual(effective("2026-06-15"));
  });

  it("drops future months and rows with no date when the range is open", () => {
    expect(
      selectPcRowsInRange(rows, { start: null, end: null }, "2026-11")
    ).toEqual(effective("2026-11-30", "2026-06-15", "2025-01-01"));
  });

  it("caps a range that runs past the current month", () => {
    expect(
      selectPcRowsInRange(rows, { start: "2026-11-01", end: "2027-03-01" }, "2026-11")
    ).toEqual(effective("2026-11-30"));
  });
});

describe("selectPcExpiredRows", () => {
  it("keeps both window edges, including rows that start in the future", () => {
    const rows = [
      { effective_date: "2027-01-01", expired_date: "2027-07-31" },
      { effective_date: "2025-08-01", expired_date: "2026-08-01" },
      { effective_date: "2025-07-31", expired_date: "2026-07-31" },
      { effective_date: "2026-01-01", expired_date: null },
    ];

    expect(
      selectPcExpiredRows(rows, { startDate: "2026-08-01", endDate: "2027-07-31" })
    ).toEqual(rows.slice(0, 2));
  });
});
