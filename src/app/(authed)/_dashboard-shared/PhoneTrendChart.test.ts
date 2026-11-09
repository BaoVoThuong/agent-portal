import { describe, expect, it } from "vitest";
import { shortPeriodLabel } from "./PhoneTrendChart";

describe("shortPeriodLabel", () => {
  it("shortens every period format the dashboards use", () => {
    expect(shortPeriodLabel("2026-03")).toBe("03/26");
    expect(shortPeriodLabel("2026-Q1")).toBe("Q1/26");
    expect(shortPeriodLabel("2026 Q4")).toBe("Q4/26");
    expect(shortPeriodLabel("Q2, 2025")).toBe("Q2/25");
    expect(shortPeriodLabel("2026")).toBe("2026");
  });

  it("leaves anything else as it is", () => {
    expect(shortPeriodLabel("Total")).toBe("Total");
  });
});
