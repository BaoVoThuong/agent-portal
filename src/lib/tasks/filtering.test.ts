import { describe, expect, it } from "vitest";
import {
  filterTasks,
  ALL_AGENTS,
  NO_AGENT,
  NO_ASSIGNEE,
  type FilterCriteria,
} from "@/lib/tasks/filtering";
import type { TaskRow } from "@/lib/tasks/types";

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
    in_progress_at: null,
    overdue_flagged_at: null,
    sla_minutes: null,
    done_reviewed_by_email: null,
    done_reviewed_at: null,
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-06-24T00:00:00Z",
    archived_at: null,
    ...p,
  };
}

const base: FilterCriteria = {
  query: "",
  agent: ALL_AGENTS,
  quick: [],
  priority: "",
  category: "",
  status: "",
  currentEmail: "me@x.com",
  now: new Date("2026-06-24T12:00:00Z"),
};

describe("filterTasks", () => {
  it("ALL_AGENTS returns everything; agent email narrows; NO_AGENT keeps only untagged", () => {
    const rows = [
      task({ id: "1", agent_email: "a@x.com" }),
      task({ id: "2", agent_email: null }),
    ];
    expect(filterTasks(rows, base).length).toBe(2);
    expect(filterTasks(rows, { ...base, agent: "a@x.com" }).map((t) => t.id)).toEqual([
      "1",
    ]);
    expect(filterTasks(rows, { ...base, agent: NO_AGENT }).map((t) => t.id)).toEqual([
      "2",
    ]);
  });

  it("agent facet accepts multiple selected values", () => {
    const rows = [
      task({ id: "1", agent_email: "a@x.com" }),
      task({ id: "2", agent_email: "b@x.com" }),
      task({ id: "3", agent_email: null }),
    ];

    expect(
      filterTasks(rows, { ...base, agent: ["a@x.com", NO_AGENT] }).map(
        (t) => t.id
      )
    ).toEqual(["1", "3"]);
  });

  it("search matches title (case-insensitive)", () => {
    const rows = [
      task({ id: "1", title: "Renew policy" }),
      task({ id: "2", title: "Call client" }),
    ];
    expect(filterTasks(rows, { ...base, query: "renew" }).map((t) => t.id)).toEqual([
      "1",
    ]);
  });

  it("search matches FUB links", () => {
    const rows = [
      task({ id: "1", fub_link: "https://app.followupboss.com/2/people/view/123" }),
      task({ id: "2", fub_link: null }),
    ];
    expect(filterTasks(rows, { ...base, query: "followupboss" }).map((t) => t.id)).toEqual([
      "1",
    ]);
  });

  it("priority + category + status facets narrow (AND)", () => {
    const rows = [
      task({ id: "1", priority: "high", category_id: "c1", status: "todo" }),
      task({ id: "2", priority: "low", category_id: "c1", status: "todo" }),
      task({ id: "3", priority: "high", category_id: "c2", status: "done" }),
      task({ id: "4", priority: "medium", category_id: "c2", status: "cancel" }),
    ];
    expect(filterTasks(rows, { ...base, priority: "high" }).map((t) => t.id)).toEqual([
      "1",
      "3",
    ]);
    expect(filterTasks(rows, { ...base, category: "c1" }).map((t) => t.id)).toEqual([
      "1",
      "2",
    ]);
    expect(filterTasks(rows, { ...base, status: "done" }).map((t) => t.id)).toEqual([
      "3",
    ]);
    expect(filterTasks(rows, { ...base, status: "cancel" }).map((t) => t.id)).toEqual([
      "4",
    ]);
  });

  it("quick: mine and triage", () => {
    const rows = [
      task({ id: "1", assignees: ["me@x.com"], assignee_email: "me@x.com" }),
      task({ id: "2", reporter_email: "me@x.com" }),
      task({ id: "3", assignees: ["other@x.com"], assignee_email: "other@x.com", reporter_email: "other@x.com" }),
      task({ id: "4", category_id: "c1", agent_email: "a@x.com" }),
    ];
    expect(
      filterTasks(rows, { ...base, quick: ["mine"] })
        .map((t) => t.id)
        .sort()
    ).toEqual(["1", "2"]);
    expect(
      filterTasks(rows, { ...base, quick: ["triage"] }).map((t) => t.id)
    ).toContain("1");
    expect(
      filterTasks(rows, { ...base, quick: ["triage"] }).map((t) => t.id)
    ).not.toContain("4");
  });

  it("quick: overdue matches the precomputed id set", () => {
    const rows = [
      task({ id: "1" }),
      task({ id: "2" }),
    ];
    expect(
      filterTasks(rows, {
        ...base,
        quick: ["overdue"],
        overdueIds: new Set(["2"]),
      }).map((t) => t.id)
    ).toEqual(["2"]);
    expect(
      filterTasks(rows, { ...base, quick: ["overdue"] }).map((t) => t.id)
    ).toEqual([]);
  });

  it("assignee facet matches any assigned member", () => {
    const rows = [
      task({ id: "1", assignees: ["a@x.com", "b@x.com"], assignee_email: "a@x.com" }),
      task({ id: "2", assignees: ["c@x.com"], assignee_email: "c@x.com" }),
      task({ id: "3", assignees: [], assignee_email: null }),
    ];

    expect(filterTasks(rows, { ...base, assignee: "b@x.com" }).map((t) => t.id)).toEqual([
      "1",
    ]);
    expect(filterTasks(rows, { ...base, assignee: NO_ASSIGNEE }).map((t) => t.id)).toEqual([
      "3",
    ]);
    expect(
      filterTasks(rows, {
        ...base,
        assignee: ["b@x.com", NO_ASSIGNEE],
      }).map((t) => t.id)
    ).toEqual(["1", "3"]);
  });

  it("multi-value facets match any selected value within a facet and combine across facets", () => {
    const rows = [
      task({ id: "1", category_id: "c1", status: "todo", assignees: ["a@x.com"] }),
      task({ id: "2", category_id: "c2", status: "done", assignees: ["b@x.com"] }),
      task({ id: "3", category_id: "c3", status: "done", assignees: ["b@x.com"] }),
      task({ id: "4", category_id: "c2", status: "in_progress", assignees: ["c@x.com"] }),
    ];

    expect(
      filterTasks(rows, {
        ...base,
        category: ["c1", "c2"],
        status: ["todo", "done"],
        assignee: ["a@x.com", "b@x.com"],
      }).map((t) => t.id)
    ).toEqual(["1", "2"]);
  });

  it("date range keeps all tasks created inside the window and only unfinished carry-over before it", () => {
    const rows = [
      task({
        id: "old-open",
        status: "todo",
        created_at: "2026-03-10T12:00:00Z",
        updated_at: "2026-03-10T12:00:00Z",
      }),
      task({
        id: "old-done",
        status: "done",
        created_at: "2026-03-10T12:00:00Z",
        updated_at: "2026-03-10T12:00:00Z",
      }),
      task({
        id: "old-cancel",
        status: "cancel",
        created_at: "2026-03-10T12:00:00Z",
        updated_at: "2026-03-10T12:00:00Z",
      }),
      task({
        id: "range-done",
        status: "done",
        created_at: "2026-04-10T12:00:00Z",
        updated_at: "2026-04-10T12:00:00Z",
      }),
      task({
        id: "range-cancel",
        status: "cancel",
        created_at: "2026-04-11T12:00:00Z",
        updated_at: "2026-04-11T12:00:00Z",
      }),
      task({
        id: "after-open",
        status: "todo",
        created_at: "2026-05-10T12:00:00Z",
        updated_at: "2026-05-10T12:00:00Z",
      }),
    ];

    expect(
      filterTasks(rows, {
        ...base,
        dateFrom: "2026-04-01",
        dateTo: "2026-04-30",
      }).map((t) => t.id)
    ).toEqual(["old-open", "range-done", "range-cancel"]);
  });

  it("date range also keeps done/cancel tasks created outside the window but closed inside it", () => {
    const rows = [
      task({
        id: "old-done-closed-in-range",
        status: "done",
        created_at: "2026-03-01T12:00:00Z",
        updated_at: "2026-04-15T12:00:00Z",
      }),
      task({
        id: "old-cancel-closed-in-range",
        status: "cancel",
        created_at: "2026-03-01T12:00:00Z",
        updated_at: "2026-04-20T12:00:00Z",
      }),
      task({
        id: "old-done-closed-before-range",
        status: "done",
        created_at: "2026-02-01T12:00:00Z",
        updated_at: "2026-03-15T12:00:00Z",
      }),
    ];

    expect(
      filterTasks(rows, {
        ...base,
        dateFrom: "2026-04-01",
        dateTo: "2026-04-30",
      }).map((t) => t.id)
    ).toEqual(["old-done-closed-in-range", "old-cancel-closed-in-range"]);
  });
});
