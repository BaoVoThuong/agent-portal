import { afterEach, describe, it, expect, vi } from "vitest";
import {
  assertTaskListComplete,
  fetchTaskListMetadata,
  isMissingTaskListMetadataRpc,
  TaskListTruncatedError,
} from "./queries";

afterEach(() => {
  vi.doUnmock("@/lib/supabase");
  vi.doUnmock("./assignees");
  vi.doUnmock("./membership");
  vi.doUnmock("./participants");
  vi.resetModules();
});

describe("isMissingTaskListMetadataRpc", () => {
  it("treats PostgREST 'function not found' (PGRST202) as missing", () => {
    expect(isMissingTaskListMetadataRpc({ code: "PGRST202" })).toBe(true);
  });

  it("treats a 'could not find function' message as missing", () => {
    expect(
      isMissingTaskListMetadataRpc({
        message:
          "Could not find the function public.task_list_metadata(task_ids) in the schema cache",
      })
    ).toBe(true);
  });

  it("treats a 'does not exist' message naming the function as missing", () => {
    expect(
      isMissingTaskListMetadataRpc({
        message: 'function task_list_metadata(uuid[]) does not exist',
      })
    ).toBe(true);
  });

  it("does NOT treat an unrelated error as missing (so real failures still surface)", () => {
    expect(
      isMissingTaskListMetadataRpc({ code: "42P01", message: "some other table missing" })
    ).toBe(false);
    expect(isMissingTaskListMetadataRpc({ message: "permission denied" })).toBe(false);
    expect(isMissingTaskListMetadataRpc(null)).toBe(false);
  });
});

describe("fetchTaskListMetadata", () => {
  it("returns canonical counters and latest actor from the metadata RPC", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          task_id: "task-1",
          last_activity_by_email: "owner@example.com",
          comment_count: 3,
          attachment_count: 2,
        },
      ],
      error: null,
    }));

    const rows = await fetchTaskListMetadata(["task-1"], { rpc } as never);

    expect(rpc).toHaveBeenCalledWith("task_list_metadata", {
      task_ids: ["task-1"],
    });
    expect(rows).toEqual([
      {
        task_id: "task-1",
        last_activity_by_email: "owner@example.com",
        comment_count: 3,
        attachment_count: 2,
      },
    ]);
  });

  it("bounds metadata RPC payloads for a large task queue", async () => {
    const taskIds = Array.from({ length: 1001 }, (_, index) => `task-${index}`);
    const rpc = vi.fn(async (_name: string, args: { task_ids: string[] }) => ({
      data: args.task_ids.map((task_id) => ({
        task_id,
        last_activity_by_email: null,
        comment_count: 0,
        attachment_count: 0,
      })),
      error: null,
    }));

    const rows = await fetchTaskListMetadata(taskIds, { rpc } as never);

    // 1.001 id / chùm 500 = 3 lượt. Kích thước chùm là đòn bẩy giảm số lượt
    // đi-về: khối lượng DB không đổi (mỗi id là hai subquery có index), nên
    // chùm nhỏ chỉ tốn thêm round-trip chứ không đỡ được gì.
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(
      Math.max(
        ...rpc.mock.calls.map(([, args]) => args.task_ids.length),
      ),
    ).toBeLessThanOrEqual(500);
    expect(rows).toHaveLength(taskIds.length);
    expect(rows.map((row) => row.task_id)).toEqual(taskIds);
  });
});

describe("assertTaskListComplete", () => {
  it("fails closed when PostgREST returns fewer rows than the exact count", () => {
    expect(() => assertTaskListComplete([{ id: "task-1" }], 2)).toThrow(
      TaskListTruncatedError
    );
    try {
      assertTaskListComplete([{ id: "task-1" }], 2);
    } catch (error) {
      expect(error).toMatchObject({ total: 2, loaded: 1 });
    }
  });

  it("accepts complete and countless responses", () => {
    expect(() => assertTaskListComplete([{ id: "task-1" }], 1)).not.toThrow();
    expect(() => assertTaskListComplete([{ id: "task-1" }], null)).not.toThrow();
    expect(() => assertTaskListComplete(null, undefined)).not.toThrow();
  });
});

const row = (id: string) => ({ id, custom_values: {}, assignees: [] });

