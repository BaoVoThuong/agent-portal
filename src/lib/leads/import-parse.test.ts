import { describe, expect, it } from "vitest";
import { normalizePhone } from "./import-parse";

describe("normalizePhone", () => {
  it("reduces the many ways people write a US number to one", () => {
    expect(normalizePhone("(714) 555-0123")).toBe("7145550123");
    expect(normalizePhone("714.555.0123")).toBe("7145550123");
    expect(normalizePhone("+1 714 555 0123")).toBe("7145550123");
    expect(normalizePhone("1-714-555-0123")).toBe("7145550123");
  });

  it("returns null for anything that cannot be a number", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("N/A")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
  });

  it("keeps a number Excel turned into a float", () => {
    expect(normalizePhone(7145550123)).toBe("7145550123");
  });
});
