import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAccess } from "@/lib/rbac/access";

const { tables, accessMock } = vi.hoisted(() => ({
  tables: new Map<string, unknown[]>(),
  accessMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const result = { data: tables.get(table) ?? [], error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        then: (resolve: (value: typeof result) => unknown) => resolve(result),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/rbac/access", () => ({ getUserAccessByEmails: accessMock }));
// Role đã chuyển sang grant: grant = grant tương thích của permission + tên role cũ.
vi.mock("@/lib/authz/principal", async () => {
  const { deriveCompatGrants } = await import("@/lib/authz/compat");
  return {
    grantsForAccess: async (a: UserAccess) =>
      a.isActive
        ? deriveCompatGrants({ permissions: a.permissions, roles: a.roles, legacyRole: a.legacyRole })
        : [],
  };
});

function access(overrides: Partial<UserAccess> = {}): UserAccess {
  return {
    userId: "u",
    legacyRole: "agent",
    roles: ["Task CS"],
    roleIds: ["r-cs"],
    permissions: ["task.work"],
    isActive: true,
    agentId: null,
    lookupFailed: false,
    ...overrides,
  };
}

const { filterEnrollmentRecipientsWithAccess } = await import("./recipient-access");

const record = {
  agent_email: "agent.a@x.com",
  caller_email: "caller@x.com",
  responsible_enroll_email: null,
  created_by_email: "creator@x.com",
};

describe("filterEnrollmentRecipientsWithAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tables.clear();
    tables.set("task_agents", [{ email: "agent.a@x.com" }, { email: "agent.b@x.com" }, { email: "caller@x.com" }]);
    tables.set("agent_members", []);
  });

  it("bỏ account khoá, account không có quyền task, và người ngoài scope", async () => {
    accessMock.mockResolvedValue(
      new Map([
        ["plain.cs@x.com", access()],
        ["locked@x.com", access({ isActive: false })],
        ["accounting@x.com", access({ roles: ["Accounting"], permissions: ["company_dashboard.health"] })],
        ["agent.b@x.com", access({ roles: ["Health Agent"] })],
      ])
    );

    const result = await filterEnrollmentRecipientsWithAccess(record, [
      "Plain.CS@x.com",
      "locked@x.com",
      "accounting@x.com",
      "agent.b@x.com",
      "unknown@x.com",
    ]);

    expect(result).toEqual(["plain.cs@x.com"]);
  });

  it("giữ người được giao trực tiếp dù scope theo agent không khớp", async () => {
    accessMock.mockResolvedValue(new Map([["caller@x.com", access()]]));

    await expect(
      filterEnrollmentRecipientsWithAccess(record, ["caller@x.com"])
    ).resolves.toEqual(["caller@x.com"]);
  });

  it("danh sách rỗng không truy vấn gì", async () => {
    await expect(filterEnrollmentRecipientsWithAccess(record, ["", "  ", null])).resolves.toEqual([]);
    expect(accessMock).not.toHaveBeenCalled();
  });
});
