import { describe, expect, it } from "vitest";
import { configScopesFor } from "./scope-access";

const NOBODY = { isTaskAdmin: false, isLeadManager: false, isProviderManager: false };

describe("configScopesFor", () => {
  it("task-admin mở mọi bảng Health", () => {
    expect(configScopesFor({ ...NOBODY, isTaskAdmin: true })).toEqual([
      "cs",
      "aca",
      "medicare",
      "medicaid",
    ]);
  });

  it("lead manager CHỈ mở bảng Event Leads", () => {
    // Hai tài khoản trên production chỉ có quyền lead. Mở thêm bảng Health cho
    // họ là nới quyền hơn mức họ đang có.
    expect(configScopesFor({ ...NOBODY, isLeadManager: true })).toEqual(["lead"]);
  });

  it("người dùng Automation CHỈ mở bảng Provider List", () => {
    expect(configScopesFor({ ...NOBODY, isProviderManager: true })).toEqual(["provider"]);
  });

  it("không cấp chéo: quản lead không mở được bảng provider", () => {
    expect(configScopesFor({ ...NOBODY, isLeadManager: true })).not.toContain("provider");
  });

  it("có cả ba thì thấy mọi bảng, theo THỨ TỰ CỐ ĐỊNH", () => {
    // Thứ tự phải giống nhau giữa hai lần tải; người dùng học vị trí trong
    // dropdown rồi bấm theo trí nhớ. Bảng mới chèn vào CUỐI, để vị trí của
    // Event Leads và nhóm Health không đổi.
    expect(
      configScopesFor({ isTaskAdmin: true, isLeadManager: true, isProviderManager: true })
    ).toEqual(["cs", "aca", "medicare", "medicaid", "lead", "provider"]);
  });

  it("không có gì thì rỗng", () => {
    expect(configScopesFor(NOBODY)).toEqual([]);
  });
});
