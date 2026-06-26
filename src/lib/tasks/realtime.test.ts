import { describe, expect, it } from "vitest";
import { buildBroadcastMessages, notifTopic } from "@/lib/tasks/realtime";

describe("notifTopic", () => {
  it("is deterministic and normalizes case/whitespace", () => {
    expect(notifTopic("a@x.com")).toBe(notifTopic("a@x.com"));
    expect(notifTopic("A@X.com")).toBe(notifTopic("a@x.com"));
    expect(notifTopic("  a@x.com  ")).toBe(notifTopic("a@x.com"));
  });

  it("differs across emails and is prefixed", () => {
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
});
