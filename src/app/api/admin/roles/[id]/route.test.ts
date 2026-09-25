import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPrincipalMock, roleManagement, rpcMock, roleRow } = vi.hoisted(() => ({
  getPrincipalMock: vi.fn(),
  roleManagement: {
    fetchRoleDefinition: vi.fn(),
    fetchRolesWithPermissions: vi.fn(),
    isSuperAdminRole: (role: { system_key?: string | null }) => role.system_key === "super_admin",
    mapAuthzRpcError: (message: string | undefined) =>
      message === "ROLE_HAS_MEMBERS" ? { status: 409, error: "still assigned" } : null,
  },
  rpcMock: vi.fn(),
  roleRow: { value: { name: "Task CS", description: null, is_active: true } as unknown },
}));

vi.mock("@/lib/authz/principal", () => ({ getPrincipal: getPrincipalMock }));
vi.mock("@/lib/rbac/role-management", () => roleManagement);
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    rpc: rpcMock,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: roleRow.value, error: null }) }),
      }),
    }),
  }),
}));

const { PATCH, DELETE } = await import("./route");

const ROLE_MANAGER = {
  accountId: "actor",
  email: "manager@x.com",
  roleIds: ["actor-role"],
  grants: ["role.manage:*", "task.read:assigned", "task.read:shared_queue"],
};

function patch(body: unknown, id = "r1") {
  return PATCH(
    new Request(`http://localhost/api/admin/roles/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) }
  );
}

describe("PATCH /api/admin/roles/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({ data: null, error: null });
    roleManagement.fetchRolesWithPermissions.mockResolvedValue([]);
    roleManagement.fetchRoleDefinition.mockResolvedValue({
      id: "r1",
      name: "Task CS",
      isActive: true,
      systemKey: null,
      permissions: ["task.work"],
      grants: null,
    });
  });

  it("chưa đăng nhập: 401", async () => {
    getPrincipalMock.mockResolvedValue(null);
    expect((await patch({})).status).toBe(401);
  });

  it("body rỗng từ người không có role.manage: 403 và không đọc gì (S18)", async () => {
    getPrincipalMock.mockResolvedValue({ ...ROLE_MANAGER, grants: ["task.read:assigned"] });
    const response = await patch({});
    expect(response.status).toBe(403);
    expect(roleManagement.fetchRoleDefinition).not.toHaveBeenCalled();
    expect(roleManagement.fetchRolesWithPermissions).not.toHaveBeenCalled();
  });

  it("không sửa được role mình đang giữ (S4)", async () => {
    getPrincipalMock.mockResolvedValue(ROLE_MANAGER);
    const response = await patch({ grants: ["task.read:assigned"] }, "actor-role");
    expect(response.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("không cấp được grant mình không có (trần uỷ quyền)", async () => {
    getPrincipalMock.mockResolvedValue(ROLE_MANAGER);
    const response = await patch({ grants: ["task.read:all"] });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ grants: ["task.read:all"] });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("đổi tên role chưa chuyển thành tên task-admin cũng bị trần chặn (S3)", async () => {
    getPrincipalMock.mockResolvedValue(ROLE_MANAGER);
    roleManagement.fetchRoleDefinition.mockResolvedValue({
      id: "r1",
      name: "Custom",
      isActive: true,
      systemKey: null,
      permissions: ["task.manage"],
      grants: null,
    });
    const response = await patch({ name: "Task Admin" });
    expect(response.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("trong trần: gọi RPC với grant + bản chiếu permission phẳng", async () => {
    getPrincipalMock.mockResolvedValue(ROLE_MANAGER);
    const response = await patch({ grants: ["task.read:assigned"] });
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith(
      "upsert_role_atomic",
      expect.objectContaining({
        p_role_id: "r1",
        p_grants: [{ action: "task.read", scope: "assigned" }],
        p_legacy_keys: ["task.work"],
        p_actor_account_id: "actor",
      })
    );
  });
});

describe("DELETE /api/admin/roles/[id]", () => {
  it("role còn người: 409 từ RPC (S19)", async () => {
    getPrincipalMock.mockResolvedValue(ROLE_MANAGER);
    rpcMock.mockResolvedValue({ data: null, error: { message: "ROLE_HAS_MEMBERS" } });
    const response = await DELETE(new Request("http://localhost/api/admin/roles/r1"), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(response.status).toBe(409);
  });
});
