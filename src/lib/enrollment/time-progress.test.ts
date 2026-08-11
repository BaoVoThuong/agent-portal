import { describe, expect, it } from "vitest";
import { dateOnlyToEndOfDay } from "./helpers";
import { buildEnrollmentTimeProgress } from "./time-progress";

const base = {
  due_date: null,
  closed_at: null,
  stage_entered_at: "2026-08-09T00:00:00.000Z",
  stage_entered_source: "live" as const,
};

describe("buildEnrollmentTimeProgress", () => {
  it("reports current stage dwell using the CS duration format", () => {
    const report = buildEnrollmentTimeProgress(
      base,
      "2 - Verify",
      new Date("2026-08-09T02:05:00.000Z")
    );

    expect(report.label).toBe("2 - Verify for 2h 5m");
    expect(report.className).toBe("text-[#42526e]");
  });

  it("shows due-date overdue ahead of current stage dwell", () => {
    const dueDate = "2026-08-09";
    const dueAt = dateOnlyToEndOfDay(dueDate);
    const now = new Date(dueAt.getTime() + (31 * 60 + 9) * 60_000);
    const report = buildEnrollmentTimeProgress(
      { ...base, due_date: dueDate },
      "2 - Verify",
      now
    );

    expect(report.label).toBe("Overdue by 1d 7h");
    expect(report.className).toBe("text-[#bf2600]");
  });

  it("reports time since close instead of calling a closed record overdue", () => {
    const report = buildEnrollmentTimeProgress(
      {
        ...base,
        due_date: "2026-08-01",
        closed_at: "2026-08-09T00:00:00.000Z",
      },
      "10 - DONE",
      new Date("2026-08-10T02:00:00.000Z")
    );

    expect(report.label).toBe("10 - DONE 1d 2h ago");
    expect(report.className).toBe("text-[#006644]");
  });

  it("handles records whose stage tracking has not been backfilled", () => {
    const report = buildEnrollmentTimeProgress(
      { ...base, stage_entered_at: null, stage_entered_source: null },
      "New",
      new Date("2026-08-09T02:00:00.000Z")
    );

    expect(report.label).toBe("—");
    expect(report.title).toContain("not available");
  });

  it("identifies inferred dwell in the tooltip", () => {
    const report = buildEnrollmentTimeProgress(
      { ...base, stage_entered_source: "history_backfill" },
      "New",
      new Date("2026-08-09T02:00:00.000Z")
    );

    expect(report.title).toContain("Estimated");
  });
});
