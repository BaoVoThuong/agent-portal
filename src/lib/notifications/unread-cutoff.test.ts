import { describe, expect, it } from "vitest";
import { countsAsUnread, parseNotificationPageCursor, UNREAD_SINCE } from "./unread-cutoff";

describe("countsAsUnread", () => {
  it("counts unread notifications from the cutoff on", () => {
    expect(countsAsUnread({ is_read: false, created_at: UNREAD_SINCE })).toBe(true);
    expect(countsAsUnread({ is_read: false, created_at: "2026-10-19T14:58:11.446631+00:00" })).toBe(true);
  });

  it("treats older unread notifications and read ones as read", () => {
    expect(countsAsUnread({ is_read: false, created_at: "2026-08-17T13:33:20.253024+00:00" })).toBe(false);
    expect(countsAsUnread({ is_read: true, created_at: "2026-10-19T15:00:00+00:00" })).toBe(false);
  });

  it("compares instants, not strings, across time zones", () => {
    // 2026-10-19 06:00 in Vietnam is 2026-10-18 23:00 UTC: before the cutoff.
    expect(countsAsUnread({ is_read: false, created_at: "2026-10-19T06:00:00+07:00" })).toBe(false);
  });
});

describe("parseNotificationPageCursor", () => {
  const id = "3f1c2a9e-1b2c-4d5e-8f90-1234567890ab";

  it("reads the cursor and sorts skipped ids by table", () => {
    const cursor = parseNotificationPageCursor(
      new URLSearchParams({
        before: "2026-10-19T14:55:19.8876+00:00",
        skip: `task:${id},enrollment:${id},timeoff:${id},provider:${id}`,
      }),
    );
    expect(cursor).toEqual({
      before: "2026-10-19T14:55:19.8876+00:00",
      skip: { task: [id], enrollment: [id], timeoff: [id], provider: [id] },
    });
  });

  it("drops malformed ids and needs a valid time", () => {
    expect(
      parseNotificationPageCursor(new URLSearchParams({ before: "2026-10-19T00:00:00Z", skip: "task:x),or(id.eq.1" })),
    ).toEqual({ before: "2026-10-19T00:00:00Z", skip: { task: [], enrollment: [], timeoff: [], provider: [] } });
    expect(parseNotificationPageCursor(new URLSearchParams({ before: "yesterday" }))).toBeNull();
    expect(parseNotificationPageCursor(new URLSearchParams())).toBeNull();
  });
});
