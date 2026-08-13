import { describe, expect, it } from "vitest";
import { summarizePersonStageTiming } from "./aca-person-stage-timing";
const day = 86_400;
describe("ACA per-person stage timing", () => {
  it("suppresses medians below ten samples and keeps baselines", () => {
    const rows = [
      ...Array.from({ length: 10 }, () => ({ stage_id: "s1", responsible_start_email: "a@x.com", duration_seconds: 2 * day })),
      ...Array.from({ length: 10 }, () => ({ stage_id: "s1", responsible_start_email: "b@x.com", duration_seconds: 4 * day })),
    ];
    const result = summarizePersonStageTiming(rows, ["s1", "s2"], ["a@x.com", "b@x.com"]);
    expect(result.cells["a@x.com"].s1.sampleSize).toBe(10);
    expect(result.cells["a@x.com"].s1.medianDays).toBe(2);
    expect(result.stageBaseline.s1.medianDays).toBe(3);
    expect(result.cells["a@x.com"].s2).toEqual({ sampleSize: 0, medianDays: null });
  });
  it("ignores cycles attributed to an unknown person", () => {
    const result = summarizePersonStageTiming([{ stage_id: "s1", responsible_start_email: "ghost@x.com", duration_seconds: day }], ["s1"], ["a@x.com"]);
    expect(result.stageBaseline.s1.sampleSize).toBe(0);
  });
});
