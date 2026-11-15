import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserAccessByEmail } from "@/lib/rbac/access";
import { fetchRolePermissionKeys, fetchUserPermissionKeys, fetchUserRoleId, fetchActiveRolesByIds } from "@/lib/rbac/role-management";
import { getSupabaseAdmin } from "@/lib/supabase";
import { escapeLike, parseBotAction, runBotAction, touchesProtected } from "./actions";

vi.mock("@/auth", () => ({ invalidateRbacLookups: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/rbac/access", () => ({ getUserAccessByEmail: vi.fn() }));
vi.mock("@/lib/rbac/role-management", () => ({
  fetchActiveRolesByIds: vi.fn(),
  fetchRolePermissionKeys: vi.fn(),
  fetchUserPermissionKeys: vi.fn(),
  fetchUserRoleId: vi.fn(),
}));
vi.mock("@/lib/tasks/membership", () => ({ invalidateTaskMembershipLookups: vi.fn() }));
vi.mock("@/lib/table-config/realtime", () => ({ broadcastTableConfigChanged: vi.fn() }));

/** Supabase giả: mỗi bảng trả một danh sách dòng cố định; rpc ghi lại lời gọi. */
function fakeSupabase(tables: Record<string, unknown[]>) {
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const from = (table: string) => {
    const rows = tables[table] ?? [];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "ilike", "eq"]) chain[method] = () => chain;
    chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null });
    return chain;
  };
  vi.mocked(getSupabaseAdmin).mockReturnValue({ from, rpc } as never);
  return rpc;
}

const approverWith = (permissions: string[]) =>
  vi.mocked(getUserAccessByEmail).mockResolvedValue({ userId: "a", permissions, isActive: true, agentId: null });

beforeEach(() => vi.clearAllMocks());

describe("parseBotAction", () => {
  it("accepts each action shape and lower-cases emails", () => {
    expect(parseBotAction({ kind: "role_permission", role_name: "Health Agent", permission_key: "task.import", enabled: true }))
      .toEqual({ kind: "role_permission", role_name: "Health Agent", permission_key: "task.import", enabled: true });
    expect(parseBotAction({ kind: "assistant_link", account_email: "Cheryl@X.co", agent_email: "Tami@X.co", linked: true }))
      .toEqual({ kind: "assistant_link", account_email: "cheryl@x.co", agent_email: "tami@x.co", linked: true });
  });

  it("rejects unknown kinds and missing fields", () => {
    expect(parseBotAction({ kind: "drop_table" })).toBeNull();
    expect(parseBotAction({ kind: "role_permission", role_name: "X", permission_key: "task.import" })).toBeNull();
    expect(parseBotAction({ kind: "account_position", account_email: "a@b.co", position_name: "Assistant", assisted_agent_emails: [1] })).toBeNull();
  });
});

describe("helpers", () => {
  it("flags Role Manager and Slack Bot - Manage as protected", () => {
    expect(touchesProtected(["task.manage", "management.role_manager"])).toBe(true);
    expect(touchesProtected(["slack_bot.manage"])).toBe(true);
    expect(touchesProtected(["task.manage", "management.account_manager"])).toBe(false);
  });

  it("escapes LIKE wildcards so an underscore in an email matches only itself", () => {
    expect(escapeLike(" khang_n@x.co ")).toBe("khang\\_n@x.co");
    expect(escapeLike("100%")).toBe("100\\%");
  });
});

