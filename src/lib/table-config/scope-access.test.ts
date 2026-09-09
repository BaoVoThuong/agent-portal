import { describe, expect, it } from "vitest";
import { configScopesFor } from "./scope-access";

describe("configScopesFor", () => {
  it("task-admin mở mọi bảng Health", () => {
    expect(configScopesFor({ isTaskAdmin: true, isLeadManager: false })).toEqual([
      "cs",
      "aca",
      "medicare",
      "medicaid",
    ]);
  });

  it("lead manager CHỈ mở bảng Event Leads", () => {
    // Hai tài khoản trên production chỉ có quyền lead. Mở thêm bảng Health cho
    // họ là nới quyền hơn mức họ đang có.
    expect(configScopesFor({ isTaskAdmin: false, isLeadManager: true })).toEqual([
      "lead",
    ]);
  });

  it("có cả hai thì thấy mọi bảng, theo THỨ TỰ CỐ ĐỊNH", () => {
    // Thứ tự phải giống nhau giữa hai lần tải; người dùng học vị trí trong
    // dropdown rồi bấm theo trí nhớ. Bảng mới chèn vào giữa nhóm Health, TRƯỚC
    // Event Leads, để vị trí của Leads không đổi.
    expect(configScopesFor({ isTaskAdmin: true, isLeadManager: true })).toEqual([
      "cs",
      "aca",
      "medicare",
      "medicaid",
      "lead",
    ]);
  });

  it("không có gì thì rỗng", () => {
    expect(configScopesFor({ isTaskAdmin: false, isLeadManager: false })).toEqual([]);
  });
});
