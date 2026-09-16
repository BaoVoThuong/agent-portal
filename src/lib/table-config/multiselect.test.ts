import { describe, expect, it } from "vitest";
import {
  multiselectEquals,
  parseMultiselectValue,
  toggleMultiselectValue,
} from "./multiselect";

describe("parseMultiselectValue", () => {
  it("nhận mảng, bỏ phần tử rỗng và trùng, giữ nguyên thứ tự", () => {
    expect(parseMultiselectValue(["a", "", "b", "a", "  "])).toEqual(["a", "b"]);
  });

  it("nhận chuỗi ngăn bằng dấu phẩy hoặc xuống dòng", () => {
    expect(parseMultiselectValue("Oscar HMO, Ambetter EPO\nUHC")).toEqual([
      "Oscar HMO",
      "Ambetter EPO",
      "UHC",
    ]);
  });

  it("rỗng, null, kiểu lạ đều ra mảng rỗng", () => {
    expect(parseMultiselectValue(null)).toEqual([]);
    expect(parseMultiselectValue("")).toEqual([]);
    expect(parseMultiselectValue(42)).toEqual([]);
  });
});

describe("toggleMultiselectValue", () => {
  it("bật rồi tắt một giá trị", () => {
    const on = toggleMultiselectValue(["a"], "b");
    expect(on).toEqual(["a", "b"]);
    expect(toggleMultiselectValue(on, "a")).toEqual(["b"]);
  });

  it("không sửa mảng gốc", () => {
    const current = ["a"];
    toggleMultiselectValue(current, "b");
    expect(current).toEqual(["a"]);
  });
});

describe("multiselectEquals", () => {
  it("hai mảng cùng nội dung là bằng nhau", () => {
    expect(multiselectEquals(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("khác thứ tự là khác", () => {
    expect(multiselectEquals(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("null và mảng rỗng là một", () => {
    expect(multiselectEquals(null, [])).toBe(true);
  });
});
