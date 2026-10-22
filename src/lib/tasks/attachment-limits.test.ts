import { describe, expect, it } from "vitest";
import { checkOperationLimits, LIMITS } from "@/lib/tasks/attachment-limits";
import { TASK_ATTACHMENT_MAX_BYTES } from "@/lib/tasks/attachments";

const mb = (n: number) => n * 1024 * 1024;

describe("operation limits", () => {
  it("accepts an ordinary comment with two files", () => {
    expect(checkOperationLimits({ textLength: 200, sizes: [mb(1), mb(2)] })).toEqual({
      ok: true,
    });
  });

  // Suy ra từ LIMITS chứ không viết số cứng: hai trần này được chỉnh cùng nhau,
  // và một test viết cứng "50MB" sẽ lặng lẽ ngừng kiểm đúng thứ nó định kiểm
  // ngay khi ai đó nâng trần dung lượng.
  // Từ 2026-10-21 trần mỗi tệp là 50MB (upload thẳng lên Storage), nên với tệp
  // cỡ lớn nhất thì trần dung lượng chặn trước trần số lượng (250MB = 5 tệp),
  // còn tệp nhỏ thì trần số lượng chặn trước. Thứ tự kiểm (aggregate rồi mới
  // count) vẫn cho câu báo đúng ở cả hai trường hợp.
  it("lets maximum-size files fill the aggregate, then reports the aggregate", () => {
    const fit = Math.floor(LIMITS.maxAggregateBytes / TASK_ATTACHMENT_MAX_BYTES);
    expect(fit).toBeGreaterThanOrEqual(1);
    expect(fit).toBeLessThan(LIMITS.maxFiles);
    expect(
      checkOperationLimits({ textLength: 0, sizes: Array(fit).fill(TASK_ATTACHMENT_MAX_BYTES) }),
    ).toEqual({ ok: true });
    expect(
      checkOperationLimits({ textLength: 0, sizes: Array(fit + 1).fill(TASK_ATTACHMENT_MAX_BYTES) }),
    ).toMatchObject({ ok: false, limit: "aggregate" });
  });

  it("reports the count limit for many small files", () => {
    expect(
      checkOperationLimits({ textLength: 0, sizes: Array(LIMITS.maxFiles + 1).fill(1024) }),
    ).toMatchObject({ ok: false, limit: "count" });
  });

  it("still reports the aggregate limit when the total alone is over", () => {
    expect(
      checkOperationLimits({ textLength: 0, sizes: [LIMITS.maxAggregateBytes + 1] }),
    ).toMatchObject({ ok: false, limit: "aggregate" });
  });

  it("lets a comment carry the full advertised number of typical photos", () => {
    expect(
      checkOperationLimits({
        textLength: 0,
        sizes: Array(LIMITS.maxFiles).fill(mb(4)),
      }),
    ).toEqual({ ok: true });
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
