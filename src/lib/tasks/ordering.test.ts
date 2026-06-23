import { describe, expect, it } from "vitest";
import { midpoint } from "@/lib/tasks/ordering";

describe("midpoint", () => {
  it("empty column -> 1", () => {
    expect(midpoint(null, null)).toBe(1);
  });
  it("drop at top (above first) -> below.value - 1", () => {
    expect(midpoint(null, 10)).toBe(9);
  });
  it("drop at bottom (after last) -> above.value + 1", () => {
    expect(midpoint(10, null)).toBe(11);
  });
  it("drop between two -> average", () => {
    expect(midpoint(10, 20)).toBe(15);
  });
});
