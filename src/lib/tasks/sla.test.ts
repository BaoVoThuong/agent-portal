import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLA_MINUTES,
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
});
