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
  // Từ 2026-09-29 trần mỗi tệp là 4MB (giới hạn body của Vercel), nên đủ
  // maxFiles tệp cỡ lớn nhất vẫn nằm dưới trần dung lượng: số lượng mới là cái
  // chặn trước, trần dung lượng chỉ còn là lưới an toàn. Nâng trần mỗi tệp lên
  // lại (upload thẳng lên Storage) thì điều kiện đầu có thể sai — lúc đó xem
  // lại thứ tự kiểm trong checkOperationLimits.
  it("hits the count limit before the aggregate with maximum-size files", () => {
    expect(LIMITS.maxFiles * TASK_ATTACHMENT_MAX_BYTES).toBeLessThanOrEqual(
      LIMITS.maxAggregateBytes,
    );

    const result = checkOperationLimits({
      textLength: 0,
      sizes: Array(LIMITS.maxFiles + 1).fill(TASK_ATTACHMENT_MAX_BYTES),
    });
    expect(result).toMatchObject({ ok: false, limit: "count" });
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
