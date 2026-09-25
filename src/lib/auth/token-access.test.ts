import { describe, expect, it } from "vitest";
import type { UserAccess } from "@/lib/rbac/access";
import { applyRefreshedAccess } from "./token-access";

const base: UserAccess = {
  userId: "u1",
  legacyRole: "agent",
  roles: ["Task CS"],
  roleIds: ["r-cs"],
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
  it("account active: ghi quyền mới, account id, role id, version và thời điểm làm mới", () => {
    expect(applyRefreshedAccess(token, base, 500, 7)).toMatchObject({
      accountId: "u1",
      roles: ["Task CS"],
      roleIds: ["r-cs"],
      permissions: ["task.work"],
      agentId: "EPS1",
      accessVersion: 7,
      rbacRefreshedAt: 500,
    });
  });

  it("không đọc được version: giữ version cũ trong token", () => {
    expect(applyRefreshedAccess({ ...token, accessVersion: 3 }, base, 500, null)).toMatchObject({
      accessVersion: 3,
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
    expect(result).toMatchObject({ roles: [], roleIds: [], permissions: [], rbacRefreshedAt: 1 });
  });
});
