import { describe, expect, it, vi } from "vitest";

// A worker who sees none of the matching tasks: the worst case for search,
// where every candidate page is read and then filtered out.
const worker = { email: "cs@x.com", isManager: false, isWorker: true };

const hiddenTask = (index: number) => ({
  id: `task-${String(index).padStart(5, "0")}`,
  display_number: index,
  title: `Invoice ${index}`,
  agent_email: "other@x.com",
  assignee_email: "other@x.com",
  reporter_email: "other@x.com",
  status: "todo",
  archived_at: null,
});

async function loadSearch(matchingTasks: number) {
  vi.resetModules();
  const taskPageOffsets: number[] = [];
  const supabase = {
    from: (table: string) => {
      const state = { search: false, offset: 0, size: 0, ids: [] as string[] };
      const builder = {
        select: () => builder,
        ilike: () => {
          state.search = true;
          return builder;
        },
        is: () => builder,
        order: () => builder,
        in: (_column: string, ids: string[]) => {
          state.ids = ids;
          return builder;
        },
        range: (from: number, to: number) => {
          state.offset = from;
          state.size = to - from + 1;
          return builder;
        },
        then: (resolve: (value: { data: unknown[]; error: null }) => void) => {
          if (state.search && table === "tasks") {
            taskPageOffsets.push(state.offset);
            const end = Math.min(matchingTasks, state.offset + state.size);
            const data = [];
            for (let index = state.offset; index < end; index += 1) data.push(hiddenTask(index));
            return resolve({ data, error: null });
          }
          if (!state.search && table === "tasks") {
            // Visibility metadata for the candidates on the current page.
            return resolve({
              data: state.ids.map((id) => hiddenTask(Number(id.slice("task-".length)))),
              error: null,
            });
          }
          // Comment and file matches, and the assignee lookup: none.
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  };

  vi.doMock("@/lib/supabase", () => ({ getSupabaseAdmin: () => supabase }));
  vi.doMock("./membership", () => ({
    resolveTaskQueueScope: vi.fn(async () => ({
      agentEmails: [],
      assistantAgentEmails: [],
      seesAllTasks: false,
    })),
  }));
  vi.doMock("./assignees", () => ({ fetchAssignedTaskIdsForEmail: vi.fn(async () => []) }));
  vi.doMock("./participants", () => ({ fetchParticipantTaskIds: vi.fn(async () => []) }));

  const search = await import("./search");
  return { ...search, taskPageOffsets };
}

describe("runTaskSearch candidate ceiling", () => {
  it("stops after MAX_SEARCH_SCAN hidden candidates and reports truncated", async () => {
    // Without the ceiling a common query walks every matching task: 5,000
    // hidden tasks would be 100 pages, each costing three queries.
    const { runTaskSearch, MAX_SEARCH_SCAN, taskPageOffsets } = await loadSearch(5_000);

    const results = await runTaskSearch(worker, "invoice");

    expect(MAX_SEARCH_SCAN).toBe(1000);
    expect(taskPageOffsets).toHaveLength(MAX_SEARCH_SCAN / 50);
    expect(taskPageOffsets.at(-1)).toBe(MAX_SEARCH_SCAN - 50);
    expect(results.tasks).toEqual([]);
    expect(results.truncated.tasks).toBe(true);
  });

  it("reads every candidate below the ceiling and is not truncated", async () => {
    const { runTaskSearch, taskPageOffsets } = await loadSearch(120);

    const results = await runTaskSearch(worker, "invoice");

    expect(taskPageOffsets).toEqual([0, 50, 100]);
    expect(results.truncated.tasks).toBe(false);
  });
});
