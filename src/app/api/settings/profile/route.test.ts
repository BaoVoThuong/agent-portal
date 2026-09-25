import { describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("@/auth", () => ({ auth: authMock }));
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
