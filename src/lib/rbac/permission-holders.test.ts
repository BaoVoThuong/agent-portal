import { describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

function fakeSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder = {
        select: () => builder,
        in: (column: string, values: unknown[]) => {
          rows = rows.filter((row) => values.includes(row[column]));
          return builder;
        },
        eq: (column: string, value: unknown) => {
          rows = rows.filter((row) => row[column] === value);
          return builder;
        },
        then: (resolve: (result: { data: Row[]; error: null }) => void) =>
          resolve({ data: rows, error: null }),
      };
      return builder;
    },
  };
}

describe("permission holders", () => {
  it("excludes users whose only matching role is disabled", async () => {
    vi.resetModules();
    const tables: Record<string, Row[]> = {
      role_permissions: [
        { role_id: "on", permission_key: "lead.work" },
        { role_id: "off", permission_key: "lead.work" },
      ],
      roles: [
        { id: "on", is_active: true },
        { id: "off", is_active: false },
      ],
      user_roles: [
        { user_id: "alice", role_id: "on" },
        { user_id: "bob", role_id: "off" },
      ],
      portal_account: [
        { id: "alice", email: "Alice@Example.com", is_active: true },
        { id: "bob", email: "bob@example.com", is_active: true },
      ],
    };
    vi.doMock("@/lib/supabase", () => ({ getSupabaseAdmin: () => fakeSupabase(tables) }));
    const { fetchEmailsWithPermission, fetchActiveRoleIdsWithAnyPermission } =
      await import("@/lib/rbac/permission-holders");

    expect(await fetchActiveRoleIdsWithAnyPermission(["lead.work"])).toEqual(["on"]);
    expect(await fetchEmailsWithPermission("lead.work")).toEqual(["alice@example.com"]);
  });
});
