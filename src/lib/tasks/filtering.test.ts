import { describe, expect, it } from "vitest";
import {
  filterTasks,
  ALL_AGENTS,
  NO_AGENT,
  type FilterCriteria,
} from "@/lib/tasks/filtering";
import type { TaskRow } from "@/lib/tasks/types";

function task(p: Partial<TaskRow>): TaskRow {
  return {
    id: "id",
    title: "",
    description: null,
    status: "todo",
    priority: "medium",
    category_id: null,
    agent_email: null,
    assignee_email: null,
    reporter_email: "r@x.com",
    due_date: null,
    waiting_reason: null,
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

  it("search matches title (case-insensitive)", () => {
    const rows = [
      task({ id: "1", title: "Renew policy" }),
      task({ id: "2", title: "Call client" }),
    ];
    expect(filterTasks(rows, { ...base, query: "renew" }).map((t) => t.id)).toEqual([
      "1",
    ]);
  });

  it("priority + category + status facets narrow (AND)", () => {
    const rows = [
      task({ id: "1", priority: "high", category_id: "c1", status: "todo" }),
      task({ id: "2", priority: "low", category_id: "c1", status: "todo" }),
      task({ id: "3", priority: "high", category_id: "c2", status: "done" }),
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
  });

  it("quick: overdue and dueThisWeek", () => {
    const rows = [
      task({ id: "1", due_date: "2026-06-01", status: "todo" }),
      task({ id: "2", due_date: "2026-06-26", status: "todo" }),
      task({ id: "3", due_date: "2026-08-01", status: "todo" }),
      task({ id: "4", due_date: "2026-06-01", status: "done" }),
    ];
    expect(filterTasks(rows, { ...base, quick: ["overdue"] }).map((t) => t.id)).toEqual([
      "1",
    ]);
    expect(
      filterTasks(rows, { ...base, quick: ["dueThisWeek"] }).map((t) => t.id)
    ).toEqual(["2"]);
  });

  it("quick: mine and triage", () => {
    const rows = [
      task({ id: "1", assignee_email: "me@x.com" }),
      task({ id: "2", reporter_email: "me@x.com" }),
      task({ id: "3", assignee_email: "other@x.com", reporter_email: "other@x.com" }),
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
});
