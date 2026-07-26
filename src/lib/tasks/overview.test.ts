import { describe, expect, it } from "vitest";
import { aggregateOverview, rankRecommendation, resolveOverviewStatus } from "./overview";
import type { OverviewInput } from "./overview";
import type { OverviewAccount, OverviewTaskInput } from "./overview-types";

const now = new Date("2026-07-18T12:00:00.000Z");

function account(
  email: string,
  name = email,
  queueDueAt: string | null = null,
  queueLastAssignedAt: string | null = null,
  queueEnabled = true,
  roleLabel = "Customer Service"
): OverviewAccount {
  return {
    email,
    name,
    roleLabel,
    isActive: true,
    canWork: true,
    isAdmin: false,
    queueDueAt,
    queueLastAssignedAt,
    queueEnabled,
  };
}

function task(overrides: Partial<OverviewTaskInput> = {}): OverviewTaskInput {
  return {
    id: "task-1",
    title: "Task",
    status: "todo",
    priority: "medium",
    category_id: null,
    agent_email: "agent@example.com",
    assignee_email: "alice@example.com",
    todo_started_at: "2026-07-18T11:00:00.000Z",
    in_progress_at: null,
    waiting_started_at: null,
    last_activity_at: "2026-07-18T11:30:00.000Z",
    sla_minutes: null,
    overdue_count: 0,
    in_progress_seconds: 0,
    waiting_seconds: 0,
    closed_at: null,
    done_reviewed_at: null,
    created_at: "2026-07-18T10:00:00.000Z",
    updated_at: "2026-07-18T11:30:00.000Z",
    archived_at: null,
    ...overrides,
  };
}

function input(overrides: Partial<OverviewInput> = {}): OverviewInput {
  return {
    now,
    accounts: [account("alice@example.com"), account("bob@example.com")],
    categories: [],
    taskAgents: [],
    tasks: [],
    assigneesByTask: new Map(),
    rules: [],
    reminderSettings: {
      todoHours: 24,
      waitingHours: 24,
      staleHours: 48,
      dueSoonMinutes: 15,
    },
    ...overrides,
  };
}

