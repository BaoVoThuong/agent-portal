import { describe, expect, it } from "vitest";
import { assigneesAfter, fetchTaskAssigneeRowsForTaskIds } from "./assignees";

type Row = { task_id: string; email: string; created_at: string };

const assignee = (taskId: string, index: number): Row => ({
  task_id: taskId,
  email: `agent-${String(index).padStart(4, "0")}@example.com`,
  created_at: "2026-11-12T00:00:00.000Z",
});

const byKey = (a: Row, b: Row) =>
  a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : a.email < b.email ? -1 : a.email > b.email ? 1 : 0;

const CURSOR = /^task_id\.gt\.([^,]+),and\(task_id\.eq\.\1,email\.gt\."((?:[^"\\]|\\.)*)"\)$/;

/**
 * task_assignees as PostgREST serves it: (task_id, email) order, responses cut
 * at `serverCap`, and the keyset `or` filter the reader sends. `onRequest`
 * runs after each response, to change the table between pages.
 */
function assigneeTable(rows: Row[], options: { serverCap?: number; onRequest?: (n: number) => void } = {}) {
  const table = [...rows];
  const requests: Array<{ cursor: string | null; withCount: boolean; limit: number }> = [];
  const supabase = {
    from: () => {
      const state = { cursor: null as string | null, withCount: false, limit: Infinity, ids: [] as string[] };
      const builder = {
        select: (_columns: string, opts?: { count?: string }) => {
          state.withCount = opts?.count === "exact";
          return builder;
        },
        in: (_column: string, ids: string[]) => {
          state.ids = ids;
          return builder;
        },
        or: (filter: string) => {
          state.cursor = filter;
          return builder;
        },
        order: () => builder,
        limit: (n: number) => {
          state.limit = n;
          return builder;
        },
        then: (resolve: (value: unknown) => void) => {
          requests.push({ cursor: state.cursor, withCount: state.withCount, limit: state.limit });
          let matching = table.filter((row) => state.ids.includes(row.task_id)).sort(byKey);
          const total = matching.length;
          if (state.cursor) {
            const match = CURSOR.exec(state.cursor);
            if (!match) throw new Error(`unexpected cursor filter: ${state.cursor}`);
            const after = { task_id: match[1], email: match[2].replace(/\\(.)/g, "$1") } as Row;
            matching = matching.filter((row) => byKey(row, after) > 0);
          }
          const data = matching.slice(0, Math.min(state.limit, options.serverCap ?? 1000));
          const response = { data, error: null, count: state.withCount ? total : null };
          options.onRequest?.(requests.length);
          return resolve(response);
        },
      };
      return builder;
    },
  };
  return { supabase: supabase as never, table, requests };
}

describe("fetchTaskAssigneeRowsForTaskIds", () => {
  it("reads past the server cap by (task_id, email) keyset", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => assignee("task-1", index));
    const { supabase, requests } = assigneeTable(rows);

    const result = await fetchTaskAssigneeRowsForTaskIds(["task-1"], supabase);

    expect(result).toHaveLength(1001);
    expect(new Set(result?.map((row) => row.email)).size).toBe(1001);
    expect(requests.map((request) => request.withCount)).toEqual([true, false, false]);
    expect(requests[1].cursor).toBe(assigneesAfter(assignee("task-1", 499)));
  });

  it("continues inside a task when a page ends mid-task", async () => {
    const rows = [
      ...Array.from({ length: 300 }, (_, index) => assignee("task-a", index)),
      ...Array.from({ length: 300 }, (_, index) => assignee("task-b", index)),
    ];
    const { supabase, requests } = assigneeTable(rows);

    const result = await fetchTaskAssigneeRowsForTaskIds(["task-a", "task-b"], supabase);

    expect(result).toHaveLength(600);
    expect(requests).toHaveLength(2);
    expect(requests[1].cursor).toBe(assigneesAfter(assignee("task-b", 199)));
  });

  it("an assignee removed between pages is not skipped over and does not fail the read", async () => {
    // OFFSET shifted every later row back by one here, skipped one, and the
    // count check then threw "Task assignee read incomplete".
    const rows = Array.from({ length: 600 }, (_, index) => assignee("task-1", index));
    const fake = assigneeTable(rows, {
      onRequest: (n) => {
        if (n === 1) fake.table.splice(fake.table.findIndex((row) => row.email === "agent-0550@example.com"), 1);
      },
    });

    const result = await fetchTaskAssigneeRowsForTaskIds(["task-1"], fake.supabase);

    const emails = result?.map((row) => row.email) ?? [];
    expect(emails).toHaveLength(599);
    expect(emails).toContain("agent-0500@example.com");
    expect(emails).toContain("agent-0599@example.com");
    expect(emails).not.toContain("agent-0550@example.com");
  });

  it("an assignee added between pages is not read twice", async () => {
    const rows = Array.from({ length: 600 }, (_, index) => assignee("task-1", index));
    const fake = assigneeTable(rows, {
      onRequest: (n) => {
        if (n === 1) fake.table.push({ ...assignee("task-1", 0), email: "agent-0000a@example.com" });
      },
    });

    const result = await fetchTaskAssigneeRowsForTaskIds(["task-1"], fake.supabase);

    const emails = result?.map((row) => row.email) ?? [];
    expect(new Set(emails).size).toBe(emails.length);
    expect(emails).toContain("agent-0599@example.com");
  });
});

describe("assigneesAfter", () => {
  it("quotes the email so it cannot change the filter grammar", () => {
    expect(assigneesAfter({ task_id: "t-1", email: 'a"b\\c,(d)@x.com' })).toBe(
      'task_id.gt.t-1,and(task_id.eq.t-1,email.gt."a\\"b\\\\c,(d)@x.com")'
    );
  });
});
