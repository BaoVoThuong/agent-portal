import { describe, expect, it } from "vitest";
import { sortTasks, taskKey } from "@/lib/tasks/sorting";
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
    done_reviewed_by_email: null,
    done_reviewed_at: null,
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
