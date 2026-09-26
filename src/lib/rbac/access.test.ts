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

describe("flattenAccess — nhãn admin (Phase H)", () => {
  const row = (column: string, roles: { name: string; system_key?: string | null }[]) => ({
    id: "u1",
    role: column,
    is_active: true,
    agent_id: null,
    user_roles: roles.map((role) => ({
      roles: { id: role.name, name: role.name, is_active: true, system_key: role.system_key ?? null, role_permissions: [] },
    })),
  });

  it("theo system_key của role, không theo tên", () => {
    expect(flattenAccess(row("agent", [{ name: "Quản trị", system_key: "super_admin" }]) as never).legacyRole).toBe(
      "admin"
    );
    expect(flattenAccess(row("agent", [{ name: "Admin" }]) as never).legacyRole).toBe("agent");
  });

  it("không đọc cột portal_account.role", () => {
    expect(flattenAccess(row("admin", [{ name: "Task CS" }]) as never).legacyRole).toBe("agent");
  });
});
