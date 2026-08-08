import { describe, expect, it } from "vitest";
import { parseEnrollmentProgram, toEnrollmentProgram } from "@/lib/enrollment/types";

describe("enrollment program parsing", () => {
  it("accepts only supported programs at API boundaries", () => {
    expect(parseEnrollmentProgram("aca")).toBe("aca");
    expect(parseEnrollmentProgram("medicare")).toBe("medicare");
  });

  it("rejects missing, invalid, and mistyped values", () => {
    expect(parseEnrollmentProgram(null)).toBeNull();
    expect(parseEnrollmentProgram(undefined)).toBeNull();
    expect(parseEnrollmentProgram("")).toBeNull();
    expect(parseEnrollmentProgram("cs")).toBeNull();
    expect(parseEnrollmentProgram({ program: "aca" })).toBeNull();
  });

  it("keeps the explicit ACA default for page navigation only", () => {
    expect(toEnrollmentProgram(null)).toBe("aca");
    expect(toEnrollmentProgram("medicare")).toBe("medicare");
  });
});
