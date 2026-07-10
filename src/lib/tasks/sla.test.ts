import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLA_MINUTES,
  currentStintDueAt,
  effectiveSlaMinutes,
  formatDurationMinutes,
  formatDurationSeconds,
  formatSlaRemaining,
  inProgressConsumedSeconds,
  isOverBudget,
  isTaskOverdue,
  resolveSlaMinutes,
  slaDeadline,
  slaRemainingSeconds,
  stageElapsedSeconds,
  wasOverdueReworking,
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
    // Priority now says "low" (1440m), but it started as "urgent" and locked
    // 60m — the snapshot must win, else editing priority later would move the
    // budget on a task already burning it.
    expect(
      effectiveSlaMinutes({ priority: "low", category_id: null, sla_minutes: 60 }, rules)
    ).toBe(60);
  });
  it("falls back to live resolution when there is no snapshot yet", () => {
    expect(
      effectiveSlaMinutes({ priority: "urgent", category_id: null, sla_minutes: null }, rules)
    ).toBe(60);
  });
});

describe("inProgressConsumedSeconds", () => {
  const now = new Date("2026-07-05T02:00:00.000Z");
  it("adds the current open stint to the banked accumulator while In Progress", () => {
    expect(
      inProgressConsumedSeconds(
        { status: "in_progress", in_progress_at: "2026-07-05T01:30:00.000Z", in_progress_seconds: 600 },
        now
      )
    ).toBe(600 + 30 * 60);
  });
  it("returns only the banked accumulator when not currently In Progress", () => {
    expect(
      inProgressConsumedSeconds(
        { status: "todo", in_progress_at: null, in_progress_seconds: 900 },
        now
      )
    ).toBe(900);
  });
  it("treats a missing accumulator as 0", () => {
    expect(
      inProgressConsumedSeconds(
        { status: "in_progress", in_progress_at: "2026-07-05T01:30:00.000Z", in_progress_seconds: null },
        now
      )
    ).toBe(30 * 60);
  });
});

describe("slaRemainingSeconds", () => {
  const base = {
    status: "in_progress" as const,
    in_progress_at: "2026-07-05T00:00:00.000Z",
    priority: "urgent" as const,
    category_id: null,
    sla_minutes: 60,
    in_progress_seconds: 0,
  };
  it("positive while under budget", () => {
    const now = new Date("2026-07-05T00:45:00.000Z");
    expect(slaRemainingSeconds(base, rules, now)).toBe(15 * 60);
  });
  it("negative once the budget is burned (counts up as overdue)", () => {
    const now = new Date("2026-07-05T01:30:00.000Z");
    expect(slaRemainingSeconds(base, rules, now)).toBe(-30 * 60);
  });
  it("counts prior stints against the budget (bounce cannot reset it)", () => {
    // 50 minutes already banked from earlier stints; only 10 left before breach.
    const now = new Date("2026-07-05T00:05:00.000Z");
    expect(
      slaRemainingSeconds({ ...base, in_progress_seconds: 50 * 60 }, rules, now)
    ).toBe(5 * 60);
  });
});

describe("isTaskOverdue (consumption-based)", () => {
  const base = {
    status: "in_progress" as const,
    in_progress_at: "2026-07-05T00:00:00.000Z",
    priority: "urgent" as const,
    category_id: null,
    sla_minutes: 60,
    in_progress_seconds: 0,
  };
  it("not overdue before the budget is used up", () => {
    expect(isTaskOverdue(base, rules, new Date("2026-07-05T00:59:00.000Z"))).toBe(false);
  });
  it("overdue exactly at the budget boundary (fresh breach in the current stint)", () => {
    expect(isTaskOverdue(base, rules, new Date("2026-07-05T01:00:00.000Z"))).toBe(true);
  });
  it("NOT overdue when prior stints already exhausted the budget (reopened / reworking)", () => {
    // Already burned the full 60m in earlier stints (it was reopened). Working
    // it again is over budget but NOT the active overdue state — it counts up
    // with a "Was overdue" tag and never returns to the Overdue column.
    const reworking = { ...base, in_progress_seconds: 60 * 60 };
    const now = new Date("2026-07-05T00:10:00.000Z");
    expect(isTaskOverdue(reworking, rules, now)).toBe(false);
    expect(isOverBudget(reworking, rules, now)).toBe(true);
    expect(wasOverdueReworking(reworking, rules, now)).toBe(true);
  });
  it("never overdue outside In Progress", () => {
    const now = new Date("2026-07-05T05:00:00.000Z");
    expect(isTaskOverdue({ ...base, status: "todo", in_progress_at: null }, rules, now)).toBe(false);
    expect(isTaskOverdue({ ...base, in_progress_at: null }, rules, now)).toBe(false);
  });
  it("wasOverdueReworking is false while still under budget or freshly overdue", () => {
    expect(wasOverdueReworking(base, rules, new Date("2026-07-05T00:30:00.000Z"))).toBe(false); // under budget
    expect(wasOverdueReworking(base, rules, new Date("2026-07-05T01:30:00.000Z"))).toBe(false); // fresh breach → still "overdue", not reworking
  });
});

