import { describe, expect, it } from "vitest";
import { countLeaveBusinessDays } from "./business-days";
import { getUsFederalHolidays } from "./us-holidays";

describe("US federal time off calendar", () => {
  it("uses the observed weekday for a weekend Independence Day", () => {
    const holidays = getUsFederalHolidays(2026);
    expect(holidays).toContainEqual(expect.objectContaining({
      date: "2026-07-03",
      name: "Independence Day",
    }));
    expect(holidays.find((holiday) => holiday.date === "2026-07-04")).toBeUndefined();
  });

  it("includes observed New Year's Day from the following calendar year", () => {
    const holidays = getUsFederalHolidays(2021);
    expect(holidays).toContainEqual(expect.objectContaining({
      date: "2021-12-31",
      name: "New Year's Day",
    }));
  });

  it("does not charge weekends, federal holidays, or company days off", () => {
    const holidays = new Set(["2026-07-03", "2026-07-06"]);
    expect(countLeaveBusinessDays("2026-07-02", "2026-07-07", holidays)).toBe(2);
  });
});
