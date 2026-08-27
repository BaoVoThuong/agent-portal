import { describe, expect, it } from "vitest";
import { isLeadProduct, toLeadProduct } from "./types";

describe("toLeadProduct", () => {
  it("accepts the two real products", () => {
    expect(toLeadProduct("pc")).toBe("pc");
    expect(toLeadProduct("health")).toBe("health");
  });

  // Falls back rather than throwing: this reads a URL query string, and a
  // stale bookmark must not 500 the page.
  it("falls back to pc for anything else", () => {
    expect(toLeadProduct("aca")).toBe("pc");
    expect(toLeadProduct(undefined)).toBe("pc");
    expect(toLeadProduct(123)).toBe("pc");
  });

  it("isLeadProduct narrows without a fallback", () => {
    expect(isLeadProduct("health")).toBe(true);
    expect(isLeadProduct("HEALTH")).toBe(false);
  });
});
