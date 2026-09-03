import { describe, expect, it } from "vitest";
import { configScopesFor } from "./scope-access";

describe("configScopesFor", () => {
  it("task-admin mở ba bảng Health", () => {
    expect(configScopesFor({ isTaskAdmin: true, isLeadManager: false })).toEqual([
      "cs",
      "aca",
      "medicare",
    ]);
  });

  it("lead manager CHỈ mở bảng Event Leads", () => {
    // Hai tài khoản trên production chỉ có quyền lead. Mở thêm bảng Health cho
    // họ là nới quyền hơn mức họ đang có.
    expect(configScopesFor({ isTaskAdmin: false, isLeadManager: true })).toEqual([
      "lead",
    ]);
  });

  it("có cả hai thì thấy cả bốn, theo THỨ TỰ CỐ ĐỊNH", () => {
    // Thứ tự phải giống nhau giữa hai lần tải; người dùng học vị trí trong
    // dropdown rồi bấm theo trí nhớ.
    expect(configScopesFor({ isTaskAdmin: true, isLeadManager: true })).toEqual([
      "cs",
      "aca",
      "medicare",
      "lead",
    ]);
  });

  it("không có gì thì rỗng", () => {
    expect(configScopesFor({ isTaskAdmin: false, isLeadManager: false })).toEqual([]);
  });
});
