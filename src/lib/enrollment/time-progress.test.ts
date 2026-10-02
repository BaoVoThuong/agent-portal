import { describe, expect, it } from "vitest";
import { buildEnrollmentTimeProgress } from "./time-progress";

const base = {
  due_date: null,
  closed_at: null,
  stage_entered_at: "2026-08-09T00:00:00.000Z",
  stage_entered_source: "live" as const,
};

describe("buildEnrollmentTimeProgress", () => {
  it("reports current stage dwell", () => {
    expect(buildEnrollmentTimeProgress(base, "2 - Verify", new Date("2026-08-09T02:05:00.000Z")).label).toBe("2 - Verify for 2h 5m");
  });
  it("uses the Chicago business day for overdue", () => {
    const report = buildEnrollmentTimeProgress(
      { ...base, due_date: "2026-08-09" },
      "2 - Verify",
      new Date("2026-08-10T05:01:00.000Z"),
    );
    expect(report.label).toBe("Overdue by 1m");
    expect(report.className).toBe("text-[#bf2600]");
  });
  it("reports time since close", () => {
    expect(buildEnrollmentTimeProgress({ ...base, closed_at: "2026-08-09T00:00:00.000Z" }, "DONE", new Date("2026-08-10T02:00:00.000Z")).label).toBe("DONE 1d 2h ago");
  });
  it("handles missing stage timing", () => {
    expect(buildEnrollmentTimeProgress({ ...base, stage_entered_at: null, stage_entered_source: null }, "New", new Date("2026-08-09T02:00:00.000Z")).label).toBe("—");
  });
});
