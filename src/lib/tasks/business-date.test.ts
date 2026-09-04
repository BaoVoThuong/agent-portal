import { describe, expect, it } from "vitest";
import {
  businessDateKey,
  firstDayOfBusinessMonth,
  shiftBusinessDateKey,
} from "./business-date";

describe("businessDateKey", () => {
  // Đây là lý do hàm này tồn tại. 20h ngày 3 giờ Texas (CDT, UTC-5) là 01:00
  // UTC ngày 4, và 08:00 ngày 4 ở VN. Nếu lấy ngày theo máy đang chạy thì cùng
  // một task rơi vào ngày 3 hay ngày 4 tuỳ ai hỏi.
  it("buckets a late-evening Texas timestamp into the Texas day", () => {
    expect(businessDateKey("2026-09-04T01:00:00Z")).toBe("2026-09-03");
  });

  it("buckets an early-morning Texas timestamp into the same Texas day", () => {
    expect(businessDateKey("2026-09-04T13:00:00Z")).toBe("2026-09-04");
  });

  it("handles the CST/CDT boundary", () => {
    // 2026-01-15 05:30 UTC = 23:30 ngày 14 giờ Texas (CST, UTC-6).
    expect(businessDateKey("2026-01-15T05:30:00Z")).toBe("2026-01-14");
    // 2026-07-15 04:30 UTC = 23:30 ngày 14 giờ Texas (CDT, UTC-5).
    expect(businessDateKey("2026-07-15T04:30:00Z")).toBe("2026-07-14");
  });

  it("accepts a Date as well as a string", () => {
    expect(businessDateKey(new Date("2026-09-04T13:00:00Z"))).toBe("2026-09-04");
  });

  it("falls back to the leading 10 characters for an unparseable value", () => {
    expect(businessDateKey("not-a-date")).toBe("not-a-date");
  });
});

describe("shiftBusinessDateKey", () => {
  it("moves across a month boundary", () => {
    expect(shiftBusinessDateKey("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftBusinessDateKey("2026-08-31", 1)).toBe("2026-09-01");
  });

  it("moves across a year boundary", () => {
    expect(shiftBusinessDateKey("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles a leap day", () => {
    expect(shiftBusinessDateKey("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("is unaffected by DST — a shift is always whole calendar days", () => {
    // 2026-03-08 là ngày đổi giờ ở Mỹ. Cộng ngày trong không gian date-key thì
    // không có giờ nào để mất.
    expect(shiftBusinessDateKey("2026-03-07", 1)).toBe("2026-03-08");
    expect(shiftBusinessDateKey("2026-03-08", 1)).toBe("2026-03-09");
  });

  it("returns the input unchanged when it is not a date key", () => {
    expect(shiftBusinessDateKey("nope", 1)).toBe("nope");
  });
});

describe("firstDayOfBusinessMonth", () => {
  it("returns the first of the month", () => {
    expect(firstDayOfBusinessMonth("2026-09-04")).toBe("2026-09-01");
    expect(firstDayOfBusinessMonth("2026-01-31")).toBe("2026-01-01");
  });
});
