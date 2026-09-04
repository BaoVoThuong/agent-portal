import { describe, expect, it } from "vitest";
import { escapeLikePattern, normalizeEventName } from "./events";

describe("normalizeEventName", () => {
  it("collapses internal whitespace and trims", () => {
    expect(normalizeEventName("  Health   Fair \t2026 ")).toBe("Health Fair 2026");
    expect(normalizeEventName("Health  Fair")).toBe("Health Fair");
  });
  it("leaves an already-clean name untouched", () => {
    expect(normalizeEventName("Auto Expo")).toBe("Auto Expo");
  });
  it("returns empty for whitespace-only input", () => {
    expect(normalizeEventName("   \t ")).toBe("");
  });
});

describe("escapeLikePattern", () => {
  it("escapes LIKE metacharacters", () => {
    expect(escapeLikePattern("50% Off_Fair")).toBe("50\\% Off\\_Fair");
  });
});
