import { describe, expect, it } from "vitest";
import { providerCarrierOptions } from "./carriers";

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
