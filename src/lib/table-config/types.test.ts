import { describe, expect, it } from "vitest";
import { parseTableScope } from "@/lib/table-config/types";

describe("parseTableScope", () => {
  it("accepts only supported API scopes", () => {
    expect(parseTableScope("cs")).toBe("cs");
    expect(parseTableScope("aca")).toBe("aca");
    expect(parseTableScope("medicare")).toBe("medicare");
    expect(parseTableScope("lead")).toBe("lead");
    // The Health and P&C lead screens merged into one; the old per-product
    // scopes must stop being accepted so a stale link cannot resurrect them.
    expect(parseTableScope("lead_pc")).toBeNull();
    expect(parseTableScope("lead_health")).toBeNull();
  });

  it("rejects missing and mistyped scopes instead of defaulting to CS", () => {
    expect(parseTableScope(null)).toBeNull();
    expect(parseTableScope(undefined)).toBeNull();
    expect(parseTableScope("")).toBeNull();
    expect(parseTableScope("invalid")).toBeNull();
    expect(parseTableScope({ scope: "cs" })).toBeNull();
  });
});