describe("currentStintDueAt", () => {
  it("is in_progress_at + full budget when no prior stint was banked", () => {
    const due = currentStintDueAt(
      {
        in_progress_at: "2026-07-05T00:00:00.000Z",
        priority: "urgent",
        category_id: null,
        sla_minutes: 60,
        in_progress_seconds: 0,
      },
      rules
    );
    expect(due?.toISOString()).toBe("2026-07-05T01:00:00.000Z");
  });
  it("accounts for budget already burned in earlier stints", () => {
    const due = currentStintDueAt(
      {
        in_progress_at: "2026-07-05T00:00:00.000Z",
        priority: "urgent",
        category_id: null,
        sla_minutes: 60,
        in_progress_seconds: 50 * 60, // only 10 minutes of budget left
      },
      rules
    );
    expect(due?.toISOString()).toBe("2026-07-05T00:10:00.000Z");
  });
  it("clamps to in_progress_at when the budget is already fully burned", () => {
    const due = currentStintDueAt(
      {
        in_progress_at: "2026-07-05T00:00:00.000Z",
        priority: "urgent",
        category_id: null,
        sla_minutes: 60,
        in_progress_seconds: 90 * 60,
      },
      rules
    );
    expect(due?.toISOString()).toBe("2026-07-05T00:00:00.000Z");
  });
});

describe("stageElapsedSeconds", () => {
  const now = new Date("2026-07-05T01:00:00.000Z");
  it("adds the open stint to the accumulator while in the stage", () => {
    expect(stageElapsedSeconds(600, "2026-07-05T00:30:00.000Z", now)).toBe(600 + 30 * 60);
  });
  it("returns only the accumulator when the stage is not active (started_at null)", () => {
    expect(stageElapsedSeconds(1234, null, now)).toBe(1234);
  });
  it("handles a null accumulator", () => {
    expect(stageElapsedSeconds(null, "2026-07-05T00:30:00.000Z", now)).toBe(30 * 60);
  });
});

describe("slaDeadline", () => {
  it("adds minutes to a start time", () => {
    expect(slaDeadline("2026-07-05T00:00:00.000Z", 90).toISOString()).toBe(
      "2026-07-05T01:30:00.000Z"
    );
  });
});

describe("formatSlaRemaining (seconds-based)", () => {
  it("formats time left", () => {
    expect(formatSlaRemaining(2 * 3600 + 15 * 60)).toBe("2h 15m left");
  });
  it("formats overdue with the same shape, flipped", () => {
    expect(formatSlaRemaining(-45 * 60)).toBe("Overdue by 45m");
  });
  it("treats exactly zero as overdue", () => {
    expect(formatSlaRemaining(0)).toBe("Overdue by 1m");
  });
});

describe("formatDurationMinutes / formatDurationSeconds", () => {
  it("sub-hour without the hour segment", () => {
    expect(formatDurationMinutes(10)).toBe("10m");
  });
  it("hours and minutes", () => {
    expect(formatDurationMinutes(135)).toBe("2h 15m");
  });
  it("days for long durations", () => {
    expect(formatDurationMinutes(48 * 60 + 3 * 60)).toBe("2d 3h");
  });
  it("seconds variant rounds to minutes", () => {
    expect(formatDurationSeconds(2 * 3600 + 15 * 60)).toBe("2h 15m");
    expect(formatDurationSeconds(20)).toBe("0m");
    expect(formatDurationSeconds(59)).toBe("1m");
  });
});
