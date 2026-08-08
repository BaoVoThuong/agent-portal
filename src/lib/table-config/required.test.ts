import { describe, expect, it } from "vitest";
import { isRequiredValueFilled } from "@/lib/table-config/required";

describe("isRequiredValueFilled", () => {
  it("treats a deliberate false checkbox as filled", () => {
    expect(isRequiredValueFilled("checkbox", false)).toBe(true);
  });

  it("treats an unset checkbox value as missing", () => {
    expect(isRequiredValueFilled("checkbox", null)).toBe(false);
    expect(isRequiredValueFilled("checkbox", undefined)).toBe(false);
    expect(isRequiredValueFilled("checkbox", "")).toBe(false);
  });

  it("supports nullable option ids used by Consent", () => {
    expect(isRequiredValueFilled("checkbox", "consent-yes")).toBe(true);
  });
});
