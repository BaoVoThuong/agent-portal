import { describe, expect, it } from "vitest";
import { intervalDue, isDueSoon, isStale } from "@/lib/tasks/reminders";

const rules = [
  {
    priority: "urgent" as const,
    category_id: null,
    duration_minutes: 60,
  },
];
const base = {
  status: "in_progress" as const,
  in_progress_at: "2026-07-05T00:00:00.000Z",
  priority: "urgent" as const,
  category_id: null,
  sla_minutes: 60,
  in_progress_seconds: 0,
  overdue_count: 0,
};

describe("intervalDue", () => {
  const now = new Date("2026-07-05T10:00:00.000Z");

  it("true when never sent", () => {
    expect(intervalDue(null, 3600e3, now)).toBe(true);
  });

  it("false within the interval", () => {
    expect(intervalDue("2026-07-05T09:30:00.000Z", 3600e3, now)).toBe(
      false
    );
  });

  it("true once the interval has elapsed", () => {
    expect(intervalDue("2026-07-05T08:00:00.000Z", 3600e3, now)).toBe(
      true
    );
  });
});

describe("isDueSoon", () => {
  it("true inside the lead window before breach", () => {
    expect(
      isDueSoon(base, rules, 15, new Date("2026-07-05T00:50:00.000Z"))
    ).toBe(true);
  });

  it("false when already overdue", () => {
    expect(
      isDueSoon(base, rules, 15, new Date("2026-07-05T01:05:00.000Z"))
    ).toBe(false);
  });

  it("false when the SLA isn't active (post-Waiting / post-overdue)", () => {
    expect(
      isDueSoon(
        { ...base, overdue_count: 1 },
        rules,
        15,
        new Date("2026-07-05T00:50:00.000Z")
      )
    ).toBe(false);
  });
});

describe("isStale", () => {
  const now = new Date("2026-07-05T00:00:00.000Z");

  it("true when a live task has had no activity past the threshold", () => {
    expect(
      isStale(
        { status: "todo", last_activity_at: "2026-07-02T00:00:00.000Z" },
        48,
        now
      )
    ).toBe(true);
  });

  it("false for done/cancel/backlog", () => {
    expect(
      isStale(
        { status: "done", last_activity_at: "2026-01-01T00:00:00.000Z" },
        48,
        now
      )
    ).toBe(false);
    expect(
      isStale(
        { status: "backlog", last_activity_at: "2026-01-01T00:00:00.000Z" },
        48,
        now
      )
    ).toBe(false);
  });

  it("false within the threshold", () => {
    expect(
      isStale(
        { status: "todo", last_activity_at: "2026-07-04T18:00:00.000Z" },
        48,
        now
      )
    ).toBe(false);
  });
});
