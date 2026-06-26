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
    expect(a.roles).toEqual(["CS"]);
    expect([...a.permissions].sort()).toEqual(["settings.access", "task.work"]);
  });

  it("inactive account → no roles/permissions", () => {
    const a = flattenAccess({ ...row, is_active: false });
    expect(a.isActive).toBe(false);
    expect(a.permissions).toEqual([]);
  });
});
