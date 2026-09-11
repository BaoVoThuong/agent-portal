import { describe, expect, it } from "vitest";
import {
  enabledPrioritiesForCategory,
  isPriorityEnabledForCategory,
  resolvePriorityForCategory,
} from "./priority-availability";
import type { TaskSlaRule } from "./types";

const rule = (
  priority: TaskSlaRule["priority"],
  categoryId: string | null,
  isEnabled: boolean
): Pick<TaskSlaRule, "priority" | "category_id" | "is_enabled"> => ({
  priority,
  category_id: categoryId,
  is_enabled: isEnabled,
});

const CARD = "cat-id-card";
const BILLING = "cat-billing";

describe("mức ưu tiên nào còn chọn được cho một loại việc", () => {
  it("chưa cấu hình gì thì mọi mức đều dùng được", () => {
    expect(enabledPrioritiesForCategory(CARD, [])).toEqual([
      "low",
      "medium",
      "high",
      "urgent",
    ]);
  });

  it("tắt đúng một ô — Order Physical ID card không được Urgent", () => {
    const rules = [rule("urgent", CARD, false)];
    expect(enabledPrioritiesForCategory(CARD, rules)).toEqual(["low", "medium", "high"]);
    // Loại việc khác không bị vạ lây.
    expect(enabledPrioritiesForCategory(BILLING, rules)).toContain("urgent");
  });

  it("ô mặc định áp cho mọi loại việc chưa khai riêng", () => {
    const rules = [rule("urgent", null, false)];
    expect(isPriorityEnabledForCategory("urgent", CARD, rules)).toBe(false);
    expect(isPriorityEnabledForCategory("urgent", BILLING, rules)).toBe(false);
  });

  it("ô riêng của loại việc THẮNG ô mặc định, kể cả khi bật lại", () => {
    const rules = [rule("urgent", null, false), rule("urgent", BILLING, true)];
    expect(isPriorityEnabledForCategory("urgent", BILLING, rules)).toBe(true);
    expect(isPriorityEnabledForCategory("urgent", CARD, rules)).toBe(false);
  });

  it("dòng cũ chưa có cột cờ thì hiểu là đang bật", () => {
    // Dữ liệu ghi trước rollout không có `is_enabled`; thiếu không phải là tắt.
    const rules = [{ priority: "urgent" as const, category_id: CARD }];
    expect(isPriorityEnabledForCategory("urgent", CARD, rules)).toBe(true);
  });

  it("chưa chọn loại việc thì chỉ ô mặc định có hiệu lực", () => {
    const rules = [rule("urgent", CARD, false)];
    expect(isPriorityEnabledForCategory("urgent", null, rules)).toBe(true);
  });
});

describe("chọn lại mức ưu tiên khi đổi loại việc", () => {
  const rules = [rule("urgent", CARD, false)];

  it("giữ nguyên nếu mức đang chọn còn hợp lệ", () => {
    expect(resolvePriorityForCategory("high", CARD, rules)).toBe("high");
  });

  it("lùi xuống mức thấp hơn gần nhất, không tự nâng lên", () => {
    expect(resolvePriorityForCategory("urgent", CARD, rules)).toBe("high");
  });

  it("hết mức thấp thì lấy mức thấp nhất còn bật", () => {
    const strict = [
      rule("low", CARD, false),
      rule("medium", CARD, false),
      rule("high", CARD, false),
    ];
    expect(resolvePriorityForCategory("low", CARD, strict)).toBe("urgent");
  });

  it("tắt hết mọi mức thì trả null để lớp gọi báo lỗi", () => {
    const blocked = (["low", "medium", "high", "urgent"] as const).map((p) =>
      rule(p, CARD, false)
    );
    expect(resolvePriorityForCategory("high", CARD, blocked)).toBeNull();
  });
});
