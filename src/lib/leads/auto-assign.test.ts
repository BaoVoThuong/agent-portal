import { describe, expect, it } from "vitest";
import { groupLeadIdsByProduct } from "./auto-assign";

describe("groupLeadIdsByProduct", () => {
  // Import handles one product at a time, but "distribute the pool" does not:
  // the ratio table AND the rotation cursor are per product, so a mixed batch
  // has to be split before either is touched.
  it("splits a mixed batch by product", () => {
    expect(
      groupLeadIdsByProduct([
        { id: "1", product: "health" },
        { id: "2", product: "pc" },
        { id: "3", product: "health" },
      ])
    ).toEqual({ health: ["1", "3"], pc: ["2"] });
  });

  it("returns both keys even when one product has nothing", () => {
    expect(groupLeadIdsByProduct([{ id: "1", product: "pc" }])).toEqual({
      pc: ["1"],
      health: [],
    });
  });

  it("handles an empty batch", () => {
    expect(groupLeadIdsByProduct([])).toEqual({ pc: [], health: [] });
  });
});
