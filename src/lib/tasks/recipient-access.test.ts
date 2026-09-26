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

const { filterTaskRecipientsWithAccess } = await import("./recipient-access");

const task = { agent_email: "agent.a@x.com", reporter_email: "reporter@x.com" };

describe("filterTaskRecipientsWithAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tables.clear();
    // Agent roster: KHÔNG thấy hàng đợi chung, chỉ task của mình / được giao.
    tables.set("task_agents", [
      { email: "agent.a@x.com" },
      { email: "scoped.manage@x.com" },
      { email: "worker@x.com" },
      { email: "reporter@x.com" },
    ]);
    tables.set("agent_members", [{ agent_email: "agent.a@x.com", cs_email: "assistant@x.com" }]);
  });

  it("giữ task manager, bỏ người giữ task.manage mà không xem được task", async () => {
    accessMock.mockResolvedValue(
      new Map([
        ["boss@x.com", access({ roles: ["Admin Health Task"], permissions: ["task.manage"] })],
        ["scoped.manage@x.com", access({ roles: ["Custom"], permissions: ["task.manage"] })],
      ])
    );

    await expect(
      filterTaskRecipientsWithAccess(task, [], ["boss@x.com", "scoped.manage@x.com"])
    ).resolves.toEqual(["boss@x.com"]);
  });

  it("giữ assistant của agent và CS thường thấy hàng đợi chung", async () => {
    accessMock.mockResolvedValue(
      new Map([
        ["assistant@x.com", access()],
        ["plain@x.com", access()],
      ])
    );

    await expect(
      filterTaskRecipientsWithAccess(task, [], ["assistant@x.com", "plain@x.com"])
    ).resolves.toEqual(["assistant@x.com", "plain@x.com"]);
  });

  it("giữ người được giao và người tạo task dù không thuộc scope agent", async () => {
    accessMock.mockResolvedValue(
      new Map([
        ["worker@x.com", access({ roles: ["Custom"], permissions: ["task.manage"] })],
        ["reporter@x.com", access({ roles: ["Custom"], permissions: ["task.manage"] })],
      ])
    );

    await expect(
      filterTaskRecipientsWithAccess(task, ["Worker@x.com"], ["worker@x.com", "reporter@x.com"])
    ).resolves.toEqual(["worker@x.com", "reporter@x.com"]);
  });

  it("bỏ account khoá và account không có quyền task", async () => {
    accessMock.mockResolvedValue(
      new Map([
        ["locked@x.com", access({ isActive: false, roles: ["Admin"], permissions: ["task.manage"] })],
        ["lead.only@x.com", access({ roles: ["Lead"], permissions: ["lead.work"] })],
      ])
    );

    await expect(
      filterTaskRecipientsWithAccess(task, [], ["locked@x.com", "lead.only@x.com"])
    ).resolves.toEqual([]);
  });
});
