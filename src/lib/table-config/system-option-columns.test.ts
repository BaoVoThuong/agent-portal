import { describe, expect, it } from "vitest";
import { canManageColumnOptions } from "./system-option-columns";

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
