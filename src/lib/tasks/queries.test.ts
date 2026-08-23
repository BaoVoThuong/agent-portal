import { afterEach, describe, it, expect, vi } from "vitest";
import {
  assertTaskListComplete,
  fetchTaskListMetadata,
  isMissingTaskListMetadataRpc,
  quotePostgrestFilterValue,
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
    const taskIds = Array.from({ length: 101 }, (_, index) => `task-${index}`);
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

    expect(rpc).toHaveBeenCalledTimes(3);
    expect(
      Math.max(
        ...rpc.mock.calls.map(([, args]) => args.task_ids.length),
      ),
    ).toBeLessThanOrEqual(50);
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

describe("quotePostgrestFilterValue", () => {
  it("escapes grammar delimiters while keeping the value quoted", () => {
    expect(quotePostgrestFilterValue('a"x\\@b.com,role.eq.admin')).toBe(
      '"a\\"x\\\\@b.com,role.eq.admin"'
    );
  });
});

describe("fetchTasksForActor view scope", () => {
  it("does not scope plain-CS workers", async () => {
    const { fetchTasksForActor, orCalls } = await loadFetchTasksForActor({
      selectedAgentEmails: [],
      assistantAgents: [],
    });

    await fetchTasksForActor({
      email: "cs@example.com",
      isManager: false,
      isWorker: true,
    });

    expect(orCalls).toEqual([]);
  });

  it("keeps agent workers scoped", async () => {
    const { fetchTasksForActor, orCalls } = await loadFetchTasksForActor({
      selectedAgentEmails: ["agent@example.com"],
      assistantAgents: [],
    });

    await fetchTasksForActor({
      email: "agent@example.com",
      isManager: false,
      isWorker: true,
    });

    expect(orCalls.length).toBeGreaterThan(0);
    expect(orCalls[0]).toContain('reporter_email.eq."agent@example.com"');
  });

  it("keeps assistant workers scoped", async () => {
    const { fetchTasksForActor, orCalls } = await loadFetchTasksForActor({
      selectedAgentEmails: [],
      assistantAgents: ["agent@example.com"],
    });

    await fetchTasksForActor({
      email: "assistant@example.com",
      isManager: false,
      isWorker: true,
    });

    expect(orCalls.length).toBeGreaterThan(0);
  });
});

async function loadFetchTasksForActor({
  selectedAgentEmails,
  assistantAgents,
}: {
  selectedAgentEmails: string[];
  assistantAgents: string[];
}) {
  vi.resetModules();
  const orCalls: string[] = [];
  const builder = {
    select: vi.fn(() => builder),
    is: vi.fn(() => builder),
    order: vi.fn(() => builder),
    or: vi.fn((value: string) => {
      orCalls.push(value);
      return builder;
    }),
    eq: vi.fn(() => builder),
    then: (resolve: (value: { data: unknown[]; error: null }) => void) =>
      resolve({ data: [], error: null }),
  };
  const supabase = {
    from: vi.fn(() => builder),
  };

  vi.doMock("@/lib/supabase", () => ({
    getSupabaseAdmin: () => supabase,
  }));
  vi.doMock("./assignees", () => ({
    attachAssigneesToTasks: vi.fn(async (tasks: unknown[]) => tasks),
    fetchAssignedTaskIdsForEmail: vi.fn(async () => []),
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
    fetchParticipantTaskIds: vi.fn(async () => []),
  }));

  const queriesModule = await import("./queries");
  return { fetchTasksForActor: queriesModule.fetchTasksForActor, orCalls };
}
