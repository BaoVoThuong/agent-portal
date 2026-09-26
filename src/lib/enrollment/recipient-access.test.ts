import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAccess } from "@/lib/rbac/access";

const { accessMock, resolveScopeMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  resolveScopeMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => {
    throw new Error("test này không được chạm database");
  },
}));
vi.mock("@/lib/rbac/access", () => ({ getUserAccessByEmails: accessMock }));
vi.mock("@/lib/authz/principal", async () => {
  const { deriveCompatGrants } = await import("@/lib/authz/compat");
  // Role chưa chuyển: grant = grant tương thích từ permission + tên role.
  return {
    grantsForAccess: async (a: UserAccess) =>
      a.isActive
        ? deriveCompatGrants({ permissions: a.permissions, roles: a.roles, legacyRole: a.legacyRole })
        : [],
  };
});
vi.mock("./scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scope")>();
  return { ...actual, resolveEnrollmentScope: resolveScopeMock };
});

const { filterEnrollmentRecipientsWithAccess } = await import("./recipient-access");

const record = {
  agent_email: "agent.a@x.com",
  caller_email: "caller@x.com",
  responsible_enroll_email: null,
  created_by_email: "creator@x.com",
};

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

describe("filterEnrollmentRecipientsWithAccess", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bỏ account khoá, account không có quyền task, và người ngoài scope", async () => {
    accessMock.mockResolvedValue(
      new Map([
        ["plain.cs@x.com", access()],
        ["locked@x.com", access({ isActive: false })],
        ["accounting@x.com", access({ roles: ["Accounting"], permissions: ["company_dashboard.health"] })],
        ["agent.b@x.com", access({ roles: ["Health Agent"] })],
      ])
    );
    resolveScopeMock.mockImplementation(async (actor: { email: string }) =>
      actor.email === "plain.cs@x.com"
        ? { seeAll: true }
        : { seeAll: false, agentEmails: ["agent.b@x.com"], viewerEmail: actor.email }
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
    resolveScopeMock.mockResolvedValue({
      seeAll: false,
      agentEmails: ["someone.else@x.com"],
      viewerEmail: "caller@x.com",
    });

    await expect(
      filterEnrollmentRecipientsWithAccess(record, ["caller@x.com"])
    ).resolves.toEqual(["caller@x.com"]);
  });

  it("danh sách rỗng không truy vấn gì", async () => {
    await expect(filterEnrollmentRecipientsWithAccess(record, ["", "  ", null])).resolves.toEqual([]);
    expect(accessMock).not.toHaveBeenCalled();
  });
});
