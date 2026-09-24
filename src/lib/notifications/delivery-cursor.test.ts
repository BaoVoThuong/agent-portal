import { describe, expect, it } from "vitest";
import {
  hasNewerNotification,
  newestNotificationAt,
} from "@/lib/notifications/delivery-cursor";

const T1 = "2026-09-25T10:00:00.000Z";
const T2 = "2026-09-25T10:05:00.000Z";

describe("hasNewerNotification", () => {
  it("có cái mới hơn mốc thì báo có", () => {
    expect(hasNewerNotification(T1, T2)).toBe(true);
  });

  it("bằng mốc thì thôi — nạp lại chỉ tốn request", () => {
    expect(hasNewerNotification(T2, T2)).toBe(false);
  });

  // Đây là lý do CHÍNH khiến mốc là thời điểm chứ không phải số chưa đọc:
  // đọc bớt thông báo không được phép làm mốc lùi lại.
  it("mốc không lùi khi người dùng đọc bớt ở tab khác", () => {
    expect(hasNewerNotification(T2, T1)).toBe(false);
  });

  it("lần quan sát đầu tiên thì không nạp, tránh dựng toast cho thông báo cũ", () => {
    expect(hasNewerNotification(null, T2)).toBe(false);
  });

  it("người dùng chưa có thông báo nào", () => {
    expect(hasNewerNotification(T1, null)).toBe(false);
    expect(hasNewerNotification(null, null)).toBe(false);
  });

  // Cùng một thời điểm viết bằng hai múi giờ khác nhau không phải là cái mới.
  it("so theo thời điểm thật, không so chuỗi", () => {
    expect(
      hasNewerNotification("2026-09-25T10:00:00.000Z", "2026-09-25T17:00:00.000+07:00")
    ).toBe(false);
  });

  it("chuỗi thời gian hỏng thì im lặng, không bắn toast sai", () => {
    expect(hasNewerNotification("khong-phai-ngay", T2)).toBe(false);
    expect(hasNewerNotification(T1, "khong-phai-ngay")).toBe(false);
  });
});

describe("newestNotificationAt", () => {
  it("lấy thời điểm mới nhất bất kể thứ tự trong mảng", () => {
    expect(
      newestNotificationAt([{ created_at: T1 }, { created_at: T2 }])
    ).toBe(T2);
    expect(
      newestNotificationAt([{ created_at: T2 }, { created_at: T1 }])
    ).toBe(T2);
  });

  it("danh sách rỗng trả null", () => {
    expect(newestNotificationAt([])).toBeNull();
  });

  it("bỏ qua dòng thiếu hoặc hỏng thời điểm", () => {
    expect(
      newestNotificationAt([
        { created_at: null },
        { created_at: "hong" },
        { created_at: T1 },
      ])
    ).toBe(T1);
    expect(newestNotificationAt([{ created_at: null }])).toBeNull();
  });
});
