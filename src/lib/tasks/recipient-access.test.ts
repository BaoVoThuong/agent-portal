import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAccess } from "@/lib/rbac/access";

const { accessMock, ownerMock, queueScopeMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  ownerMock: vi.fn(),
  queueScopeMock: vi.fn(),
}));

vi.mock("@/lib/rbac/access", () => ({ getUserAccessByEmails: accessMock }));
vi.mock("./membership", () => ({
  isAgentOwnerOrAssistant: ownerMock,
  resolveTaskQueueScope: queueScopeMock,
}));

const { filterTaskRecipientsWithAccess } = await import("./recipient-access");

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

const task = { agent_email: "agent.a@x.com", reporter_email: "reporter@x.com" };

describe("filterTaskRecipientsWithAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ownerMock.mockResolvedValue(false);
    queueScopeMock.mockResolvedValue({ agentEmails: [], assistantAgentEmails: [], seesAllTasks: false });
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
    ownerMock.mockImplementation(async (_agent: string, email: string) => email === "assistant@x.com");
    queueScopeMock.mockImplementation(async (actor: { email: string }) => ({
      agentEmails: [],
      assistantAgentEmails: [],
      seesAllTasks: actor.email === "plain@x.com",
    }));

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
