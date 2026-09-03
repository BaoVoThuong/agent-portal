import { describe, expect, it } from "vitest";
import {
  availableLeaveDays,
  leaveRangesOverlap,
  leaveRequestRejection,
} from "./balance";

describe("availableLeaveDays", () => {
  it("hạn mức chung trừ đi ngày đã dùng", () => {
    expect(
      availableLeaveDays({
        entitlementDays: null,
        adjustmentDays: 0,
        usedDays: 4,
        defaultAllowance: 15,
      })
    ).toBe(11);
  });

  it("hạn mức riêng của người này thắng hạn mức chung", () => {
    // Admin đặt riêng 20 ngày cho một người thì con số chung 15 không còn nghĩa.
    expect(
      availableLeaveDays({
        entitlementDays: 20,
        adjustmentDays: 0,
        usedDays: 4,
        defaultAllowance: 15,
      })
    ).toBe(16);
  });

  it("cộng dồn phần điều chỉnh, cả cộng lẫn trừ", () => {
    expect(
      availableLeaveDays({
        entitlementDays: null,
        adjustmentDays: 2.5,
        usedDays: 0,
        defaultAllowance: 15,
      })
    ).toBe(17.5);
    expect(
      availableLeaveDays({
        entitlementDays: null,
        adjustmentDays: -3,
        usedDays: 0,
        defaultAllowance: 15,
      })
    ).toBe(12);
  });

  it("loại nghỉ không tính quỹ trả null, không phải 0", () => {
    // 0 nghĩa là "hết ngày" và sẽ chặn đơn. null nghĩa là "không áp dụng".
    expect(
      availableLeaveDays({
        entitlementDays: null,
        adjustmentDays: 0,
        usedDays: 12,
        defaultAllowance: null,
      })
    ).toBeNull();
  });

  it("trừ quá tay thì trả số âm, KHÔNG tự kẹp về 0", () => {
    // Hàm này nói sự thật; nơi hiển thị mới quyết trình bày thế nào. Kẹp về 0
    // ngay tại đây là giấu mất chuyện quỹ đã bị đặt sai.
    expect(
      availableLeaveDays({
        entitlementDays: null,
        adjustmentDays: -10,
        usedDays: 8,
        defaultAllowance: 15,
      })
    ).toBe(-3);
  });
});

describe("leaveRequestRejection", () => {
  it("đơn hợp lệ trong hạn mức thì không bị chặn", () => {
    expect(
      leaveRequestRejection({ requestedDays: 3, availableDays: 10, maxDays: 60 })
    ).toBeNull();
  });

  it("dùng vừa đúng số ngày còn lại vẫn được", () => {
    // Ranh giới: 10 ngày còn lại, xin đúng 10 — phải qua, không phải chặn.
    expect(
      leaveRequestRejection({ requestedDays: 10, availableDays: 10, maxDays: 60 })
    ).toBeNull();
  });

  it("xin quá số ngày còn lại thì chặn", () => {
    expect(
      leaveRequestRejection({ requestedDays: 11, availableDays: 10, maxDays: 60 })
    ).toBe("over_balance");
  });

  it("khoảng ngày không có ngày làm việc nào thì chặn", () => {
    expect(
      leaveRequestRejection({ requestedDays: 0, availableDays: 10, maxDays: 60 })
    ).toBe("empty");
  });

  it("quá dài thì chặn, kể cả loại nghỉ không tính quỹ", () => {
    // Đây là ca mà bản cũ để lọt: unpaid không bị kiểm số dư, nên không có gì
    // ngăn một đơn nghỉ không lương kéo dài nhiều năm.
    expect(
      leaveRequestRejection({ requestedDays: 400, availableDays: null, maxDays: 60 })
    ).toBe("too_long");
  });

  it("loại nghỉ không tính quỹ không bao giờ bị chặn vì số dư", () => {
    expect(
      leaveRequestRejection({ requestedDays: 59, availableDays: null, maxDays: 60 })
    ).toBeNull();
  });

  it("quá dài được báo trước khi báo vượt quỹ", () => {
    // Hai lỗi cùng lúc thì nói cái sửa được bằng cách rút ngắn ngày trước —
    // "vượt quỹ" trên một đơn 400 ngày là lời khuyên vô dụng.
    expect(
      leaveRequestRejection({ requestedDays: 400, availableDays: 5, maxDays: 60 })
    ).toBe("too_long");
  });
});

describe("leaveRangesOverlap", () => {
  it("hai khoảng rời nhau thì không chồng", () => {
    expect(leaveRangesOverlap("2026-03-02", "2026-03-06", "2026-03-09", "2026-03-13")).toBe(false);
  });

  it("chạm nhau đúng MỘT ngày vẫn là chồng", () => {
    // Không ai nghỉ hai lần trong cùng một ngày.
    expect(leaveRangesOverlap("2026-03-02", "2026-03-05", "2026-03-05", "2026-03-09")).toBe(true);
  });

  it("khoảng này nằm gọn trong khoảng kia", () => {
    expect(leaveRangesOverlap("2026-03-03", "2026-03-04", "2026-03-01", "2026-03-31")).toBe(true);
  });

  it("đối xứng — đổi chỗ hai khoảng cho cùng kết quả", () => {
    expect(leaveRangesOverlap("2026-03-01", "2026-03-10", "2026-03-05", "2026-03-20")).toBe(true);
    expect(leaveRangesOverlap("2026-03-05", "2026-03-20", "2026-03-01", "2026-03-10")).toBe(true);
  });

  it("sang năm mới vẫn so đúng thứ tự", () => {
    // So chuỗi "YYYY-MM-DD" giữ đúng thứ tự thời gian, kể cả qua mốc năm.
    expect(leaveRangesOverlap("2026-12-28", "2027-01-04", "2027-01-02", "2027-01-08")).toBe(true);
    expect(leaveRangesOverlap("2026-12-28", "2026-12-31", "2027-01-02", "2027-01-08")).toBe(false);
  });
});