describe("fetchTasksForActor keyset paging", () => {
  const manager = { email: "mgr@x.com", isManager: true, isWorker: true };

  it("asks for an exact count on the FIRST page only", async () => {
    // Xin count ở mọi trang là chạy lại COUNT(*) trên toàn bộ tập đã lọc cho
    // từng trang — cùng một câu trả lời, trả tiền nhiều lần.
    const { fetchTasksForActor, selectCalls } = await loadFetchTasksForActor({
      selectedAgentEmails: [],
      assistantAgents: [],
      pages: [
        { data: [row("a"), row("b")], error: null, count: 3 },
        { data: [row("c")], error: null },
      ],
    });
    await fetchTasksForActor(manager as never);
    const withCount = selectCalls.filter(
      ([, opts]) => (opts as { count?: string } | undefined)?.count === "exact",
    );
    expect(withCount).toHaveLength(1);
  });

  it("walks pages with a keyset cursor, not an offset", async () => {
    const { fetchTasksForActor, gtCalls } = await loadFetchTasksForActor({
      selectedAgentEmails: [],
      assistantAgents: [],
      pages: [
        { data: [row("a"), row("b")], error: null, count: 3 },
        { data: [row("c")], error: null },
      ],
    });
    const result = await fetchTasksForActor(manager as never);
    expect(result.tasks.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(false);
    // Trang hai phải hỏi `id > <id cuối trang một>`, không phải một offset.
    expect(gtCalls).toEqual([["id", "b"]]);
  });

  it("reports truncated when the server has more than it returned", async () => {
    const { fetchTasksForActor } = await loadFetchTasksForActor({
      selectedAgentEmails: [],
      assistantAgents: [],
      pages: [
        { data: [row("a")], error: null, count: 9 },
        { data: [], error: null },
      ],
    });
    const result = await fetchTasksForActor(manager as never);
    expect(result.tasks).toHaveLength(1);
    expect(result.total).toBe(9);
    expect(result.truncated).toBe(true);
  });

  // A8: phạm vi phải được áp lên MỌI trang, không chỉ trang đầu. Thiếu nó thì
  // trang hai trở đi trả về task của cả công ty cho một người bị giới hạn.
  it("applies the same database scope to every page", async () => {
    const { fetchTasksForActor, orCalls, workerScopeCalls, fromCalls } =
      await loadFetchTasksForActor({
        selectedAgentEmails: ["cs@x.com"],
        assistantAgents: [],
        pages: [
          { data: [row("a")], error: null, count: 2 },
          { data: [row("b")], error: null },
        ],
      });
    await fetchTasksForActor({
      email: "cs@x.com",
      isManager: false,
      isWorker: true,
    } as never);
    expect(workerScopeCalls).toHaveLength(2);
    expect(workerScopeCalls.map(([, args]) => args)).toEqual([
      { p_email: "cs@x.com", p_agent_emails: [] },
      { p_email: "cs@x.com", p_agent_emails: [] },
    ]);
    // Đếm chính xác chỉ ở trang đầu, như nhánh không phạm vi.
    expect(workerScopeCalls.map(([, , options]) => options)).toEqual([
      { count: "exact" },
      {},
    ]);
    expect(orCalls).toEqual([]);
    // Only the participant lookup for the loaded rows reads a table directly.
    expect(fromCalls).toEqual(["task_participants"]);
  });

  // A6: enrich metadata không được thả hết chùm cùng lúc.
  it("chunks metadata rpc calls to at most the configured chunk size", async () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `id-${String(i).padStart(4, "0")}`);
    const { fetchTasksForActor, rpcCalls } = await loadFetchTasksForActor({
      selectedAgentEmails: [],
      assistantAgents: [],
      pages: [
        { data: ids.map(row), error: null, count: 120 },
        { data: [], error: null },
      ],
    });
    await fetchTasksForActor(manager as never);
    expect(rpcCalls.length).toBeGreaterThan(1);
    for (const [, args] of rpcCalls) {
      expect((args as { task_ids: string[] }).task_ids.length).toBeLessThanOrEqual(500);
    }
  });
});

