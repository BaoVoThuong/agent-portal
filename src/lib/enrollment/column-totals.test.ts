import { describe, expect, it } from "vitest";
import { HEADER_TOTAL_COLUMN_KEYS, labelWithTotal, sumColumnValues } from "./column-totals";

describe("sumColumnValues", () => {
  it("cộng số và chuỗi số, bỏ qua ô trống hoặc không phải số", () => {
    expect(sumColumnValues([1, "4", 2, null, undefined, "", "abc", 3])).toBe(10);
  });

  it("không có dòng nào thì tổng là 0", () => {
    expect(sumColumnValues([])).toBe(0);
  });
});

describe("labelWithTotal", () => {
  it("ghi tổng trong ngoặc, có phân nhóm hàng nghìn", () => {
    expect(labelWithTotal("Apply number", 597)).toBe("Apply number (597)");
    expect(labelWithTotal("Apply number", 12345)).toBe("Apply number (12,345)");
  });

  it("không để lộ sai số dấu phẩy động", () => {
    expect(labelWithTotal("Apply number", 0.1 + 0.2)).toBe("Apply number (0.3)");
  });
});

it("chỉ Apply number có tổng trên tiêu đề", () => {
  expect([...HEADER_TOTAL_COLUMN_KEYS]).toEqual(["apply_number"]);
});
