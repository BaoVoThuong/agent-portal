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
  it("reports the aggregate limit, not the count, when aggregate binds first", () => {
    const filesToBustAggregate =
      Math.floor(LIMITS.maxAggregateBytes / TASK_ATTACHMENT_MAX_BYTES) + 1;
    // Nếu điều kiện này sai thì số file cần để vượt dung lượng đã nhiều hơn
    // trần số file — lúc đó count mới là cái chặn trước, và cả test này lẫn thứ
    // tự kiểm trong checkOperationLimits đều cần xem lại.
    expect(filesToBustAggregate).toBeLessThanOrEqual(LIMITS.maxFiles);

    const result = checkOperationLimits({
      textLength: 0,
      sizes: Array(filesToBustAggregate).fill(TASK_ATTACHMENT_MAX_BYTES),
    });
    expect(result).toMatchObject({ ok: false, limit: "aggregate" });
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
