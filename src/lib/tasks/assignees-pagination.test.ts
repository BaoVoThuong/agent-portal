import { describe, expect, it, vi } from "vitest";
import { fetchTaskAssigneeRowsForTaskIds } from "./assignees";

describe("fetchTaskAssigneeRowsForTaskIds", () => {
  it("loads every assignee when one task-id chunk exceeds 1000 rows", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      task_id: "task-1",
      email: `agent-${String(index).padStart(4, "0")}@example.com`,
      created_at: "2026-11-12T00:00:00.000Z",
    }));
    const range = vi.fn(async (from: number, to: number) => ({
      data: rows.slice(from, to + 1),
      error: null,
      count: from === 0 ? rows.length : null,
    }));
    const builder = {
      select: () => builder,
      in: () => builder,
      order: () => builder,
      range,
    };
    const supabase = { from: () => builder };

    const result = await fetchTaskAssigneeRowsForTaskIds(["task-1"], supabase as never);
    expect(result).toHaveLength(1001);
    expect(result?.at(-1)?.email).toBe("agent-1000@example.com");
    expect(range).toHaveBeenCalledTimes(3);
  });
});
