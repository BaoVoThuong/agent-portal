import { describe, expect, it } from "vitest";
import { flattenAccess } from "@/lib/rbac/access";

const row = {
  id: "u1",
  role: "agent",
  is_active: true,
  agent_id: "EPS0001",
  user_roles: [
    { roles: { id: "r1", name: "CS", is_active: true, role_permissions: [{ permission_key: "task.work" }, { permission_key: "settings.access" }] } },
    { roles: { id: "r2", name: "Old", is_active: false, role_permissions: [{ permission_key: "task.manage" }] } },
    { roles: null },
  ],
};

describe("flattenAccess", () => {
  it("collects permissions from active roles only, dedups, keeps agentId", () => {
    const a = flattenAccess(row);
    expect(a.isActive).toBe(true);
    expect(a.agentId).toBe("EPS0001");
    expect([...a.permissions].sort()).toEqual(["settings.access", "task.work"]);
  });

  it("inactive account → no roles/permissions", () => {
    const a = flattenAccess({ ...row, is_active: false });
    expect(a.isActive).toBe(false);
    expect(a.permissions).toEqual([]);
  });
});

// Role names and the legacy portal_account.role column grant nothing: only the
// permission ticks of active roles count.
describe("flattenAccess ignores names and the legacy column", () => {
  it("an Admin-named role with no ticks gives no permissions", () => {
    const access = flattenAccess({
      id: "u1",
      is_active: true,
      agent_id: null,
      user_roles: [{ roles: { id: "r1", is_active: true, role_permissions: [] } }],
    });
    expect(access.permissions).toEqual([]);
    expect(access).not.toHaveProperty("legacyRole");
    expect(access).not.toHaveProperty("roles");
  });
});
