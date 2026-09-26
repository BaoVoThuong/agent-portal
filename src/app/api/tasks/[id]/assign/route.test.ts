import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, targetAccessMock, targetGrants } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  targetAccessMock: vi.fn(),
  targetGrants: { value: [] as string[] },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { email: "admin@x.com" } })),
}));
vi.mock("@/lib/tasks/actor", async () => {
  const { taskActorFromGrants } = await import("@/lib/tasks/access");
  return {
    taskActorForUser: async (_user: unknown, email: string) =>
      taskActorFromGrants(email, ["task.assign:all", "task.read:all"]),
  };
});
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => ({ rpc: rpcMock }) }));
vi.mock("@/lib/tasks/assignees", () => ({
  attachAssigneesToTasks: vi.fn(),
  isEligibleTaskAssigneeEmail: vi.fn(async () => true),
}));
vi.mock("@/lib/rbac/access", () => ({ getUserAccessByEmail: targetAccessMock }));
vi.mock("@/lib/authz/principal", () => ({ grantsForAccess: async () => targetGrants.value }));
vi.mock("@/lib/tasks/notifications", () => ({ insertNotifications: vi.fn() }));
vi.mock("@/lib/tasks/realtime", () => ({
  broadcastTaskRoom: vi.fn(),
  broadcastTasksChanged: vi.fn(),
  readTaskMutationSourceId: vi.fn(),
}));

const { POST } = await import("./route");

function assign(email: string) {
  return POST(new Request("http://localhost/api/tasks/t1/assign", { method: "POST", body: JSON.stringify({ email }) }), {
    params: Promise.resolve({ id: "t1" }),
  });
}

describe("POST /api/tasks/[id]/assign — hàng đợi CS theo grant (Phase G)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    targetAccessMock.mockResolvedValue({ lookupFailed: false, isActive: true });
    rpcMock.mockResolvedValue({ data: null, error: { message: "ASSIGN_CONFLICT" } });
  });

  it("người không giữ task.queue.member: 409, không gọi RPC", async () => {
    targetGrants.value = ["task.read:assigned"];
    const response = await assign("boss@x.com");
    expect(response.status).toBe(409);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("thành viên hàng đợi: tới RPC (RPC còn kiểm quan hệ và xung đột)", async () => {
    targetGrants.value = ["task.queue.member:*", "task.read:shared_queue"];
    await assign("cs@x.com");
    expect(rpcMock).toHaveBeenCalledWith(
      "assign_unassigned_task",
      expect.objectContaining({ p_task_id: "t1", p_cs_email: "cs@x.com" })
    );
  });
});
