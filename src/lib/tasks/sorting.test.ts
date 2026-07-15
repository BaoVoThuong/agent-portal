import { describe, expect, it } from "vitest";
import {
  rankTasksForManager,
  rankTasks,
  RECENT_ACTIVITY_WINDOW_MS,
  sortTasks,
  taskKey,
} from "@/lib/tasks/sorting";
import type { TaskRow, TaskSlaRule } from "@/lib/tasks/types";

function task(p: Partial<TaskRow>): TaskRow {
  return {
    id: "id",
    title: "",
    description: null,
    fub_link: null,
    status: "todo",
    priority: "medium",
    category_id: null,
    agent_email: null,
    assignees: [],
    assignee_email: null,
    reporter_email: "r@x.com",
    todo_started_at: null,
    todo_reminded_at: null,
    in_progress_at: null,
    overdue_flagged_at: null,
    waiting_started_at: null,
    waiting_reminded_at: null,
    overdue_reminded_at: null,
    overdue_unlocked_at: null,
    due_soon_notified_at: null,
    stale_reminded_at: null,
    qc_reminded_at: null,
    last_activity_at: null,
    reopened_at: null,
    sla_minutes: null,
    overdue_count: 0,
    todo_seconds: 0,
    in_progress_seconds: 0,
    waiting_seconds: 0,
    done_reviewed_by_email: null,
    done_reviewed_at: null,
    closed_at: null,
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    archived_at: null,
    ...p,
  };
}

describe("sortTasks", () => {
  it("does not mutate the input array", () => {
    const input = [task({ id: "b", title: "B" }), task({ id: "a", title: "A" })];
    const copy = [...input];
    sortTasks(input, "title", "asc");
    expect(input).toEqual(copy);
  });

  it("sorts by title asc/desc", () => {
    const rows = [task({ title: "B" }), task({ title: "A" }), task({ title: "C" })];
    expect(sortTasks(rows, "title", "asc").map((t) => t.title)).toEqual(["A", "B", "C"]);
    expect(sortTasks(rows, "title", "desc").map((t) => t.title)).toEqual(["C", "B", "A"]);
  });

  it("sorts by priority rank (low<medium<high<urgent)", () => {
    const rows = [
      task({ id: "1", priority: "high" }),
      task({ id: "2", priority: "low" }),
      task({ id: "3", priority: "urgent" }),
      task({ id: "4", priority: "medium" }),
    ];
    expect(sortTasks(rows, "priority", "asc").map((t) => t.priority)).toEqual([
      "low",
      "medium",
      "high",
      "urgent",
    ]);
  });

  it("sorts cancel after done in status order", () => {
    const rows = [
      task({ id: "1", status: "cancel" }),
      task({ id: "2", status: "done" }),
      task({ id: "3", status: "todo" }),
    ];
    expect(sortTasks(rows, "status", "asc").map((t) => t.id)).toEqual([
      "3",
      "2",
      "1",
    ]);
  });

  it("sorts by category name via the resolver", () => {
    const rows = [
      task({ id: "1", category_id: "c1" }),
      task({ id: "2", category_id: "c2" }),
      task({ id: "3", category_id: null }),
    ];
    const name = (id: string | null) =>
      id === "c1" ? "Zebra" : id === "c2" ? "Alpha" : null;
    expect(sortTasks(rows, "category", "asc", name).map((t) => t.id)).toEqual([
      "2",
      "1",
      "3",
    ]);
  });

  it("taskKey is stable for the same id", () => {
    expect(taskKey("abc")).toBe(taskKey("abc"));
    expect(taskKey("abc")).toMatch(/^TASK-\d+$/);
  });
});

