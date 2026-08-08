import { describe, expect, it } from "vitest";
import { parseEnrollmentDate } from "@/lib/enrollment/dates";

describe("parseEnrollmentDate", () => {
  it("accepts a real ISO calendar date", () => {
    expect(parseEnrollmentDate("2026-02-28")).toEqual({ value: "2026-02-28" });
  });

  it("treats empty values as clearing the date", () => {
    expect(parseEnrollmentDate(null)).toEqual({ value: null });
    expect(parseEnrollmentDate("  ")).toEqual({ value: null });
  });

  it("rejects malformed and impossible dates consistently", () => {
    expect(parseEnrollmentDate("2026-2-8").error).toBe("Invalid due date.");
    expect(parseEnrollmentDate("2026-02-30").error).toBe("Invalid due date.");
    expect(parseEnrollmentDate("2026-01-01T00:00:00Z").error).toBe(
      "Invalid due date."
    );
  });
});
