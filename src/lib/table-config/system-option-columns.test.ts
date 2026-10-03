import { describe, expect, it } from "vitest";
import { canManageColumnOptions, storesInCustomValues } from "./system-option-columns";

describe("canManageColumnOptions", () => {
  it("cho phép cột tuỳ chỉnh kiểu chọn", () => {
    for (const type of ["dropdown", "multiselect"] as const) {
      expect(
        canManageColumnOptions({ scope: "cs", key: "x", type, is_system: false })
      ).toBe(true);
    }
  });

  it("chỉ mở đúng hai cột plan hệ thống của provider", () => {
    expect(
      canManageColumnOptions({
        scope: "provider",
        key: "obamacare",
        type: "multiselect",
        is_system: true,
      })
    ).toBe(true);
    expect(
      canManageColumnOptions({
        scope: "provider",
        key: "city",
        type: "text",
        is_system: true,
      })
    ).toBe(false);
    expect(
      canManageColumnOptions({
        scope: "cs",
        key: "status",
        type: "dropdown",
        is_system: true,
      })
    ).toBe(false);
  });
});

describe("trường cố định của mẫu Import Lead", () => {
  it("admin vẫn quản lý được lựa chọn của bốn cột lựa chọn", () => {
    expect(
      canManageColumnOptions({ scope: "lead", key: "insurance_needs", type: "multiselect", is_system: true })
    ).toBe(true);
    expect(
      canManageColumnOptions({ scope: "lead", key: "status", type: "dropdown", is_system: true })
    ).toBe(false);
  });

  // Cột hệ thống nhưng giá trị nằm trong custom_values, nên đi đường cột custom.
  it("storesInCustomValues nhận cột custom và đúng sáu cột hệ thống này", () => {
    expect(storesInCustomValues({ scope: "lead", key: "anything", is_system: false })).toBe(true);
    expect(storesInCustomValues({ scope: "lead", key: "age", is_system: true })).toBe(true);
    expect(storesInCustomValues({ scope: "lead", key: "phone", is_system: true })).toBe(false);
    expect(storesInCustomValues({ scope: "cs", key: "age", is_system: true })).toBe(false);
  });
});
