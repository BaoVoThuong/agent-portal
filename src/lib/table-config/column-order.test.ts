import { describe, expect, it } from "vitest";
import { normalizeColumnKeyArray, validateColumnOrderRequest } from "./column-order";

describe("column order request", () => {
  it("normalizes only string keys and rejects blanks", () => {
    expect(normalizeColumnKeyArray([" key ", "stage"])).toEqual(["key", "stage"]);
    expect(normalizeColumnKeyArray(["key", ""])).toBeNull();
    expect(normalizeColumnKeyArray(["key", 3])).toBeNull();
  });

  it("accepts a reorder that preserves exact membership", () => {
    expect(validateColumnOrderRequest(["key", "stage", "agent"], ["agent", "key", "stage"])).toEqual({
      ok: true,
      request: {
        expectedColumnKeys: ["key", "stage", "agent"],
        columnKeys: ["agent", "key", "stage"],
      },
    });
  });

  it("rejects duplicates and membership changes before a network write", () => {
    expect(validateColumnOrderRequest(["key", "stage"], ["key", "key"])).toEqual({ ok: false, reason: "duplicate" });
    expect(validateColumnOrderRequest(["key", "stage"], ["key", "agent"])).toEqual({ ok: false, reason: "membership" });
  });
});
