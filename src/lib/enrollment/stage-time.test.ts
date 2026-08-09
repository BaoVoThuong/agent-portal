import { describe, expect, it } from "vitest";
import { isMeasuredStageTime, secondsInCurrentStage, summarizeDurations } from "@/lib/enrollment/stage-time";

describe("stage time helpers", () => {
  it("calculates non-negative current dwell", () => {
    expect(secondsInCurrentStage({ stage_entered_at: "2026-08-09T00:00:00.000Z", stage_entered_source: "live" }, new Date("2026-08-09T00:01:02.900Z"))).toBe(62);
  });
  it("marks backfill as unmeasured and computes percentiles without mutating input", () => {
    const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const summary = summarizeDurations(values);
    expect(summary.medianSeconds).toBe(4.5);
    expect(summary.p75Seconds).toBe(7);
    expect(summary.p90Seconds).toBe(8);
    expect(values).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(isMeasuredStageTime({ stage_entered_at: null, stage_entered_source: "history_backfill" })).toBe(false);
  });
});