describe("fetchTasksForActor view scope", () => {
  it("does not scope plain-CS workers", async () => {
    const { fetchTasksForActor, orCalls, workerScopeCalls, fromCalls } =
      await loadFetchTasksForActor({
        selectedAgentEmails: [],
        assistantAgents: [],
      });

    await fetchTasksForActor({
      email: "cs@example.com",
      isManager: false,
      isWorker: true,
    });

    expect(workerScopeCalls).toEqual([]);
    expect(fromCalls).toEqual(["tasks"]);
    expect(orCalls).toEqual([]);
  });

  it("does not scope managers", async () => {
    const { fetchTasksForActor, workerScopeCalls, fromCalls } =
      await loadFetchTasksForActor({
        selectedAgentEmails: ["mgr@example.com"],
        assistantAgents: [],
      });

    await fetchTasksForActor({
      email: "mgr@example.com",
      isManager: true,
      isWorker: true,
    });

    expect(workerScopeCalls).toEqual([]);
    expect(fromCalls).toEqual(["tasks"]);
  });

  it("keeps agent workers scoped in the database", async () => {
    const { fetchTasksForActor, workerScopeCalls, selectCalls } =
      await loadFetchTasksForActor({
        selectedAgentEmails: ["agent@example.com"],
        assistantAgents: [],
      });

    await fetchTasksForActor({
      email: "agent@example.com",
      isManager: false,
      isWorker: true,
    });

    expect(workerScopeCalls[0]?.[1]).toEqual({
      p_email: "agent@example.com",
      p_agent_emails: [],
    });
    // No embed on the RPC: PostgREST applied an embedded filter to the function
    // itself ("column pgrst_call.email does not exist").
    expect(String(selectCalls[0]?.[0])).not.toContain("task_participants");
  });

  it("keeps assistant workers scoped to their Agents", async () => {
    const { fetchTasksForActor, workerScopeCalls } = await loadFetchTasksForActor({
      selectedAgentEmails: [],
      assistantAgents: ["agent@example.com"],
    });

    await fetchTasksForActor({
      email: "assistant@example.com",
      isManager: false,
      isWorker: true,
    });

    expect(workerScopeCalls[0]?.[1]).toEqual({
      p_email: "assistant@example.com",
      p_agent_emails: ["agent@example.com"],
    });
  });

  // 2026-10-16: 155 id (6.246 byte) trong URL làm Task Board sập. Nay không id
  // nào rời server, lịch sử dài bao nhiêu cũng vậy.
  it("never loads or sends the assignment/participant history", async () => {
    const { fetchTasksForActor, orCalls, assignedIdsLoader, participantIdsLoader } =
      await loadFetchTasksForActor({
        selectedAgentEmails: ["agent@example.com"],
        assistantAgents: [],
      });

    await expect(
      fetchTasksForActor({
        email: "agent@example.com",
        isManager: false,
        isWorker: true,
      })
    ).resolves.toMatchObject({ truncated: false });

    expect(orCalls).toEqual([]);
    expect(assignedIdsLoader).not.toHaveBeenCalled();
    expect(participantIdsLoader).not.toHaveBeenCalled();
  });

  it("keeps a task the worker only sees as a participant, and flags it", async () => {
    const { fetchTasksForActor, participantLookups } = await loadFetchTasksForActor({
      selectedAgentEmails: ["agent@example.com"],
      assistantAgents: [],
      participantTaskIds: ["mentioned"],
      pages: [
        {
          data: [
            { ...row("mentioned"), agent_email: "other-agent@example.com" },
            { ...row("own"), agent_email: "agent@example.com" },
          ],
          error: null,
          count: 2,
        },
      ],
    });

    const result = await fetchTasksForActor({
      email: "agent@example.com",
      isManager: false,
      isWorker: true,
    });

    expect(
      result.tasks.map((task) => [task.id, task.viewer_is_participant])
    ).toEqual([
      ["mentioned", true],
      ["own", false],
    ]);
    // Asked only about the loaded tasks, for this viewer.
    expect(participantLookups).toEqual([
      { email: "agent@example.com", taskIds: ["mentioned", "own"] },
    ]);
  });

  it("asks about participants 300 task ids at a time", async () => {
    const ids = Array.from({ length: 650 }, (_, i) => `id-${String(i).padStart(4, "0")}`);
    const { fetchTasksForActor, participantLookups } = await loadFetchTasksForActor({
      selectedAgentEmails: ["agent@example.com"],
      assistantAgents: [],
      pages: [{ data: ids.map(row), error: null, count: 650 }],
    });

    await fetchTasksForActor({
      email: "agent@example.com",
      isManager: false,
      isWorker: true,
    });

    expect(participantLookups.map((lookup) => lookup.taskIds.length)).toEqual([300, 300, 50]);
  });
});

type HarnessPage = { data: unknown[]; error: null; count?: number };

