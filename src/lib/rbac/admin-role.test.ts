import { describe, expect, it } from "vitest";
import { isAdminRoleName } from "@/lib/rbac/admin-role";

describe("isAdminRoleName", () => {
  it("matches the reserved name trimmed and case-insensitively", () => {
    expect(isAdminRoleName("Admin")).toBe(true);
    expect(isAdminRoleName(" admin ")).toBe(true);
    expect(isAdminRoleName("ADMIN")).toBe(true);
  });

  it("does not match other names", () => {
    expect(isAdminRoleName("Admin Health Task")).toBe(false);
    expect(isAdminRoleName("Super Admin")).toBe(false);
    expect(isAdminRoleName("Sub Admin")).toBe(false);
    expect(isAdminRoleName(null)).toBe(false);
    expect(isAdminRoleName(undefined)).toBe(false);
  });
});
