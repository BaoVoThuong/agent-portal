import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBroadcastMessages,
  broadcastTasksChanged,
  notifTopic,
  readTaskMutationSourceId,
  sendBroadcastMessages,
} from "@/lib/tasks/realtime";

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
});
