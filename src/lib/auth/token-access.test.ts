import { describe, expect, it } from "vitest";
import type { UserAccess } from "@/lib/rbac/access";
import { applyRefreshedAccess } from "./token-access";

const base: UserAccess = {
  userId: "u1",
  legacyRole: "agent",
  roles: ["Task CS"],
  permissions: ["task.work"],
  isActive: true,
  agentId: "EPS1",
  lookupFailed: false,
};
const token = {
  email: "a@x.com",
  roles: ["Old"],
  permissions: ["old.perm"],
  rbacRefreshedAt: 1,
};

describe("applyRefreshedAccess", () => {
  it("account active: ghi quyền mới và đánh dấu thời điểm làm mới", () => {
    expect(applyRefreshedAccess(token, base, 500)).toMatchObject({
      roles: ["Task CS"],
      permissions: ["task.work"],
      agentId: "EPS1",
      rbacRefreshedAt: 500,
    });
  });

  it("account bị khoá: kết thúc phiên", () => {
    expect(applyRefreshedAccess(token, { ...base, isActive: false }, 500)).toBeNull();
  });

  it("account đã xoá (không có dòng, không lỗi): kết thúc phiên", () => {
    expect(
      applyRefreshedAccess(token, { ...base, userId: null, isActive: false }, 500)
    ).toBeNull();
  });

  it("truy vấn lỗi: giữ phiên, rút quyền, KHÔNG đánh dấu đã làm mới", () => {
    const result = applyRefreshedAccess(
      token,
      { ...base, isActive: false, lookupFailed: true },
      500
    );
    expect(result).toMatchObject({ roles: [], permissions: [], rbacRefreshedAt: 1 });
  });
});