describe("rankTasks", () => {
  const now = new Date("2026-07-05T12:00:00.000Z");
  const rules = [
    {
      id: "r",
      priority: "urgent" as const,
      category_id: null,
      duration_minutes: 60,
    },
  ];

  it("overdue tasks come first, most-overdue on top", () => {
    const mild = task({
      id: "mild",
      status: "in_progress",
      priority: "low",
      in_progress_at: "2026-07-05T10:30:00.000Z",
      sla_minutes: 60,
      in_progress_seconds: 0,
      overdue_count: 0,
    });
    const severe = task({
      id: "severe",
      status: "in_progress",
      priority: "low",
      in_progress_at: "2026-07-05T09:00:00.000Z",
      sla_minutes: 60,
      in_progress_seconds: 0,
      overdue_count: 0,
    });
    const fresh = task({
      id: "fresh",
      status: "in_progress",
      priority: "urgent",
      in_progress_at: "2026-07-05T11:55:00.000Z",
      sla_minutes: 60,
      in_progress_seconds: 0,
      overdue_count: 0,
      last_activity_at: "2026-07-05T11:55:00.000Z",
    });

    expect(rankTasks([fresh, mild, severe], rules, now).map((t) => t.id)).toEqual([
      "severe",
      "mild",
      "fresh",
    ]);
  });

  it("recently-active beats an untouched higher priority", () => {
    const urgentOld = task({
      id: "urgentOld",
      status: "todo",
      priority: "urgent",
      last_activity_at: "2026-07-01T00:00:00.000Z",
      created_at: "2026-07-01T00:00:00.000Z",
    });
    const lowRecent = task({
      id: "lowRecent",
      status: "todo",
      priority: "low",
      last_activity_at: "2026-07-05T11:50:00.000Z",
      created_at: "2026-07-04T00:00:00.000Z",
    });

    expect(rankTasks([urgentOld, lowRecent], rules, now).map((t) => t.id)).toEqual([
      "lowRecent",
      "urgentOld",
    ]);
  });

  it("outside the recent window, priority orders the backlog; older first within a priority", () => {
    const old = new Date(now.getTime() - RECENT_ACTIVITY_WINDOW_MS - 1000).toISOString();
    const high = task({
      id: "high",
      status: "todo",
      priority: "high",
      last_activity_at: old,
    });
    const lowA = task({
      id: "lowA",
      status: "todo",
      priority: "low",
      last_activity_at: old,
      created_at: "2026-07-01T00:00:00.000Z",
    });
    const lowB = task({
      id: "lowB",
      status: "todo",
      priority: "low",
      last_activity_at: old,
      created_at: "2026-07-02T00:00:00.000Z",
    });

    expect(rankTasks([lowB, lowA, high], rules, now).map((t) => t.id)).toEqual([
      "high",
      "lowA",
      "lowB",
    ]);
  });
});

describe("rankTasksForManager", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");
  const rules: TaskSlaRule[] = [
    {
      id: "urgent-default",
      priority: "urgent",
      category_id: null,
      duration_minutes: 60,
    },
  ];

  function managerTask(p: Partial<TaskRow>): TaskRow {
    return task({
      agent_email: "agent@x.com",
      assignee_email: "cs@x.com",
      assignees: ["cs@x.com"],
      created_at: "2026-07-13T11:00:00.000Z",
      updated_at: "2026-07-13T11:00:00.000Z",
      ...p,
    });
  }

  it("overdue on top, then unassigned, then stalled", () => {
    const overdue = managerTask({
      id: "overdue",
      status: "in_progress",
      priority: "urgent",
      in_progress_at: "2026-07-13T09:00:00.000Z",
      sla_minutes: 60,
    });
    const unassigned = managerTask({
      id: "unassigned",
      status: "backlog",
      assignee_email: null,
      assignees: [],
    });
    const waiting = managerTask({
      id: "waiting",
      status: "waiting",
      waiting_started_at: "2026-07-13T08:00:00.000Z",
    });

    expect(
      rankTasksForManager([waiting, unassigned, overdue], rules, now).map(
        (row) => row.id
      )
    ).toEqual(["overdue", "unassigned", "waiting"]);
  });

  it("waiting: longest-waiting first", () => {
    const short = managerTask({
      id: "short",
      status: "waiting",
      waiting_started_at: "2026-07-13T11:30:00.000Z",
    });
    const long = managerTask({
      id: "long",
      status: "waiting",
      waiting_started_at: "2026-07-13T06:00:00.000Z",
    });

    expect(rankTasksForManager([short, long], rules, now).map((row) => row.id)).toEqual([
      "long",
      "short",
    ]);
  });

  it("stalled todo: urgent before high; low/medium todo drop to rest", () => {
    const urgent = managerTask({
      id: "urgent",
      status: "todo",
      priority: "urgent",
      todo_started_at: "2026-07-13T10:00:00.000Z",
    });
    const high = managerTask({
      id: "high",
      status: "todo",
      priority: "high",
      todo_started_at: "2026-07-13T10:00:00.000Z",
    });
    const low = managerTask({
      id: "low",
      status: "todo",
      priority: "low",
      todo_started_at: "2026-07-13T10:00:00.000Z",
    });

    expect(
      rankTasksForManager([low, high, urgent], rules, now).map((row) => row.id)
    ).toEqual(["urgent", "high", "low"]);
  });

  it("done-awaiting-QC ranks above recently-active, and reviewed/cancel sink to bottom", () => {
    const qc = managerTask({
      id: "qc",
      status: "done",
      done_reviewed_by_email: null,
      closed_at: "2026-07-13T10:00:00.000Z",
    });
    const recent = managerTask({
      id: "recent",
      status: "in_progress",
      last_activity_at: "2026-07-13T11:59:00.000Z",
      in_progress_at: "2026-07-13T11:00:00.000Z",
      sla_minutes: 600,
    });
    const closed = managerTask({
      id: "closed",
      status: "done",
      done_reviewed_by_email: "a@x.com",
      closed_at: "2026-07-13T09:00:00.000Z",
    });

    expect(
      rankTasksForManager([closed, recent, qc], rules, now).map((row) => row.id)
    ).toEqual(["qc", "recent", "closed"]);
  });
});
