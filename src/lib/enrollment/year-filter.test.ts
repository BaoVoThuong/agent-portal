import { describe, expect, it } from "vitest";
import { resolveEnrollmentYearFilterValue } from "./year-filter";

describe("resolveEnrollmentYearFilterValue", () => {
  it("uses the visible dropdown label rather than its stored option UUID", () => {
    expect(
      resolveEnrollmentYearFilterValue(
        "09c4cba2-759a-492c-8fdc-d11afc76eb16",
        "dropdown",
        new Map([["09c4cba2-759a-492c-8fdc-d11afc76eb16", "2026"]])
      )
    ).toBe("2026");
  });

  it("keeps legacy text and numeric year values filterable", () => {
    expect(resolveEnrollmentYearFilterValue("2027.0", "text")).toBe("2027");
    expect(resolveEnrollmentYearFilterValue(2026, "number")).toBe("2026");
  });

  it("does not turn an empty value into a filter option", () => {
    expect(resolveEnrollmentYearFilterValue(null, "dropdown")).toBeNull();
  });
});
