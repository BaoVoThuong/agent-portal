import { describe, expect, it } from "vitest";
import { leadDisplayKey } from "./display";

describe("leadDisplayKey", () => {
  it("prefixes the number", () => {
    expect(leadDisplayKey(1)).toBe("LD1");
    expect(leadDisplayKey(482)).toBe("LD482");
  });

  // A lead should still identify itself in the UI if the sequence ever hands
  // back nothing, rather than rendering "LDnull" or an empty cell.
  it("degrades to a readable placeholder", () => {
    expect(leadDisplayKey(null)).toBe("LD—");
    expect(leadDisplayKey(undefined)).toBe("LD—");
  });
});