async function loadFetchTasksForActor(options: {
  selectedAgentEmails: string[];
  assistantAgents: string[];
  pages?: HarnessPage[];
  /** task_participants rows for the viewer. */
  participantTaskIds?: string[];
}) {
  const { selectedAgentEmails, assistantAgents } = options;
  vi.resetModules();
  const orCalls: string[] = [];
  const selectCalls: unknown[][] = [];
  const eqCalls: unknown[][] = [];
  const gtCalls: unknown[][] = [];
  // Mỗi lượt `then` trả về một trang. Mặc định một trang rỗng = danh sách rỗng.
  const pages: { data: unknown[]; error: null; count?: number }[] =
    options.pages ?? [{ data: [], error: null, count: 0 }];
  let pageIndex = 0;
  const builder = {
    select: vi.fn((...args: unknown[]) => {
      selectCalls.push(args);
      return builder;
    }),
    is: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    gt: vi.fn((...args: unknown[]) => {
      gtCalls.push(args);
      return builder;
    }),
    or: vi.fn((value: string) => {
      orCalls.push(value);
      return builder;
    }),
    eq: vi.fn((...args: unknown[]) => {
      eqCalls.push(args);
      return builder;
    }),
    then: (resolve: (value: { data: unknown[]; error: null }) => void) => {
      const page = pages[Math.min(pageIndex, pages.length - 1)];
      pageIndex += 1;
      return resolve(page);
    },
  };
  const rpcCalls: unknown[][] = [];
  const workerScopeCalls: unknown[][] = [];
  const fromCalls: string[] = [];
  const participantLookups: Array<{ email: unknown; taskIds: string[] }> = [];
  const participantsBuilder = () => {
    const lookup = { email: undefined as unknown, taskIds: [] as string[] };
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((_column: string, value: unknown) => {
        lookup.email = value;
        return query;
      }),
      in: vi.fn((_column: string, taskIds: string[]) => {
        lookup.taskIds = taskIds;
        return query;
      }),
      then: (resolve: (value: { data: unknown[]; error: null }) => void) => {
        participantLookups.push(lookup);
        return resolve({
          data: lookup.taskIds
            .filter((taskId) => (options.participantTaskIds ?? []).includes(taskId))
            .map((task_id) => ({ task_id })),
          error: null,
        });
      },
    };
    return query;
  };
  const supabase = {
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      return table === "task_participants" ? participantsBuilder() : builder;
    }),
    rpc: vi.fn((...args: unknown[]) => {
      // The scope RPC returns rows like a table query, so it keeps chaining.
      if (args[0] === "tasks_visible_to_worker") {
        workerScopeCalls.push(args);
        return builder;
      }
      rpcCalls.push(args);
      return Promise.resolve({ data: [], error: null });
    }),
  };
  const assignedIdsLoader = vi.fn(async () => []);
  const participantIdsLoader = vi.fn(async () => []);

  vi.doMock("@/lib/supabase", () => ({
    getSupabaseAdmin: () => supabase,
  }));
  vi.doMock("./assignees", () => ({
    attachAssigneesToTasks: vi.fn(async (tasks: unknown[]) => tasks),
    fetchAssignedTaskIdsForEmail: assignedIdsLoader,
    fetchSelectedAgentEmails: vi.fn(async () => new Set(selectedAgentEmails)),
  }));
  vi.doMock("./membership", () => ({
    fetchAgentsForCs: vi.fn(async () => assistantAgents),
    fetchAssistantAgentsForCs: vi.fn(async () => assistantAgents),
    resolveTaskQueueScope: vi.fn(async (actor: { email: string; isManager: boolean; isWorker: boolean }) => ({
      agentEmails: assistantAgents,
      assistantAgentEmails: assistantAgents,
      seesAllTasks:
        !actor.isManager &&
        actor.isWorker &&
        !selectedAgentEmails.includes(actor.email) &&
        assistantAgents.length === 0,
    })),
  }));
  vi.doMock("./participants", () => ({
    fetchParticipantTaskIds: participantIdsLoader,
    isMissingTaskParticipantsError: () => false,
  }));

  const queriesModule = await import("./queries");
  return {
    fetchTasksForActor: queriesModule.fetchTasksForActor,
    orCalls,
    selectCalls,
    eqCalls,
    gtCalls,
    rpcCalls,
    workerScopeCalls,
    fromCalls,
    assignedIdsLoader,
    participantIdsLoader,
    participantLookups,
  };
}
