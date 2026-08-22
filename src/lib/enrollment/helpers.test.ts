import { describe, expect, it } from "vitest";
import { enrollmentDisplayKey, enrollmentKey } from "./helpers";

describe("enrollment display keys", () => {
  it("uses the ACA prefix for ACA records", () => {
    expect(enrollmentDisplayKey(12, "aca")).toBe("ACA-12");
  });

  it("uses the MED prefix for Medicare records", () => {
    expect(enrollmentDisplayKey(12, "medicare")).toBe("MED-12");
  });

  it("keeps the program prefix when the number is unavailable", () => {
    expect(enrollmentDisplayKey(null, "aca")).toBe("ACA-—");
    expect(enrollmentDisplayKey(undefined, "medicare")).toBe("MED-—");
  });

  it("includes the program prefix in legacy id-derived keys", () => {
    expect(enrollmentKey("record-1", "aca")).toMatch(/^ACA-\d+$/);
    expect(enrollmentKey("record-1", "medicare")).toMatch(/^MED-\d+$/);
  });
});
