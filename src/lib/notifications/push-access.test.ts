import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserAccessByEmail: vi.fn(),
  visibleNotificationTaskIds: vi.fn(),
  sendPushToEmails: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/rbac/access", () => ({ getUserAccessByEmail: mocks.getUserAccessByEmail }));
vi.mock("./task-visibility", () => ({ visibleNotificationTaskIds: mocks.visibleNotificationTaskIds }));
vi.mock("./push-server", () => ({
  buildPushPayload: vi.fn(() => ({ title: "Private task", body: "Private body", url: "/tasks?task=t1", tag: "t1", renotify: false })),
  sendPushToEmails: mocks.sendPushToEmails,
}));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      select: () => ({
        in: async () => ({
          data: table === "tasks"
            ? [{ id: "t1", title: "Private task", display_number: 1,
              agent_email: "agent@x.com", assignee_email: null, reporter_email: null }]
            : [],
          error: null,
        }),
      }),
    }),
  }),
}));

import { pushForTaskNotifications } from "./push-dispatch";

const rows = [
  { recipient_email: "allowed@x.com", task_id: "t1", type: "mentioned", actor_email: "actor@x.com" },
  { recipient_email: "removed@x.com", task_id: "t1", type: "mentioned", actor_email: "actor@x.com" },
];

describe("task Web Push authorization", () => {
  beforeEach(() => {
    mocks.getUserAccessByEmail.mockReset().mockImplementation(async (email: string) => ({
      userId: email, isActive: true, permissions: ["task.work"], agentId: null,
    }));
    mocks.visibleNotificationTaskIds.mockReset().mockImplementation(async (actor: { email: string }) =>
      new Set(actor.email === "allowed@x.com" ? ["t1"] : []));
    mocks.sendPushToEmails.mockReset().mockResolvedValue({ sent: 1, removed: 0 });
  });

  it("sends content only to recipients who still see the task", async () => {
    await pushForTaskNotifications(rows);
    expect(mocks.sendPushToEmails).toHaveBeenCalledTimes(1);
    expect(mocks.sendPushToEmails.mock.calls[0][0]).toEqual(["allowed@x.com"]);
  });

  it("suppresses push to a disabled account even with an old subscription", async () => {
    mocks.getUserAccessByEmail.mockImplementation(async (email: string) => ({
      userId: email, isActive: email !== "allowed@x.com", permissions: ["task.work"], agentId: null,
    }));
    await pushForTaskNotifications([rows[0]]);
    expect(mocks.sendPushToEmails).not.toHaveBeenCalled();
  });
});