describe("aggregateOverview", () => {
  it("keeps zero-load CS visible and counts a multi-assignee task once globally", () => {
    const open = task({ id: "open", assignee_email: null });
    const snapshot = aggregateOverview(
      input({
        tasks: [open],
        assigneesByTask: new Map([["open", ["alice@example.com", "bob@example.com"]]]),
      })
    );

    expect(snapshot.kpis.openTaskCount).toBe(1);
    expect(snapshot.csRows).toHaveLength(2);
    expect(snapshot.csRows.every((row) => row.openCount === 1)).toBe(true);
    expect(snapshot.csRows.map((row) => row.email)).toEqual([
      "alice@example.com",
      "bob@example.com",
    ]);
    expect(snapshot.kpis.zeroLoadCsCount).toBe(0);
    expect(snapshot.workMix.stagePriority.todo.medium).toBe(1);
  });

  it("tracks the created date for the oldest open task per CS", () => {
    const snapshot = aggregateOverview(
      input({
        tasks: [
          task({
            id: "newer",
            created_at: "2026-07-18T10:00:00.000Z",
          }),
          task({
            id: "older",
            created_at: "2026-07-10T09:00:00.000Z",
          }),
        ],
      })
    );

    const alice = snapshot.csRows.find((row) => row.email === "alice@example.com");
    expect(alice?.oldestOpenCreatedAt).toBe("2026-07-10T09:00:00.000Z");
    expect(alice?.oldestOpenAgeSeconds).toBeGreaterThan(0);
  });

  it("shows a zero-load candidate and keeps backlog out of the workload", () => {
    const snapshot = aggregateOverview(
      input({
        tasks: [
          task({ id: "backlog", status: "backlog", assignee_email: null }),
        ],
      })
    );

    expect(snapshot.kpis.openTaskCount).toBe(0);
    expect(snapshot.kpis.unassignedTaskCount).toBe(1);
    expect(snapshot.csRows.find((row) => row.email === "bob@example.com")?.status).toBe("free");
  });

  it("carries assignment queue timestamps onto CS rows", () => {
    const snapshot = aggregateOverview(
      input({
        accounts: [
          account(
            "alice@example.com",
            "Alice",
            "2026-07-18T13:00:00.000Z",
            "2026-07-18T12:15:00.000Z"
          ),
          account("bob@example.com", "Bob", null),
        ],
      })
    );

    expect(snapshot.csRows.find((row) => row.email === "alice@example.com")?.queueDueAt).toBe(
      "2026-07-18T13:00:00.000Z"
    );
    expect(
      snapshot.csRows.find((row) => row.email === "alice@example.com")?.queueLastAssignedAt
    ).toBe("2026-07-18T12:15:00.000Z");
    expect(snapshot.csRows.find((row) => row.email === "bob@example.com")?.queueDueAt).toBeNull();
    expect(
      snapshot.csRows.find((row) => row.email === "bob@example.com")?.queueLastAssignedAt
    ).toBeNull();
  });

  it("carries role labels onto CS rows", () => {
    const snapshot = aggregateOverview(
      input({
        accounts: [
          account("alice@example.com", "Alice", null, null, true, "Customer Service"),
          account("bob@example.com", "Bob", null, null, true, "Assistant to An"),
        ],
      })
    );

    expect(snapshot.csRows.find((row) => row.email === "alice@example.com")?.roleLabel).toBe(
      "Customer Service"
    );
    expect(snapshot.csRows.find((row) => row.email === "bob@example.com")?.roleLabel).toBe(
      "Assistant to An"
    );
  });

  it("keeps assistants in the workload pool but excludes agent owners", () => {
    const snapshot = aggregateOverview(
      input({
        accounts: [
          account("agent@example.com", "Agent", null, null, true, "Agent"),
          account("assistant@example.com", "Assistant", null, null, true, "Assistant to An"),
        ],
        taskAgents: ["agent@example.com"],
      })
    );

    expect(snapshot.csRows.map((row) => row.email)).toEqual(["assistant@example.com"]);
    expect(snapshot.csRows[0].roleLabel).toBe("Assistant to An");
  });

  it("adds category display data to unassigned tasks", () => {
    const snapshot = aggregateOverview(
      input({
        categories: [{ id: "cat-1", name: "Renewal", color: "#0c66e4" }],
        tasks: [
          task({ id: "backlog", status: "backlog", category_id: "cat-1", assignee_email: null }),
        ],
      })
    );

    expect(snapshot.unassigned[0]).toMatchObject({
      categoryId: "cat-1",
      categoryName: "Renewal",
      categoryColor: "#0c66e4",
    });
  });

  it("uses the waiting fraction, overdue flag, and non-attention unknown-effort fallback", () => {
    const snapshot = aggregateOverview(
      input({
        tasks: [
          task({
            id: "waiting",
            status: "waiting",
            priority: "low",
            waiting_started_at: "2026-07-18T11:00:00.000Z",
            sla_minutes: 120,
          }),
          task({
            id: "overdue",
            status: "in_progress",
            priority: "urgent",
            assignee_email: "bob@example.com",
            todo_started_at: null,
            in_progress_at: "2026-07-18T10:00:00.000Z",
            sla_minutes: 60,
          }),
          task({
            id: "unknown",
            status: "in_progress",
            priority: "high",
            assignee_email: "bob@example.com",
            todo_started_at: null,
            in_progress_at: "2026-07-18T11:50:00.000Z",
            waiting_started_at: "2026-07-18T11:20:00.000Z",
            waiting_seconds: 300,
            sla_minutes: 240,
          }),
        ],
      })
    );
    const alice = snapshot.csRows.find((row) => row.email === "alice@example.com");
    const bob = snapshot.csRows.find((row) => row.email === "bob@example.com");

    expect(alice?.tasks.find((item) => item.id === "waiting")?.slaLoadMinutes).toBe(40);
    expect(bob?.riskFlags).toEqual(["overdue"]);
    const unknownTask = bob?.tasks.find((item) => item.id === "unknown");
    expect(unknownTask?.slaLoadMinutes).toBe(240);
    expect(unknownTask?.unknownEffort).toBe(true);
    expect(unknownTask?.riskFlags).toEqual([]);
    expect(snapshot.workMix.stagePriority.waiting.low).toBe(1);
    expect(snapshot.workMix.stagePriority.in_progress_overdue.urgent).toBe(1);
    expect(snapshot.workMix.stagePriority.in_progress.urgent).toBe(0);
    expect(snapshot.workMix.stagePriority.in_progress.high).toBe(1);
  });

  it("separates todo and in-progress overdue work from normal stage rows", () => {
    const snapshot = aggregateOverview(
      input({
        reminderSettings: {
          todoHours: 2,
          waitingHours: 24,
          staleHours: 48,
          dueSoonMinutes: 15,
        },
        tasks: [
          task({
            id: "todo-overdue",
            priority: "urgent",
            todo_started_at: "2026-07-18T08:00:00.000Z",
          }),
          task({
            id: "todo-normal",
            priority: "medium",
            assignee_email: "bob@example.com",
            todo_started_at: "2026-07-18T11:30:00.000Z",
          }),
          task({
            id: "progress-overdue",
            status: "in_progress",
            priority: "high",
            assignee_email: "bob@example.com",
            todo_started_at: null,
            in_progress_at: "2026-07-18T10:00:00.000Z",
            sla_minutes: 60,
          }),
          task({
            id: "progress-normal",
            status: "in_progress",
            priority: "low",
            todo_started_at: null,
            in_progress_at: "2026-07-18T11:45:00.000Z",
            sla_minutes: 60,
          }),
        ],
      })
    );

    expect(snapshot.workMix.stagePriority.todo_overdue.urgent).toBe(1);
    expect(snapshot.workMix.stagePriority.todo.urgent).toBe(0);
    expect(snapshot.workMix.stagePriority.todo.medium).toBe(1);
    expect(snapshot.workMix.stagePriority.in_progress_overdue.high).toBe(1);
    expect(snapshot.workMix.stagePriority.in_progress.high).toBe(0);
    expect(snapshot.workMix.stagePriority.in_progress.low).toBe(1);
  });

  it("does not flag a healthy in-progress task that passed through Waiting once", () => {
    const snapshot = aggregateOverview(
      input({
        accounts: [account("cs@example.com")],
        tasks: [
          task({
            id: "healthy",
            status: "in_progress",
            assignee_email: "cs@example.com",
            in_progress_at: "2026-07-18T11:55:00.000Z",
            waiting_started_at: "2026-07-18T10:00:00.000Z",
            waiting_seconds: 3600,
            overdue_count: 0,
          }),
        ],
      })
    );

    const row = snapshot.csRows.find((item) => item.email === "cs@example.com");
    expect(row?.riskFlags).toEqual([]);
    expect(row?.tasks[0].unknownEffort).toBe(true);
    expect(snapshot.kpis.needsAttentionTaskCount).toBe(0);
  });

  it("flags due soon without marking the task overdue", () => {
    const snapshot = aggregateOverview(
      input({
        accounts: [account("cs@example.com")],
        tasks: [
          task({
            id: "due-soon",
            status: "in_progress",
            priority: "urgent",
            assignee_email: "cs@example.com",
            todo_started_at: null,
            in_progress_at: "2026-07-18T11:10:00.000Z",
          }),
        ],
      })
    );

    const row = snapshot.csRows.find((item) => item.email === "cs@example.com");
    expect(row?.riskFlags).toContain("due_soon");
    expect(row?.riskFlags).not.toContain("overdue");
    expect(snapshot.attention.find((item) => item.key === "due_soon")?.taskCount).toBe(1);
  });

  it("flags previously overdue when the task broke SLA before but is not currently breaching", () => {
    const snapshot = aggregateOverview(
      input({
        accounts: [account("cs@example.com")],
        tasks: [
          task({
            id: "previously-overdue",
            status: "in_progress",
            priority: "medium",
            assignee_email: "cs@example.com",
            todo_started_at: null,
            in_progress_at: "2026-07-18T11:55:00.000Z",
            overdue_count: 1,
          }),
        ],
      })
    );

    const row = snapshot.csRows.find((item) => item.email === "cs@example.com");
    expect(row?.riskFlags).toContain("previously_overdue");
    expect(row?.riskFlags).not.toContain("overdue");
  });

  it("flags stale open work using the reminder threshold", () => {
    const snapshot = aggregateOverview(
      input({
        accounts: [account("cs@example.com")],
        reminderSettings: {
          todoHours: 999,
          waitingHours: 999,
          staleHours: 48,
          dueSoonMinutes: 15,
        },
        tasks: [
          task({
            id: "stale",
            status: "todo",
            assignee_email: "cs@example.com",
            todo_started_at: "2026-07-18T11:00:00.000Z",
            last_activity_at: "2026-07-15T11:00:00.000Z",
          }),
        ],
      })
    );

    const row = snapshot.csRows.find((item) => item.email === "cs@example.com");
    expect(row?.riskFlags).toContain("stale");
    expect(snapshot.attention.find((item) => item.key === "stale")?.taskCount).toBe(1);
  });

  it("tracks urgent or high unassigned backlog work as attention", () => {
    const snapshot = aggregateOverview(
      input({
        tasks: [
          task({ id: "urgent-backlog", status: "backlog", priority: "urgent", assignee_email: null }),
          task({ id: "high-backlog", status: "backlog", priority: "high", assignee_email: null }),
          task({ id: "medium-backlog", status: "backlog", priority: "medium", assignee_email: null }),
        ],
      })
    );

    const attention = snapshot.attention.find((item) => item.key === "unassigned_urgent");
    expect(snapshot.kpis.unassignedTaskCount).toBe(3);
    expect(attention?.taskCount).toBe(2);
    expect(attention?.affectedCsCount).toBe(0);
    expect(snapshot.kpis.needsAttentionTaskCount).toBe(2);
  });

  it("tracks done and cancelled tasks that still need QC review", () => {
    const snapshot = aggregateOverview(
      input({
        tasks: [
          task({
            id: "done-qc",
            status: "done",
            closed_at: "2026-07-18T10:00:00.000Z",
            done_reviewed_at: null,
          }),
          task({
            id: "cancel-qc",
            status: "cancel",
            closed_at: "2026-07-18T09:00:00.000Z",
            done_reviewed_at: null,
          }),
          task({
            id: "done-reviewed",
            status: "done",
            closed_at: "2026-07-18T08:00:00.000Z",
            done_reviewed_at: "2026-07-18T08:30:00.000Z",
          }),
        ],
      })
    );

    const row = snapshot.csRows.find((item) => item.email === "alice@example.com");
    const attention = snapshot.attention.find((item) => item.key === "qc_needed");
    expect(row?.riskFlags).toContain("qc_needed");
    expect(row?.qcNeededTasks.map((item) => item.id)).toEqual(["done-qc", "cancel-qc"]);
    expect(attention?.taskCount).toBe(2);
    expect(attention?.affectedCsCount).toBe(1);
  });

  it("credits done pulse to done only, not cancelled tasks", () => {
    const snapshot = aggregateOverview(
      input({
        tasks: [
          task({
            id: "done",
            status: "done",
            closed_at: "2026-07-18T11:00:00.000Z",
          }),
          task({
            id: "cancel",
            status: "cancel",
            closed_at: "2026-07-18T11:30:00.000Z",
          }),
        ],
      })
    );
    const alice = snapshot.csRows.find((row) => row.email === "alice@example.com");
    expect(alice?.done24h).toBe(1);
    expect(alice?.done7d).toBe(1);
  });
});

