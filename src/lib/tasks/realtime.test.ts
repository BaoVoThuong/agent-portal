import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBroadcastMessages, notifTopic } from "@/lib/tasks/realtime";

afterEach(() => {
  vi.unstubAllEnvs();
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
