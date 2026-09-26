import { describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("@/auth", () => ({ auth: authMock }));
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
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => {
    throw new Error("không được ghi tên hiển thị");
  },
}));

const { PATCH } = await import("./route");

describe("PATCH /api/settings/profile", () => {
  it("người dùng không tự đổi được tên hiển thị", async () => {
    authMock.mockResolvedValue({
      user: { email: "a@x.com", permissions: ["settings.access"] },
    });

    const response = await PATCH();

    expect(response.status).toBe(403);
  });

  it("chưa đăng nhập: 401", async () => {
    authMock.mockResolvedValue(null);

    const response = await PATCH();

    expect(response.status).toBe(401);
  });
});
