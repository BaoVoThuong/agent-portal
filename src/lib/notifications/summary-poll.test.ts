import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getUserAccessByEmail: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  visibleNotificationTaskIdsById: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rbac/access", () => ({ getUserAccessByEmail: mocks.getUserAccessByEmail }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: mocks.getSupabaseAdmin }));
vi.mock("@/lib/notifications/task-visibility", () => ({
  visibleNotificationTaskIdsById: mocks.visibleNotificationTaskIdsById,
  visibleNotificationTaskIds: vi.fn(),
}));

import { GET } from "@/app/api/tasks/notifications/route";

describe("notification summary polling", () => {
  const rpc = vi.fn();
  const from = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { email: "worker@example.com" } });
    mocks.getUserAccessByEmail.mockResolvedValue({
      userId: "user-1", permissions: ["task.work"], isActive: true, agentId: null,
    });
    mocks.getSupabaseAdmin.mockReturnValue({ rpc, from });
    mocks.visibleNotificationTaskIdsById.mockResolvedValue(new Set(["visible-id"]));
  });

  it("reads one summary and preserves task visibility", async () => {
    rpc.mockResolvedValue({ data: {
      unread: 4,
      assignedTaskIds: ["visible-id", "hidden-id"],
      latestAt: "2026-11-07T01:00:00+00:00",
    }, error: null });

    const response = await GET(new Request("http://localhost/api/tasks/notifications?mode=summary"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getSupabaseAdmin).toHaveBeenCalledWith(8000);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
    expect(body.unread).toBe(4);
    expect(body.unreadAssignedTaskIds).toEqual(["visible-id"]);
    expect(body.latestAt).toBe("2026-11-07T01:00:00+00:00");
  });

  it("returns a database error without fanning out more reads", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST003", message: "pool exhausted" } });

    const response = await GET(new Request("http://localhost/api/tasks/notifications?mode=summary"));

    expect(response.status).toBe(500);
    expect(from).not.toHaveBeenCalled();
  });
});
