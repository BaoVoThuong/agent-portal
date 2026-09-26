import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleDefinition } from "./principal";

const { accountsMock, rolesMock } = vi.hoisted(() => ({
  accountsMock: vi.fn(),
  rolesMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: async () => accountsMock() }) }),
  }),
}));
vi.mock("./principal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./principal")>()),
  loadRoleDefinitions: rolesMock,
}));

const { fetchGrantHolderEmails } = await import("./holders");

const ROLES: RoleDefinition[] = [
  { id: "cs", name: "Task CS", isActive: true, permissions: [], grants: ["task.read:shared_queue", "task.read:assigned"] },
  { id: "old", name: "Retired", isActive: false, permissions: [], grants: ["task.read:assigned"] },
  { id: "scoped", name: "Reader", isActive: true, permissions: [], grants: ["task.read:assigned"] },
  {
    id: "timeoff",
    name: "Time Off Admin",
    isActive: true,
    permissions: [],
    grants: ["notify.timeoff.submitted:*", "timeoff.manage:*"],
  },
  { id: "admin", name: "Admin", isActive: true, systemKey: "super_admin", permissions: [], grants: null },
];

function account(id: string, roleIds: string[], role = "agent") {
  return { id, email: `${id.toUpperCase()}@x.com `, name: id, role, user_roles: roleIds.map((role_id) => ({ role_id })) };
}

describe("fetchGrantHolderEmails", () => {
  beforeEach(() => {
    rolesMock.mockImplementation(async (ids: string[]) => ROLES.filter((role) => ids.includes(role.id)));
    accountsMock.mockResolvedValue({
      data: [
        account("a", ["cs"]),
        account("b", ["old"]),
        account("c", ["scoped"]),
        account("d", ["timeoff"]),
        account("boss", ["admin"]),
      ],
      error: null,
    });
  });

  it("suy grant như phiên đăng nhập: bỏ role tắt, nhận grant tường minh, admin từ system_key", async () => {
    await expect(fetchGrantHolderEmails("task.read")).resolves.toEqual(["a@x.com", "c@x.com", "boss@x.com"]);
  });

  it("theo scope khi được hỏi", async () => {
    await expect(fetchGrantHolderEmails("task.read", "shared_queue")).resolves.toEqual([
      "a@x.com",
      "boss@x.com",
    ]);
  });

  it("super_admin nhận thông báo leo thang; người duyệt nghỉ nhận đơn mới", async () => {
    await expect(fetchGrantHolderEmails("notify.task.escalation")).resolves.toEqual(["boss@x.com"]);
    await expect(fetchGrantHolderEmails("notify.timeoff.submitted")).resolves.toEqual([
      "d@x.com",
      "boss@x.com",
    ]);
  });

  it("lỗi đọc account thì ném, không trả danh sách rỗng giả", async () => {
    accountsMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(fetchGrantHolderEmails("task.read")).rejects.toThrow("boom");
  });
});
