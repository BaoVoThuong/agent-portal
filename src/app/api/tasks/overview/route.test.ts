import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, fetchTaskOverviewMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  fetchTaskOverviewMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/tasks/overview-data", () => ({ fetchTaskOverview: fetchTaskOverviewMock }));
// Role của persona đã chuyển sang grant bằng scripts/authz-migrate-role-grants.ts:
// grant = grant tương thích của permission + tên role cũ.
vi.mock("@/lib/authz/principal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz/principal")>();
  const { deriveCompatGrants } = await import("@/lib/authz/compat");
  return {
    ...actual,
    principalFromSessionUser: async (user: {
      email?: string | null;
      role?: string | null;
      roles?: string[];
      permissions?: string[];
    }) =>
      user?.email
        ? {
            accountId: null,
            email: user.email,
            roleIds: [],
            roles: user.roles ?? [],
            permissions: user.permissions ?? [],
            grants: deriveCompatGrants({
              permissions: user.permissions ?? [],
              roles: user.roles ?? [],
              legacyRole: user.role,
            }),
          }
        : null,
    grantsForSession: async (session: {
      user?: { email?: string | null; role?: string | null; roles?: string[]; permissions?: string[] } | null;
    } | null) =>
      session?.user?.email
        ? deriveCompatGrants({
            permissions: session.user.permissions ?? [],
            roles: session.user.roles ?? [],
            legacyRole: session.user.role,
          })
        : [],
  };
});

const { GET } = await import("./route");

const request = () => new NextRequest("http://localhost/api/tasks/overview");

describe("GET /api/tasks/overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchTaskOverviewMock.mockResolvedValue({ ok: true });
  });

  it("tên role task-admin mà thiếu task.manage: 403", async () => {
    authMock.mockResolvedValue({
      user: { email: "x@x.com", role: "agent", roles: ["Task Admin"], permissions: [] },
    });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(fetchTaskOverviewMock).not.toHaveBeenCalled();
  });

  it("task.manage mà role không phải task-admin: 403", async () => {
    authMock.mockResolvedValue({
      user: { email: "x@x.com", role: "agent", roles: ["Task CS"], permissions: ["task.manage"] },
    });

    const response = await GET(request());

    expect(response.status).toBe(403);
  });

  it("task manager thật: 200", async () => {
    authMock.mockResolvedValue({
      user: {
        email: "x@x.com",
        role: "agent",
        roles: ["Admin Health Task"],
        permissions: ["task.manage"],
      },
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(fetchTaskOverviewMock).toHaveBeenCalledTimes(1);
  });
});
