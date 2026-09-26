import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPrincipalMock, roleManagement, rpcMock, revokeMock } = vi.hoisted(() => ({
  getPrincipalMock: vi.fn(),
  roleManagement: {
    fetchAccountAccess: vi.fn(),
    fetchRoleDefinition: vi.fn(),
    fetchSystemRoleId: vi.fn(),
    isSuperAdminRole: (role: { system_key?: string | null }) => role.system_key === "super_admin",
    mapAuthzRpcError: (message: string | undefined) =>
      message === "LAST_RECOVERY_ADMIN"
        ? { status: 409, error: "last admin" }
        : message === "COMMISSION_NAME_TAKEN"
          ? { status: 409, error: "taken" }
          : null,
    SYSTEM_ROLE_KEYS: { SUPER_ADMIN: "super_admin", DEFAULT_NEW_ACCOUNT: "default_new_account" },
  },
  rpcMock: vi.fn(),
  revokeMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/authz/principal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz/principal")>()),
  getPrincipal: getPrincipalMock,
}));
vi.mock("@/lib/rbac/role-management", () => roleManagement);
vi.mock("@/lib/notifications/push-server", () => ({ revokePushSubscriptions: revokeMock }));
vi.mock("@/lib/authz/versions", () => ({ bumpAccessVersion: vi.fn() }));
vi.mock("@/lib/supabase", () => {
  const target = { id: "u2", email: "target@x.com", role: "agent", is_active: true };
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.single = async () => ({ data: target, error: null });
  return { getSupabaseAdmin: () => ({ rpc: rpcMock, from: () => chain }) };
});

const { PATCH, DELETE } = await import("./route");

const ACCOUNT_MANAGER = {
  accountId: "actor",
  email: "manager@x.com",
  roleIds: ["manager-role"],
  grants: ["account.manage:*", "task.read:assigned"],
};

function patch(body: unknown) {
  return PATCH(new Request("http://localhost/api/admin/users/u2", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "u2" }),
  });
}

function roleDefinition(id: string, grants: string[]) {
  return { id, name: id, isActive: true, systemKey: null, permissions: [], grants };
}

describe("PATCH /api/admin/users/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPrincipalMock.mockResolvedValue(ACCOUNT_MANAGER);
    rpcMock.mockResolvedValue({ data: null, error: null });
    revokeMock.mockResolvedValue(undefined);
    roleManagement.fetchAccountAccess.mockResolvedValue({
      roleIds: ["worker"],
      grants: ["task.read:assigned"],
      holdsSuperAdmin: false,
    });
  });

  it("không có account.manage: 403", async () => {
    getPrincipalMock.mockResolvedValue({ ...ACCOUNT_MANAGER, grants: ["task.read:assigned"] });
    expect((await patch({ is_active: false })).status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("không quản được account có quyền cao hơn mình", async () => {
    roleManagement.fetchAccountAccess.mockResolvedValue({
      roleIds: ["admin"],
      grants: ["account.manage:*", "role.manage:*"],
      holdsSuperAdmin: true,
    });
    expect((await patch({ is_active: false })).status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("không gán được role vượt trần của mình", async () => {
    roleManagement.fetchRoleDefinition.mockResolvedValue(roleDefinition("lead", ["task.read:all"]));
    const response = await patch({ roleIds: ["lead"] });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ grants: ["task.read:all"] });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("trong trần: đổi role + khoá đi qua RPC nguyên tử và thu hồi push", async () => {
    roleManagement.fetchRoleDefinition.mockResolvedValue(roleDefinition("worker", ["task.read:assigned"]));
    const response = await patch({ roleIds: ["worker"], is_active: false });
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("assign_account_access_atomic", {
      p_account_id: "u2",
      p_role_id: "worker",
      p_is_active: false,
      p_actor_account_id: "actor",
      p_actor_email: "manager@x.com",
    });
    expect(revokeMock).toHaveBeenCalledWith("target@x.com");
  });

  it("RPC báo mất admin khôi phục cuối: trả lỗi đã map", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "LAST_RECOVERY_ADMIN" } });
    expect((await patch({ is_active: false })).status).toBe(409);
    expect(revokeMock).not.toHaveBeenCalled();
  });
});

describe("PATCH tên hoa hồng (S1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPrincipalMock.mockResolvedValue(ACCOUNT_MANAGER);
    roleManagement.fetchAccountAccess.mockResolvedValue({
      roleIds: ["worker"],
      grants: ["task.read:assigned"],
      holdsSuperAdmin: false,
    });
  });

  it("đi qua RPC nguyên tử có audit, không đụng role/trạng thái", async () => {
    rpcMock.mockResolvedValue({ data: "ANN LEE", error: null });
    const response = await patch({ commissionName: "Ann Lee" });
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("set_commission_name_atomic", {
      p_account_id: "u2",
      p_agent_name: "Ann Lee",
      p_actor_account_id: "actor",
      p_actor_email: "manager@x.com",
    });
  });

  it("tên đã có người dùng: 409", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "COMMISSION_NAME_TAKEN" } });
    expect((await patch({ commissionName: "Ann Lee" })).status).toBe(409);
  });

  it("sai kiểu: 400, không gọi RPC", async () => {
    expect((await patch({ commissionName: 42 })).status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/users/[id]", () => {
  it("không xoá được account có quyền cao hơn mình", async () => {
    vi.clearAllMocks();
    getPrincipalMock.mockResolvedValue(ACCOUNT_MANAGER);
    roleManagement.fetchAccountAccess.mockResolvedValue({
      roleIds: ["admin"],
      grants: ["role.manage:*"],
      holdsSuperAdmin: true,
    });
    const response = await DELETE(new Request("http://localhost/api/admin/users/u2"), {
      params: Promise.resolve({ id: "u2" }),
    });
    expect(response.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
