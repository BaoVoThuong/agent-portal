import { describe, expect, it } from "vitest";
import { aggregateAcaOverview } from "./aca-overview-aggregate";
import { daysSilent, medianDays } from "./aca-overview-timing";
import type { AcaOverviewInput, AcaOverviewRecord } from "./aca-overview-types";
import type { EnrollmentOption } from "./types";

const now = new Date("2026-08-13T00:00:00.000Z");
const stage = (id: string, label: string, extra: Partial<EnrollmentOption> = {}): EnrollmentOption => ({
  id, set_id: "stages", set_key: "stage", label, color: "#123456", position: 1,
  is_terminal: false, triggers_qc: false, treat_as_terminal: false, archived_at: null, ...extra,
});
const record = (id: string, extra: Partial<AcaOverviewRecord> = {}): AcaOverviewRecord => ({
  id, display_number: `ENR-${id}`, client_name: id, stage_id: "open", agent_email: null,
  caller_email: null, responsible_enroll_email: "a@example.com", created_at: "2026-08-01T00:00:00Z",
  closed_at: null, archived_at: null, stage_entered_at: "2026-08-03T00:00:00Z", stage_entered_source: "live",
  last_work_activity_at: null, responsible_assigned_at: null, updated_at: "2026-08-13T00:00:00Z", ...extra,
});
const input = (records: AcaOverviewRecord[]): AcaOverviewInput => ({
  records, stages: [stage("open", "1-Need quote"), stage("done", "10-DONE", { is_terminal: true }), stage("cc", "Can't Contact", { treat_as_terminal: true })],
  people: [{ email: "a@example.com", name: "A", canWork: true, queueEnabled: true }], stageDwellMedianSeconds: new Map(), thresholdDays: 3, now,
});

describe("ACA overview primitives", () => {
  it("uses maintained work activity and median ignores nulls", () => {
    expect(daysSilent(record("x", { last_work_activity_at: "2026-08-11T00:00:00Z" }), now)).toBe(2);
    expect(medianDays([null, 1, 5])).toBe(3);
  });
  it("builds terminal-aware scorecards, actions, matrix and queue", () => {
    const snapshot = aggregateAcaOverview(input([
      record("open"), record("unassigned", { responsible_enroll_email: null, stage_entered_at: "2026-08-01T00:00:00Z" }),
      record("done", { stage_id: "done", closed_at: "2026-08-12T00:00:00Z" }),
      record("blocked", { stage_id: "cc" }),
    ]));
    expect(snapshot.scorecards.totalTasks).toBe(4);
    expect(snapshot.scorecards.done).toBe(1);
    expect(snapshot.scorecards.unassigned).toBe(1);
    expect(snapshot.actions.map((row) => row.recordId)).toEqual(["unassigned", "open"]);
    expect(snapshot.stageTable.find((row) => row.stageId === "cc")?.inStage).toBe(1);
    expect(snapshot.stageTable.find((row) => row.stageId === "open")?.inStage).toBe(1);
    expect(snapshot.matrix.rows).toHaveLength(2);
    expect(snapshot.queue[0]?.email).toBe("a@example.com");
  });
});
