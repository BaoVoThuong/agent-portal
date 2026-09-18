import { describe, expect, it } from "vitest";
import { providerCarrierOptions, providerLocationOptions } from "./carriers";

describe("providerCarrierOptions", () => {
  it("derives specific plan labels, removes duplicates, and sorts them", () => {
    expect(
      providerCarrierOptions([
        { obamacare: "Oscar EPO, Ambetter HMO", medicare: "UHC" },
        { obamacare: "oscar epo", medicare: "UHC, BCBS Advantage" },
      ])
    ).toEqual(["Ambetter HMO", "BCBS Advantage", "Oscar EPO", "UHC"]);
  });
});

describe("providerLocationOptions", () => {
  it("returns distinct trimmed values while preserving the first casing", () => {
    expect(
      providerLocationOptions(
        [
          { state: "TX", city: "Houston" },
          { state: "tx", city: " Houston " },
          { state: "CA", city: "Austin" },
          { state: null, city: "" },
        ],
        "city",
      ),
    ).toEqual(["Austin", "Houston"]);
    expect(
      providerLocationOptions(
        [
          { state: "TX", city: "Houston" },
          { state: "tx", city: "Austin" },
        ],
        "state",
      ),
    ).toEqual(["TX"]);
  });
});
