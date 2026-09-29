import { describe, expect, it } from "vitest";
import {
  isLeadProduct,
  normalizeLeadProducts,
  toggleLeadProduct,
  toLeadProduct,
} from "./types";

describe("toLeadProduct", () => {
  it("accepts every product", () => {
    expect(toLeadProduct("pc")).toBe("pc");
    expect(toLeadProduct("health")).toBe("health");
    expect(toLeadProduct("life")).toBe("life");
    expect(toLeadProduct("unknown")).toBe("unknown");
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

// Cùng luật với trigger lead_sync_primary_product: UI phải hiện đúng thứ DB lưu.
describe("normalizeLeadProducts", () => {
  it("empty means Unknown", () => {
    expect(normalizeLeadProducts([])).toEqual(["unknown"]);
  });

  it("a real product drops Unknown", () => {
    expect(normalizeLeadProducts(["unknown", "life"])).toEqual(["life"]);
  });

  it("dedupes and sorts by LEAD_PRODUCTS", () => {
    expect(normalizeLeadProducts(["life", "pc", "life"])).toEqual(["pc", "life"]);
  });
});

describe("toggleLeadProduct", () => {
  it("choosing Unknown clears every other product", () => {
    expect(toggleLeadProduct(["pc", "health"], "unknown")).toEqual(["unknown"]);
  });

  it("choosing a real product replaces Unknown", () => {
    expect(toggleLeadProduct(["unknown"], "life")).toEqual(["life"]);
  });

  it("adds and removes real products", () => {
    expect(toggleLeadProduct(["pc"], "health")).toEqual(["pc", "health"]);
    expect(toggleLeadProduct(["pc", "health"], "pc")).toEqual(["health"]);
  });

  it("unticking the last product falls back to Unknown", () => {
    expect(toggleLeadProduct(["life"], "life")).toEqual(["unknown"]);
  });

  it("Unknown cannot be unticked on its own", () => {
    expect(toggleLeadProduct(["unknown"], "unknown")).toEqual(["unknown"]);
  });
});
