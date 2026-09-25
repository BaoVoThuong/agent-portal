import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, roleManagement } = vi.hoisted(() => ({
  authMock: vi.fn(),
  roleManagement: {
    fetchRoleById: vi.fn(),
    fetchRolesWithPermissions: vi.fn(),
    replaceRolePermissions: vi.fn(),
  },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => {
    throw new Error("test này không được chạm database");
  },
}));
vi.mock("@/lib/rbac/role-management", () => roleManagement);

const { PATCH } = await import("./route");

function patch(body: unknown) {
  return PATCH(
    new Request("http://localhost/api/admin/roles/r1", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "r1" }) }
  );
}

describe("PATCH /api/admin/roles/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("body rỗng từ người không có role_manager: 401 và không đọc danh mục role", async () => {
    authMock.mockResolvedValue({
      user: { email: "cs@x.com", permissions: ["task.work"] },
    });

    const response = await patch({});

    expect(response.status).toBe(401);
    expect(roleManagement.fetchRoleById).not.toHaveBeenCalled();
    expect(roleManagement.fetchRolesWithPermissions).not.toHaveBeenCalled();
  });

  it("chưa đăng nhập: 401", async () => {
    authMock.mockResolvedValue(null);

    const response = await patch({});

    expect(response.status).toBe(401);
    expect(roleManagement.fetchRolesWithPermissions).not.toHaveBeenCalled();
  });

  it("role_manager vẫn PATCH rỗng để đọc lại được", async () => {
    authMock.mockResolvedValue({
      user: { email: "admin@x.com", permissions: ["management.role_manager"] },
    });
    roleManagement.fetchRoleById.mockResolvedValue({ id: "r1", name: "Task CS" });
    roleManagement.fetchRolesWithPermissions.mockResolvedValue([{ id: "r1", name: "Task CS" }]);

    const response = await patch({});

    expect(response.status).toBe(200);
  });
});
