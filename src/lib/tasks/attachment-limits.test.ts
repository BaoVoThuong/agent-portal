import { describe, expect, it } from "vitest";
import { checkOperationLimits, LIMITS } from "@/lib/tasks/attachment-limits";

const mb = (n: number) => n * 1024 * 1024;

describe("operation limits", () => {
  it("accepts an ordinary comment with two files", () => {
    expect(checkOperationLimits({ textLength: 200, sizes: [mb(1), mb(2)] })).toEqual({
      ok: true,
    });
  });

  it("reports the aggregate limit, not the count, when aggregate binds first", () => {
    const result = checkOperationLimits({
      textLength: 0,
      sizes: Array(4).fill(mb(15)),
    });
    expect(result).toMatchObject({ ok: false, limit: "aggregate" });
    expect((result as { message: string }).message).toContain("50MB");
  });

  it("reports the count limit when only the count is exceeded", () => {
    expect(
      checkOperationLimits({ textLength: 0, sizes: Array(LIMITS.maxFiles + 1).fill(1024) }),
    ).toMatchObject({ ok: false, limit: "count" });
  });

  it("reports the text limit", () => {
    expect(
      checkOperationLimits({ textLength: LIMITS.maxTextLength + 1, sizes: [] }),
    ).toMatchObject({ ok: false, limit: "text" });
  });
});
