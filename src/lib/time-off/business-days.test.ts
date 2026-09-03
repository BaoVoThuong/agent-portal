import { describe, expect, it } from "vitest";
import { countLeaveBusinessDays, isDateKey, monthBounds } from "./business-days";

const NO_HOLIDAYS: ReadonlySet<string> = new Set();

describe("countLeaveBusinessDays", () => {
  it("một ngày thường tính 1", () => {
    // 2026-03-03 là thứ Ba.
    expect(countLeaveBusinessDays("2026-03-03", "2026-03-03", NO_HOLIDAYS)).toBe(1);
  });

  it("trọn một tuần chỉ tính 5 ngày làm việc", () => {
    // Thứ Hai 2026-03-02 → Chủ Nhật 2026-03-08.
    expect(countLeaveBusinessDays("2026-03-02", "2026-03-08", NO_HOLIDAYS)).toBe(5);
  });

  it("chỉ chọn cuối tuần thì ra 0", () => {
    // Thứ Bảy + Chủ Nhật. Đây là ca API dùng để từ chối đơn rỗng.
    expect(countLeaveBusinessDays("2026-03-07", "2026-03-08", NO_HOLIDAYS)).toBe(0);
  });

  it("ngày lễ nằm giữa thì bị trừ ra", () => {
    // Thứ Sáu 06/03 → thứ Ba 10/03, trong đó thứ Hai 09/03 là ngày nghỉ công ty.
    // Còn lại đúng thứ Sáu và thứ Ba.
    expect(
      countLeaveBusinessDays("2026-03-06", "2026-03-10", new Set(["2026-03-09"]))
    ).toBe(2);
  });

  it("ngày lễ rơi vào cuối tuần không bị trừ hai lần", () => {
    // Thứ Bảy 07/03 vốn đã không tính; đánh dấu nó là lễ không được làm mất
    // thêm một ngày làm việc nào.
    expect(
      countLeaveBusinessDays("2026-03-02", "2026-03-08", new Set(["2026-03-07"]))
    ).toBe(5);
  });

  it("cả khoảng đều là lễ thì ra 0", () => {
    expect(
      countLeaveBusinessDays(
        "2026-03-03",
        "2026-03-04",
        new Set(["2026-03-03", "2026-03-04"])
      )
    ).toBe(0);
  });

  it("ngày kết thúc trước ngày bắt đầu thì ra 0, không âm", () => {
    expect(countLeaveBusinessDays("2026-03-10", "2026-03-02", NO_HOLIDAYS)).toBe(0);
  });

  it("chuỗi ngày sai định dạng thì ra 0 thay vì NaN", () => {
    expect(countLeaveBusinessDays("03/02/2026", "2026-03-06", NO_HOLIDAYS)).toBe(0);
    expect(countLeaveBusinessDays("2026-03-02", "", NO_HOLIDAYS)).toBe(0);
  });

  it("đếm qua mốc sang năm vẫn đúng", () => {
    // Thứ Hai 28/12/2026 → thứ Sáu 01/01/2027: 28,29,30,31 và 01 đều là ngày
    // trong tuần, tổng 5.
    expect(countLeaveBusinessDays("2026-12-28", "2027-01-01", NO_HOLIDAYS)).toBe(5);
  });

  it("năm nhuận: 29/02 được tính như ngày thường", () => {
    // 2028-02-29 là thứ Ba.
    expect(countLeaveBusinessDays("2028-02-28", "2028-02-29", NO_HOLIDAYS)).toBe(2);
  });
});

describe("isDateKey", () => {
  it("nhận đúng dạng YYYY-MM-DD", () => {
    expect(isDateKey("2026-03-02")).toBe(true);
  });

  it("từ chối ngày không tồn tại", () => {
    // 2026 không nhuận nên 29/02 là ngày bịa.
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
  });

  it("từ chối thứ không phải chuỗi ngày", () => {
    expect(isDateKey("2026-3-2")).toBe(false);
    expect(isDateKey("2026-03-02T00:00:00Z")).toBe(false);
    expect(isDateKey(20260302)).toBe(false);
    expect(isDateKey(null)).toBe(false);
  });
});

describe("monthBounds", () => {
  it("trả ngày đầu và ngày cuối của tháng", () => {
    expect(monthBounds("2026-03")).toEqual({ start: "2026-03-01", end: "2026-03-31" });
  });

  it("tháng 2 năm thường kết thúc ngày 28", () => {
    expect(monthBounds("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("tháng 2 năm nhuận kết thúc ngày 29", () => {
    expect(monthBounds("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });

  it("tháng không hợp lệ trả null", () => {
    expect(monthBounds("2026-13")).toBeNull();
    expect(monthBounds("2026-3")).toBeNull();
    expect(monthBounds("")).toBeNull();
  });
});
