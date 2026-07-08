import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLA_MINUTES,
  formatDurationMinutes,
  effectiveSlaMinutes,
  formatElapsedSince,
  formatSlaRemaining,
  isTaskOverdue,
  resolveSlaMinutes,
  slaDeadline,
} from "@/lib/tasks/sla";

const rules = [
  { priority: "urgent" as const, category_id: null, duration_minutes: 60 },
  { priority: "urgent" as const, category_id: "billing", duration_minutes: 15 },
  { priority: "low" as const, category_id: null, duration_minutes: 1440 },
];

describe("resolveSlaMinutes", () => {
  it("exact priority+category match wins", () => {
    expect(resolveSlaMinutes("urgent", "billing", rules)).toBe(15);
  });
  it("falls back to the priority default when category has no override", () => {
    expect(resolveSlaMinutes("urgent", "support", rules)).toBe(60);
    expect(resolveSlaMinutes("urgent", null, rules)).toBe(60);
  });
  it("falls back to the hardcoded default when no rules loaded", () => {
    expect(resolveSlaMinutes("high", null, [])).toBe(DEFAULT_SLA_MINUTES.high);
  });
});

describe("effectiveSlaMinutes", () => {
  it("prefers the locked-in snapshot over recomputing from current priority/category", () => {
    // Task's priority now says "low" (1440m), but it started as "urgent" and
    // locked in 60m — that snapshot must win, otherwise editing priority
    // after the fact silently un-overdues it.
    expect(
      effectiveSlaMinutes(
        { priority: "low", category_id: null, sla_minutes: 60 },
        rules
      )
    ).toBe(60);
  });
  it("falls back to live resolution when there is no snapshot yet", () => {
    expect(
      effectiveSlaMinutes(
        { priority: "urgent", category_id: null, sla_minutes: null },
        rules
      )
    ).toBe(60);
  });
});

describe("isTaskOverdue with a locked-in sla_minutes snapshot", () => {
  it("stays overdue even if priority is edited down afterwards (anti-gaming)", () => {
    const startedUrgent = {
      status: "in_progress" as const,
      in_progress_at: "2026-07-05T00:00:00.000Z",
      priority: "low" as const, // edited down after the fact
      category_id: null,
      sla_minutes: 60, // locked in while it was still "urgent"
    };
    const now = new Date("2026-07-05T02:00:00.000Z");
    expect(isTaskOverdue(startedUrgent, rules, now)).toBe(true);
  });
});

describe("slaDeadline", () => {
  it("adds minutes to in_progress_at", () => {
    const deadline = slaDeadline("2026-07-05T00:00:00.000Z", 90);
    expect(deadline.toISOString()).toBe("2026-07-05T01:30:00.000Z");
  });
});

describe("isTaskOverdue", () => {
  const base = {
    status: "in_progress" as const,
    in_progress_at: "2026-07-05T00:00:00.000Z",
    priority: "urgent" as const,
    category_id: null,
  };
  it("not overdue before the deadline", () => {
    const now = new Date("2026-07-05T00:59:00.000Z");
    expect(isTaskOverdue(base, rules, now)).toBe(false);
  });
  it("overdue exactly at the deadline (boundary counts as overdue)", () => {
    const now = new Date("2026-07-05T01:00:00.000Z");
    expect(isTaskOverdue(base, rules, now)).toBe(true);
  });
  it("overdue after the deadline", () => {
    const now = new Date("2026-07-05T02:00:00.000Z");
    expect(isTaskOverdue(base, rules, now)).toBe(true);
  });
  it("never overdue outside in_progress", () => {
    const now = new Date("2026-07-05T05:00:00.000Z");
    expect(isTaskOverdue({ ...base, status: "done" }, rules, now)).toBe(false);
    expect(isTaskOverdue({ ...base, in_progress_at: null }, rules, now)).toBe(false);
  });
});

describe("formatElapsedSince", () => {
  it("formats elapsed hours and minutes", () => {
    const since = "2026-07-05T00:00:00.000Z";
    const now = new Date("2026-07-05T02:15:00.000Z");
    expect(formatElapsedSince(since, now)).toBe("2h 15m");
  });
  it("formats sub-hour elapsed without the hour segment", () => {
    const since = "2026-07-05T00:00:00.000Z";
    const now = new Date("2026-07-05T00:10:00.000Z");
    expect(formatElapsedSince(since, now)).toBe("10m");
  });
  it("formats elapsed durations over 24h as days and hours", () => {
    const since = "2026-07-05T00:00:00.000Z";
    const now = new Date("2026-07-18T00:46:00.000Z");
    expect(formatElapsedSince(since, now)).toBe("13d 0h");
  });
});

describe("formatSlaRemaining", () => {
  it("formats time left", () => {
    const deadline = new Date("2026-07-05T02:15:00.000Z");
    const now = new Date("2026-07-05T00:00:00.000Z");
    expect(formatSlaRemaining(deadline, now)).toBe("2h 15m left");
  });
  it("formats overdue with the same shape, flipped", () => {
    const deadline = new Date("2026-07-05T00:00:00.000Z");
    const now = new Date("2026-07-05T00:45:00.000Z");
    expect(formatSlaRemaining(deadline, now)).toBe("Overdue by 45m");
  });
  it("formats sub-hour remaining without the hour segment", () => {
    const deadline = new Date("2026-07-05T00:10:00.000Z");
    const now = new Date("2026-07-05T00:00:00.000Z");
    expect(formatSlaRemaining(deadline, now)).toBe("10m left");
  });
  it("formats overdue durations over 24h as days and hours", () => {
    const deadline = new Date("2026-07-05T00:00:00.000Z");
    const now = new Date("2026-07-08T19:03:00.000Z");
    expect(formatSlaRemaining(deadline, now)).toBe("Overdue by 3d 19h");
  });
});

describe("formatDurationMinutes", () => {
  it("switches from hours/minutes to days/hours at 24h", () => {
    expect(formatDurationMinutes(23 * 60 + 59)).toBe("23h 59m");
    expect(formatDurationMinutes(24 * 60)).toBe("1d 0h");
    expect(formatDurationMinutes(24 * 60 + 75)).toBe("1d 1h");
  });
});
