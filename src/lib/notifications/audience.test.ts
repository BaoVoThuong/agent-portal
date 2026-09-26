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
vi.mock("@/lib/authz/principal", async () => {
  const { deriveCompatGrants } = await import("@/lib/authz/compat");
  return {
    grantsForAccess: async (a: UserAccess) =>
      a.isActive
        ? deriveCompatGrants({ permissions: a.permissions, roles: a.roles, legacyRole: a.legacyRole })
        : [],
  };
});

const { audienceKey, enrollmentViewersAmong, taskViewersAmong } = await import("./audience");

function access(permissions: string[], overrides: Partial<UserAccess> = {}): UserAccess {
  return {
    userId: "u",
    legacyRole: "agent",
    roles: ["Custom"],
    roleIds: [],
    permissions,
    isActive: true,
    agentId: null,
    lookupFailed: false,
    ...overrides,
  };
}

const PEOPLE = new Map<string, UserAccess>([
  ["cs@x.com", access(["task.work"])],
  ["plain@x.com", access(["task.work"])],
  ["assistant@x.com", access(["task.work"])],
  ["agent.b@x.com", access(["task.work"])],
  ["mention@x.com", access(["task.work"])],
  // Admin theo cột legacy nhưng không có quyền task: từng nhận backlog_attention.
  ["boss@x.com", access(["management.account_manager"], { legacyRole: "admin", roles: ["Accounts"] })],
  ["accounting@x.com", access(["company_dashboard.pc"])],
  ["locked@x.com", access(["task.work"], { isActive: false })],
]);

describe("taskViewersAmong", () => {
  beforeEach(() => {
    tables.clear();
    accessMock.mockResolvedValue(PEOPLE);
    tables.set("tasks", [
      { id: "t1", agent_email: "agent.a@x.com", assignee_email: "cs@x.com", reporter_email: null },
    ]);
    tables.set("task_assignees", [{ task_id: "t1", email: "cs@x.com" }]);
    tables.set("task_participants", [{ task_id: "t1", email: "mention@x.com" }]);
    tables.set("task_agents", [{ email: "agent.a@x.com" }, { email: "agent.b@x.com" }, { email: "mention@x.com" }]);
    tables.set("agent_members", [{ agent_email: "agent.a@x.com", cs_email: "assistant@x.com" }]);
  });

  it("chỉ giữ người xem được task", async () => {
    const emails = [...PEOPLE.keys()];
    const allowed = await taskViewersAmong(emails.map((email) => ({ entityId: "t1", email })));
    const kept = emails.filter((email) => allowed.has(audienceKey("t1", email)));
    expect(kept.sort()).toEqual(["assistant@x.com", "cs@x.com", "mention@x.com", "plain@x.com"]);
    // boss (legacy admin, không quyền task), agent của agent khác, accounting,
    // account khoá: không nhận.
  });

  it("task không tồn tại: không ai nhận", async () => {
    const allowed = await taskViewersAmong([{ entityId: "missing", email: "plain@x.com" }]);
    expect(allowed.size).toBe(0);
  });
});

describe("enrollmentViewersAmong", () => {
  beforeEach(() => {
    tables.clear();
    accessMock.mockResolvedValue(PEOPLE);
    tables.set("enrollment_records", [
      {
        id: "r1",
        agent_email: "agent.a@x.com",
        caller_email: "cs@x.com",
        responsible_enroll_email: null,
        created_by_email: "someone@x.com",
      },
    ]);
    tables.set("task_agents", [{ email: "agent.a@x.com" }, { email: "agent.b@x.com" }, { email: "mention@x.com" }]);
    tables.set("agent_members", [{ agent_email: "agent.a@x.com", cs_email: "assistant@x.com" }]);
  });

  it("chỉ giữ người mở được hồ sơ (mention KHÔNG cấp quyền xem ở Enrollment)", async () => {
    const emails = [...PEOPLE.keys()];
    const allowed = await enrollmentViewersAmong(emails.map((email) => ({ entityId: "r1", email })));
    const kept = emails.filter((email) => allowed.has(audienceKey("r1", email)));
    expect(kept.sort()).toEqual(["assistant@x.com", "cs@x.com", "plain@x.com"]);
  });
});