describe("rankRecommendation", () => {
  it("ranks by assignment queue before current workload pressure", () => {
    const snapshot = aggregateOverview(
      input({
        accounts: [
          account("alice@example.com", "Alice", "2026-07-18T13:00:00.000Z"),
          account("bob@example.com", "Bob", "2026-07-18T11:00:00.000Z"),
        ],
        tasks: [
          task({ id: "pressure-1", priority: "urgent", assignee_email: "alice@example.com" }),
          task({ id: "pressure-2", priority: "urgent", assignee_email: "alice@example.com" }),
          task({ id: "load", priority: "medium", assignee_email: "bob@example.com", sla_minutes: 30 }),
        ],
      })
    );
    const urgent = {
      id: "new-urgent",
      title: "New urgent",
      agentEmail: null,
      categoryId: null,
      categoryName: null,
      categoryColor: null,
      priority: "urgent" as const,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ageSeconds: 0,
      effectiveSlaMinutes: 60,
    };

    const urgentRanking = rankRecommendation(urgent, snapshot.csRows);

    expect(urgentRanking[0].email).toBe("bob@example.com");
    expect(urgentRanking[0].queueDueAt).toBe("2026-07-18T11:00:00.000Z");
  });

  it("uses SLA load only as the tie-breaker for equal queue positions", () => {
    const snapshot = aggregateOverview(
      input({
        accounts: [
          account("alice@example.com", "Alice", "2026-07-18T11:00:00.000Z"),
          account("bob@example.com", "Bob", "2026-07-18T11:00:00.000Z"),
        ],
        tasks: [
          task({ id: "load", priority: "medium", assignee_email: "alice@example.com", sla_minutes: 300 }),
        ],
      })
    );
    const taskToAssign = {
      id: "new-low",
      title: "New low",
      agentEmail: null,
      categoryId: null,
      categoryName: null,
      categoryColor: null,
      priority: "low" as const,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ageSeconds: 0,
      effectiveSlaMinutes: 20,
    };

    expect(rankRecommendation(taskToAssign, snapshot.csRows)[0].email).toBe("bob@example.com");
  });

  it("excludes queue-disabled CS from assignment recommendations", () => {
    const snapshot = aggregateOverview(
      input({
        accounts: [
          account("alice@example.com", "Alice", "2026-07-18T10:00:00.000Z", null, false),
          account("bob@example.com", "Bob", "2026-07-18T12:00:00.000Z"),
        ],
      })
    );
    const taskToAssign = {
      id: "new-medium",
      title: "New medium",
      agentEmail: null,
      categoryId: null,
      categoryName: null,
      categoryColor: null,
      priority: "medium" as const,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ageSeconds: 0,
      effectiveSlaMinutes: 60,
    };

    expect(snapshot.csRows.find((row) => row.email === "alice@example.com")?.queueEnabled).toBe(false);
    expect(rankRecommendation(taskToAssign, snapshot.csRows).map((row) => row.email)).toEqual([
      "bob@example.com",
    ]);
  });

  it("keeps CS eligible when an older snapshot lacks queueEnabled", () => {
    const snapshot = aggregateOverview(
      input({
        accounts: [
          account("alice@example.com", "Alice", "2026-07-18T10:00:00.000Z"),
        ],
      })
    );
    const [row] = snapshot.csRows;
    const taskToAssign = {
      id: "new-medium",
      title: "New medium",
      agentEmail: null,
      categoryId: null,
      categoryName: null,
      categoryColor: null,
      priority: "medium" as const,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ageSeconds: 0,
      effectiveSlaMinutes: 60,
    };

    expect(rankRecommendation(taskToAssign, [{ ...row, queueEnabled: undefined as never }])).toHaveLength(1);
  });

  it("uses projected status at the workload thresholds", () => {
    expect(resolveOverviewStatus(1, 480, 1, [])).toBe("busy");
    expect(resolveOverviewStatus(1, 960, 1, [])).toBe("overloaded");
    expect(resolveOverviewStatus(0, 2000, 20, [])).toBe("free");
  });
});
