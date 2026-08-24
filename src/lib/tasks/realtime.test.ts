import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBroadcastMessages,
  broadcastTaskCategoriesChanged,
  broadcastTaskCommentReaction,
  broadcastTaskRoom,
  broadcastTasksChanged,
  notifTopic,
  readTaskMutationSourceId,
  sendBroadcastMessages,
} from "@/lib/tasks/realtime";
import {
  isOwnRealtimeMutation,
  taskReactionTopic,
} from "@/lib/tasks/realtime-topics";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("notifTopic", () => {
  it("is deterministic and normalizes case/whitespace", () => {
    vi.stubEnv("REALTIME_TOPIC_SECRET", "topic-secret");
    expect(notifTopic("a@x.com")).toBe(notifTopic("a@x.com"));
    expect(notifTopic("A@X.com")).toBe(notifTopic("a@x.com"));
    expect(notifTopic("  a@x.com  ")).toBe(notifTopic("a@x.com"));
  });

  it("differs across emails and is prefixed", () => {
    vi.stubEnv("REALTIME_TOPIC_SECRET", "topic-secret");
    expect(notifTopic("a@x.com")).not.toBe(notifTopic("b@x.com"));
    expect(notifTopic("a@x.com").startsWith("notif-")).toBe(true);
  });
});

describe("buildBroadcastMessages", () => {
  it("returns nothing for empty / blank recipients", () => {
    expect(buildBroadcastMessages([])).toEqual([]);
    expect(buildBroadcastMessages(["", ""])).toEqual([]);
  });

  it("dedups recipients and builds content-free messages", () => {
    vi.stubEnv("REALTIME_TOPIC_SECRET", "topic-secret");
    const msgs = buildBroadcastMessages(["a@x.com", "a@x.com", "b@x.com"]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({
      topic: notifTopic("a@x.com"),
      event: "new",
      payload: {},
    });
    expect(msgs.every((m) => m.event === "new")).toBe(true);
    expect(msgs.every((m) => Object.keys(m.payload).length === 0)).toBe(true);
  });

  it("permits the development fallback but rejects missing production secrets", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("REALTIME_TOPIC_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "");
    expect(notifTopic("dev@example.com")).toMatch(/^notif-[0-9a-f]{32}$/);
    expect(warning).toHaveBeenCalledTimes(1);

    vi.stubEnv("NODE_ENV", "production");
    expect(() => notifTopic("prod@example.com")).toThrow(
      "REALTIME_TOPIC_SECRET or AUTH_SECRET must be configured in production."
    );
  });
});

describe("sendBroadcastMessages", () => {
  const message = {
    topic: "tasks-stream",
    event: "changed",
    payload: {},
  };

  it("retries a non-2xx response instead of treating it as delivered", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(
      sendBroadcastMessages([message], { fetcher, retryDelayMs: 0 }),
    ).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("logs a persistent delivery failure without leaking the message", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 500 }));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      sendBroadcastMessages([message], { fetcher, retryDelayMs: 0 }),
    ).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      "[realtime] broadcast failed after 2 attempts",
      { messageCount: 1, failure: "HTTP 500" },
    );
  });

  it("bounds each hanging attempt with a timeout", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const fetcher = vi.fn<typeof fetch>((_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      sendBroadcastMessages([message], {
        fetcher,
        retryDelayMs: 0,
        attemptTimeoutMs: 1,
      }),
    ).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("propagates delivery status through the public wrapper", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 })),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(broadcastTasksChanged()).resolves.toBe(false);
  });
});

describe("task mutation source correlation", () => {
  it("does not reproduce the old missing-id realtime bug", () => {
    const legacyComparison = (local: string | undefined, incoming: unknown) =>
      incoming === local;

    expect(legacyComparison(undefined, undefined)).toBe(true);
    expect(isOwnRealtimeMutation(undefined, undefined)).toBe(false);
    expect(isOwnRealtimeMutation("source-a", "source-a")).toBe(true);
    expect(isOwnRealtimeMutation("source-a", "source-b")).toBe(false);
  });

  it("accepts a bounded opaque source id", () => {
    const request = new Request("https://example.test", {
      headers: { "x-task-client-source": "task-board:abc:123" },
    });
    expect(readTaskMutationSourceId(request)).toBe("task-board:abc:123");
  });

  it("rejects malformed or oversized source ids", () => {
    const malformed = new Request("https://example.test", {
      headers: { "x-task-client-source": "task board" },
    });
    const oversized = new Request("https://example.test", {
      headers: { "x-task-client-source": "a".repeat(129) },
    });
    expect(readTaskMutationSourceId(malformed)).toBeUndefined();
    expect(readTaskMutationSourceId(oversized)).toBeUndefined();
  });

  it("puts the source id in a task broadcast payload", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await expect(broadcastTasksChanged("board-a")).resolves.toBe(true);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.messages[0].payload).toEqual({ sourceId: "board-a" });
  });

  it("puts the source id in a task room payload", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await expect(broadcastTaskRoom("task-1", "drawer-a")).resolves.toBe(true);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.messages[0].payload).toEqual({ sourceId: "drawer-a" });
  });
});

describe("comment reaction broadcasts", () => {
  it("uses the shared reaction topic and carries no reaction data", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await expect(broadcastTaskCommentReaction("task-1")).resolves.toBe(true);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.messages).toEqual([
      {
        topic: taskReactionTopic("task-1"),
        event: "reaction",
        payload: {},
      },
    ]);
  });

  it("carries a source id when available so the originating tab can skip its echo", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await expect(broadcastTaskCommentReaction("task-1", "source-a")).resolves.toBe(true);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.messages[0].payload).toEqual({ sourceId: "source-a" });
  });
});

describe("category broadcasts", () => {
  it("uses a dedicated topic so task changes do not reload categories", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await expect(broadcastTaskCategoriesChanged()).resolves.toBe(true);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.messages).toEqual([
      {
        topic: "task-categories-stream",
        event: "changed",
        payload: {},
      },
    ]);
  });
});
