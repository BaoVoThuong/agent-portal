import { describe, expect, it } from "vitest";
import {
  businessToday,
  formatTaskDueDate,
  isTaskDueDateOverdue,
  isTaskRowDueDateOverdue,
  readTaskDueDate,
  TASK_DUE_DATE_KEY,
} from "./due-date";
import type { TaskStatus } from "./types";

describe("readTaskDueDate", () => {
  it("đọc giá trị từ custom_values", () => {
    expect(readTaskDueDate({ [TASK_DUE_DATE_KEY]: "2026-10-09" })).toBe("2026-10-09");
  });

  it("coi chuỗi rỗng và khoảng trắng là chưa đặt hạn", () => {
    expect(readTaskDueDate({ [TASK_DUE_DATE_KEY]: "" })).toBeNull();
    expect(readTaskDueDate({ [TASK_DUE_DATE_KEY]: "   " })).toBeNull();
  });

  it("không nổ khi task chưa có custom_values", () => {
    expect(readTaskDueDate(undefined)).toBeNull();
    expect(readTaskDueDate({})).toBeNull();
  });

  it("bỏ qua giá trị không phải chuỗi", () => {
    expect(readTaskDueDate({ [TASK_DUE_DATE_KEY]: 20261009 })).toBeNull();
  });
});

describe("formatTaskDueDate", () => {
  it("rút gọn còn tháng + ngày", () => {
    expect(formatTaskDueDate("2026-10-09")).toBe("Oct 9");
  });

  it("trả null khi chưa có hạn, để nơi gọi tự quyết hiển thị gì", () => {
    expect(formatTaskDueDate(null)).toBeNull();
  });
});

describe("businessToday", () => {
  it("trả về ngày theo giờ Texas, không theo giờ máy chạy", () => {
    // 2026-10-10T02:00:00Z = 9 giờ tối ngày 09/10 giờ Central. Máy chủ đã sang
    // ngày mới, Texas thì chưa — và Texas mới là nơi người ta làm việc.
    expect(businessToday(new Date("2026-10-10T02:00:00Z"))).toBe("2026-10-09");
  });

  it("sang ngày mới đúng lúc nửa đêm giờ Texas", () => {
    // 05:00Z = 00:00 Central (giờ mùa hè CDT, UTC-5).
    expect(businessToday(new Date("2026-10-10T04:59:00Z"))).toBe("2026-10-09");
    expect(businessToday(new Date("2026-10-10T05:00:00Z"))).toBe("2026-10-10");
  });
});

describe("isTaskDueDateOverdue", () => {
  // 9 giờ tối ngày 09/10 giờ Texas. Máy chủ UTC đã sang ngày 10.
  const toiNgay9 = new Date("2026-10-10T02:00:00Z");

  it("KHÔNG quá hạn khi vẫn còn trong ngày đến hạn ở Texas", () => {
    // Đây chính là ca mà bản cũ báo sai: nó so theo UTC nên coi là đã quá hạn.
    expect(isTaskDueDateOverdue("2026-10-09", toiNgay9)).toBe(false);
  });

  it("quá hạn ngay khi Texas sang ngày mới", () => {
    expect(isTaskDueDateOverdue("2026-10-09", new Date("2026-10-10T05:00:00Z"))).toBe(true);
  });

  it("hạn đã qua nhiều ngày là quá hạn", () => {
    expect(isTaskDueDateOverdue("2004-10-09", toiNgay9)).toBe(true);
  });

  it("hạn tương lai không quá hạn", () => {
    expect(isTaskDueDateOverdue("2026-12-25", toiNgay9)).toBe(false);
  });

  it("chưa có hạn hoặc giá trị hỏng thì không bao giờ quá hạn", () => {
    expect(isTaskDueDateOverdue(null, toiNgay9)).toBe(false);
    expect(isTaskDueDateOverdue("khong-phai-ngay", toiNgay9)).toBe(false);
  });
});

describe("isTaskRowDueDateOverdue", () => {
  const now = new Date("2026-10-10T05:00:00Z"); // đã sang ngày 10 ở Texas
  const row = (status: TaskStatus, dueDate: string | null) => ({
    status,
    custom_values: dueDate ? { due_date: dueDate } : {},
  });

  it("task chưa xong mà quá hạn thì đúng là quá hạn", () => {
    expect(isTaskRowDueDateOverdue(row("in_progress", "2026-10-09"), now)).toBe(true);
    expect(isTaskRowDueDateOverdue(row("todo", "2026-10-09"), now)).toBe(true);
    expect(isTaskRowDueDateOverdue(row("waiting", "2026-10-09"), now)).toBe(true);
    expect(isTaskRowDueDateOverdue(row("backlog", "2026-10-09"), now)).toBe(true);
  });

  it("task ĐÃ XONG thì không còn hạn nào để vỡ", () => {
    expect(isTaskRowDueDateOverdue(row("done", "2026-10-09"), now)).toBe(false);
  });

  it("task ĐÃ HUỶ cũng vậy", () => {
    // Huỷ là một kết cục hợp lệ. Tô đỏ một task đã huỷ là đòi người ta làm một
    // việc đã được quyết định là không làm nữa.
    expect(isTaskRowDueDateOverdue(row("cancel", "2026-10-09"), now)).toBe(false);
  });

  it("task chưa đặt hạn thì không quá hạn", () => {
    expect(isTaskRowDueDateOverdue(row("in_progress", null), now)).toBe(false);
  });
});