describe("runBotAction: role permission", () => {
  const action = { kind: "role_permission", role_name: "Health Agent", permission_key: "task.import", enabled: true } as const;

  it("refuses when the approver has no Role Manager", async () => {
    approverWith(["management.account_manager"]);
    fakeSupabase({});
    expect((await runBotAction(action, "boss@x.co")).status).toBe(403);
  });

  it("never edits a role that holds Role Manager or Slack Bot - Manage", async () => {
    approverWith(["management.role_manager", "task.import"]);
    const rpc = fakeSupabase({ roles: [{ id: "r1", name: "Health Agent", is_active: true }] });
    vi.mocked(fetchRolePermissionKeys).mockResolvedValue(["task.work", "slack_bot.manage"]);
    expect((await runBotAction(action, "boss@x.co")).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses to grant a permission the approver does not hold", async () => {
    approverWith(["management.role_manager"]);
    const rpc = fakeSupabase({ roles: [{ id: "r1", name: "Health Agent", is_active: true }] });
    vi.mocked(fetchRolePermissionKeys).mockResolvedValue(["task.work"]);
    expect((await runBotAction(action, "boss@x.co")).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ticks the permission through update_role_atomic", async () => {
    approverWith(["management.role_manager", "task.import"]);
    const rpc = fakeSupabase({ roles: [{ id: "r1", name: "Health Agent", is_active: true }] });
    vi.mocked(fetchRolePermissionKeys).mockResolvedValue(["task.work"]);
    const result = await runBotAction(action, "boss@x.co");
    expect(result.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_role_atomic", {
      p_role_id: "r1",
      p_patch: {},
      p_permission_keys: expect.arrayContaining(["task.work", "task.import"]),
    });
  });

  it("never edits Admin (it holds Role Manager like every permission)", async () => {
    approverWith(["management.role_manager"]);
    fakeSupabase({ roles: [{ id: "r0", name: "Admin", is_active: true }] });
    vi.mocked(fetchRolePermissionKeys).mockResolvedValue(["task.manage", "management.role_manager", "slack_bot.manage"]);
    expect((await runBotAction({ ...action, role_name: "admin" }, "boss@x.co")).status).toBe(403);
  });
});

describe("runBotAction: accounts", () => {
  const account = { id: "u1", email: "cheryl@x.co", name: "Cheryl To", is_active: true, position_id: "p-asst", manager_id: null };

  it("never changes an account that holds Role Manager", async () => {
    approverWith(["management.account_manager"]);
    const rpc = fakeSupabase({ portal_account: [account] });
    vi.mocked(fetchUserPermissionKeys).mockResolvedValue(["management.role_manager"]);
    const result = await runBotAction({ kind: "account_active", account_email: "cheryl@x.co", active: false }, "boss@x.co");
    expect(result.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("moves a person to another role with the approver's delegation check", async () => {
    approverWith(["management.account_manager", "task.work", "task.manage"]);
    const rpc = fakeSupabase({ portal_account: [account], roles: [{ id: "r2", name: "Customer Support", is_active: true }] });
    vi.mocked(fetchUserPermissionKeys).mockResolvedValue(["task.work"]);
    vi.mocked(fetchActiveRolesByIds).mockResolvedValue([{ id: "r2", name: "Customer Support" }] as never);
    vi.mocked(fetchRolePermissionKeys).mockResolvedValue(["task.work"]);
    vi.mocked(fetchUserRoleId).mockResolvedValue("r1");
    const result = await runBotAction({ kind: "account_role", account_email: "cheryl@x.co", role_name: "customer support" }, "boss@x.co");
    expect(result.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_account_atomic", { p_user_id: "u1", p_patch: {}, p_role_id: "r2" });
  });

  it("links an Assistant to one more Agent and sends the loaded state as expected", async () => {
    approverWith(["management.account_manager", "task.work"]);
    const rpc = fakeSupabase({
      portal_account: [account],
      positions: [{ kind: "assistant" }],
      agent_members: [{ agent_email: "phi@x.co" }],
    });
    vi.mocked(fetchUserPermissionKeys).mockResolvedValue(["task.work"]);
    const result = await runBotAction({ kind: "assistant_link", account_email: "cheryl@x.co", agent_email: "tami@x.co", linked: true }, "boss@x.co");
    expect(result.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_account_atomic", {
      p_user_id: "u1",
      p_patch: {
        assisted_agent_emails: ["phi@x.co", "tami@x.co"],
        expected: { position_id: "p-asst", manager_id: null, assisted_agent_emails: ["phi@x.co"] },
      },
      p_role_id: null,
    });
  });

  it("refuses to change the approver's own Assistant links", async () => {
    approverWith(["management.account_manager"]);
    fakeSupabase({ portal_account: [account] });
    vi.mocked(fetchUserPermissionKeys).mockResolvedValue([]);
    const result = await runBotAction({ kind: "assistant_link", account_email: "cheryl@x.co", agent_email: "tami@x.co", linked: true }, "Cheryl@x.co");
    expect(result.status).toBe(400);
  });
});
