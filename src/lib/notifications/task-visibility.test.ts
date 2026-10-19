import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTaskActor } from "@/lib/tasks/access";

const mocks = vi.hoisted(() => ({
  freshNotificationMembership: vi.fn(),
}));
vi.mock("./membership", () => ({
  freshNotificationMembership: mocks.freshNotificationMembership,
}));

import { visibleNotificationTaskIds } from "./task-visibility";

const tasks = [
  { id: "mine", agent_email: "agent@x.com", assignee_email: null, reporter_email: null },
  { id: "assigned", agent_email: "other@x.com", assignee_email: null, reporter_email: null },
  { id: "mentioned", agent_email: "other@x.com", assignee_email: null, reporter_email: null },
  { id: "other", agent_email: "other@x.com", assignee_email: null, reporter_email: null },
];

function db() {
  return {
    from(table: string) {
      const rows = table === "task_assignees"
        ? [{ task_id: "assigned" }]
        : [{ task_id: "mentioned" }];
      const query = {
        select: () => query,
        eq: () => query,
        in: async () => ({ data: rows, error: null }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

describe("visibleNotificationTaskIds", () => {
  beforeEach(() => {
    mocks.freshNotificationMembership.mockReset();
    mocks.freshNotificationMembership.mockResolvedValue({
      isSelectedAgent: false,
      assistantAgentEmails: ["agent@x.com"],
    });
  });

  it("matches Assistant task scope, assignee and participant access", async () => {
    const visible = await visibleNotificationTaskIds(
      buildTaskActor(["task.work"], "assistant@x.com"), tasks, db(),
    );
    expect([...visible].sort()).toEqual(["assigned", "mentioned", "mine"]);
  });

  it("keeps manager access to every existing task", async () => {
    const visible = await visibleNotificationTaskIds(
      buildTaskActor(["task.manage"], "manager@x.com"), tasks, db(),
    );
    expect([...visible]).toEqual(tasks.map((task) => task.id));
    expect(mocks.freshNotificationMembership).not.toHaveBeenCalled();
  });

  it("denies every task when the current Role has no Task permission", async () => {
    const visible = await visibleNotificationTaskIds(
      buildTaskActor([], "assistant@x.com"), tasks, db(),
    );
    expect([...visible]).toEqual([]);
  });

  it("uses the company queue for plain CS, like task detail", async () => {
    mocks.freshNotificationMembership.mockResolvedValue({
      isSelectedAgent: false,
      assistantAgentEmails: [],
    });
    const visible = await visibleNotificationTaskIds(
      buildTaskActor(["task.work"], "cs@x.com"), tasks, db(),
    );
    expect([...visible]).toEqual(tasks.map((task) => task.id));
  });
});
