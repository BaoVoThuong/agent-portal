import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => {
    throw new Error("không chạm database");
  },
}));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));

describe("chuyển role sang grant: không ai đổi quyết định (role nhất quán với cột legacy)", () => {
  it("mọi persona: grant sau chuyển ≡ quyết định cũ", async () => {
    const { diffDecisions } = await import("@/lib/authz/decision-diff");
    const { compatGrantsForRole } = await import("@/lib/authz/compat");
    const { grantsForRoles } = await import("@/lib/authz/principal");
    const { PERSONAS } = await import("@/lib/authz/legacy/personas");
    for (const [name, access] of Object.entries(PERSONAS)) {
      const isSuperAdmin = access.roles.includes("Admin");
      // Account nhất quán: cột legacy admin ⇔ giữ role super_admin. Persona
      // lệch (legacyColumnAdmin) chính là loại script báo để sửa trước.
      if ((access.legacyRole === "admin") !== isSuperAdmin) continue;
      const role = {
        id: name,
        name: access.roles[0] ?? "Role",
        isActive: true,
        systemKey: isSuperAdmin ? "super_admin" : null,
        permissions: [...access.permissions],
        grants: isSuperAdmin
          ? null
          : compatGrantsForRole({ name: access.roles[0] ?? "Role", permissions: access.permissions }),
      };
      expect(diffDecisions(access, grantsForRoles([role])), name).toEqual([]);
    }
  });
});
