import { describe, expect, it } from "vitest";
import { aggregateOverview, rankRecommendation, resolveOverviewStatus } from "./overview";
import type { OverviewInput } from "./overview";
import type { OverviewAccount, OverviewTaskInput } from "./overview-types";

const now = new Date("2026-07-18T12:00:00.000Z");

function account(email: string, name = email): OverviewAccount {
  return { email, name, isActive: true, canWork: true, isAdmin: false };
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
    assistantEmails: [],
    tasks: [],
    assigneesByTask: new Map(),
    rules: [],
    reminderSettings: { todoHours: 24, waitingHours: 24 },
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

  it("uses the waiting fraction, overdue flag, and unknown-effort fallback", () => {
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
    expect(bob?.riskFlags).toEqual(expect.arrayContaining(["overdue", "unknown_effort"]));
    expect(bob?.tasks.find((item) => item.id === "unknown")?.slaLoadMinutes).toBe(240);
    expect(snapshot.workMix.stagePriority.waiting.low).toBe(1);
    expect(snapshot.workMix.stagePriority.in_progress_overdue.urgent).toBe(1);
    expect(snapshot.workMix.stagePriority.in_progress.urgent).toBe(0);
    expect(snapshot.workMix.stagePriority.in_progress.high).toBe(1);
  });

  it("separates todo and in-progress overdue work from normal stage rows", () => {
    const snapshot = aggregateOverview(
      input({
        reminderSettings: { todoHours: 2, waitingHours: 24 },
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
  it("avoids a high-pressure CS for urgent work and uses load for low work", () => {
    const snapshot = aggregateOverview(
      input({
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
    const low = { ...urgent, id: "new-low", priority: "low" as const, effectiveSlaMinutes: 20 };

    const urgentRanking = rankRecommendation(urgent, snapshot.csRows);
    const lowRanking = rankRecommendation(low, snapshot.csRows);

    expect(urgentRanking[0].email).toBe("bob@example.com");
    expect(lowRanking[0].email).toBe("bob@example.com");
    expect(urgentRanking[0].why).toContain("in progress");
  });

  it("uses projected status at the workload thresholds", () => {
    expect(resolveOverviewStatus(1, 480, 1, [])).toBe("busy");
    expect(resolveOverviewStatus(1, 960, 1, [])).toBe("overloaded");
    expect(resolveOverviewStatus(0, 2000, 20, [])).toBe("free");
  });
});
