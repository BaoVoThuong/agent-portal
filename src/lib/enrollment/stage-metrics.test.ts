import { describe, expect, it } from "vitest";
import { summarizeStageDwell } from "@/lib/enrollment/stage-metrics";

describe("stage dwell metrics", () => {
  it("groups live dwell rows by configured stage and preserves archived labels", () => {
    const result = summarizeStageDwell(
      Array.from({ length: 10 }, (_, index) => ({ stage_id: "stage-1", duration_seconds: index })),
      [{ id: "stage-1", set_id: "set", set_key: "stage", label: "Archived stage", color: "#999", position: 1, is_terminal: false, triggers_qc: false, archived_at: "2026-01-01" }]
    );
    expect(result[0]).toMatchObject({ stageId: "stage-1", stageLabel: "Archived stage", sampleSize: 10, medianSeconds: 4.5, p75Seconds: 7 });
  });
});
