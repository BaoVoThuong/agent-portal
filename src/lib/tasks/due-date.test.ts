import { describe, expect, it } from "vitest";
import {
  formatTaskDueDate,
  isTaskDueDateOverdue,
  readTaskDueDate,
  TASK_DUE_DATE_KEY,
} from "./due-date";

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

describe("isTaskDueDateOverdue", () => {
  const now = new Date(2026, 8, 1, 13, 30); // 2026-09-01, giữa trưa

  it("hạn đã qua là quá hạn", () => {
    expect(isTaskDueDateOverdue("2026-08-31", now)).toBe(true);
    expect(isTaskDueDateOverdue("2004-10-09", now)).toBe(true);
  });

  it("đến hạn HÔM NAY chưa phải quá hạn: vẫn còn cả ngày để làm", () => {
    expect(isTaskDueDateOverdue("2026-09-01", now)).toBe(false);
  });

  it("không đổi màu vào giữa ngày — cắt theo ngày lịch, không theo giờ", () => {
    const sangSom = new Date(2026, 8, 1, 0, 1);
    const nuaDem = new Date(2026, 8, 1, 23, 59);
    expect(isTaskDueDateOverdue("2026-09-01", sangSom)).toBe(false);
    expect(isTaskDueDateOverdue("2026-09-01", nuaDem)).toBe(false);
  });

  it("hạn tương lai không quá hạn", () => {
    expect(isTaskDueDateOverdue("2026-10-09", now)).toBe(false);
  });

  it("chưa có hạn hoặc giá trị hỏng thì không bao giờ quá hạn", () => {
    expect(isTaskDueDateOverdue(null, now)).toBe(false);
    expect(isTaskDueDateOverdue("khong-phai-ngay", now)).toBe(false);
  });
});
