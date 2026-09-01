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

describe("flattenAccess legacy admin", () => {
  const row = (role: string, roleNames: string[]) => ({
    id: "u1",
    role,
    is_active: true,
    agent_id: null,
    user_roles: roleNames.map((name) => ({
      roles: { id: name, name, is_active: true, role_permissions: [] },
    })),
  });

  it("honours the RBAC role", () => {
    expect(flattenAccess(row("agent", ["Admin"]) as never).legacyRole).toBe("admin");
  });

  // The trap: legacyRole was computed from portal_account.role and then thrown
  // away for active accounts. The two sources agree in practice because
  // /api/admin/users writes the column from the role names — but a row edited
  // directly in the database would silently stop counting as admin.
  it("honours the legacy column when the RBAC roles do not say admin", () => {
    expect(flattenAccess(row("admin", ["Task CS"]) as never).legacyRole).toBe("admin");
    expect(flattenAccess(row("admin", []) as never).legacyRole).toBe("admin");
  });

  it("still says agent when neither source says admin", () => {
    expect(flattenAccess(row("agent", ["Task CS"]) as never).legacyRole).toBe("agent");
  });
});
