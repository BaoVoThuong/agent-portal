import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  invalidateRbacLookups: vi.fn(),
  countUsersForRole: vi.fn(),
  fetchActiveRolesByIds: vi.fn(),
  fetchRoleById: vi.fn(),
  fetchRolePermissionKeys: vi.fn(),
  fetchRolesWithPermissions: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/auth", () => ({
  auth: mocks.auth,
  invalidateRbacLookups: mocks.invalidateRbacLookups,
}));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/rbac/role-management", () => ({
  countUsersForRole: mocks.countUsersForRole,
  fetchActiveRolesByIds: mocks.fetchActiveRolesByIds,
  fetchRoleById: mocks.fetchRoleById,
  fetchRolePermissionKeys: mocks.fetchRolePermissionKeys,
  fetchRolesWithPermissions: mocks.fetchRolesWithPermissions,
}));

import { DELETE } from "@/app/api/admin/roles/[id]/route";

function request() {
  return new Request("http://localhost/api/admin/roles/source", {
    method: "DELETE",
    body: JSON.stringify({ moveToRoleId: "target" }),
  });
}

describe("delete Role with holder transfer", () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue({
      user: { email: "manager@x.com", permissions: ["management.role_manager", "task.work"] },
    });
    mocks.countUsersForRole.mockReset().mockResolvedValue(1);
    mocks.fetchActiveRolesByIds.mockReset().mockResolvedValue([{ id: "target", is_active: true }]);
    mocks.fetchRoleById.mockReset().mockResolvedValue({ id: "source", name: "Source", is_active: true });
    mocks.fetchRolePermissionKeys.mockReset().mockImplementation(async (id: string) =>
      id === "source" ? ["task.work"] : ["task.manage"]);
    mocks.fetchRolesWithPermissions.mockReset().mockResolvedValue([]);
    mocks.rpc.mockReset().mockResolvedValue({ data: 1, error: null });
    mocks.invalidateRbacLookups.mockReset();
  });

  it("does not invoke the transfer RPC when the target exceeds actor permissions", async () => {
    const response = await DELETE(request(), { params: Promise.resolve({ id: "source" }) });
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("moves holders through the atomic RPC for a role inside the ceiling", async () => {
    mocks.fetchRolePermissionKeys.mockResolvedValue(["task.work"]);
    const response = await DELETE(request(), { params: Promise.resolve({ id: "source" }) });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("delete_role_atomic", {
      p_role_id: "source", p_move_to_role_id: "target", p_actor_email: "manager@x.com",
    });
    expect(await response.json()).toMatchObject({ ok: true, moved: 1 });
  });

  it("reports a committed deletion as successful when refreshing the list fails", async () => {
    mocks.fetchRolePermissionKeys.mockResolvedValue(["task.work"]);
    mocks.fetchRolesWithPermissions.mockRejectedValue(new Error("read unavailable"));
    const response = await DELETE(request(), { params: Promise.resolve({ id: "source" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, moved: 1 });
  });
});
