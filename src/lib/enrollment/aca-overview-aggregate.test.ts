import { describe, expect, it } from "vitest";
import { aggregateAcaOverview } from "./aca-overview-aggregate";
import { daysSilent, medianDays } from "./aca-overview-timing";
import { isTerminalStage } from "./aca-overview-stages";
import type { AcaOverviewInput, AcaOverviewRecord } from "./aca-overview-types";
import type { EnrollmentOption } from "./types";

const now = new Date("2026-08-13T00:00:00.000Z");
const stage = (id: string, label: string, extra: Partial<EnrollmentOption> = {}): EnrollmentOption => ({
  id, set_id: "stages", set_key: "stage", label, color: "#123456", position: 1,
  is_terminal: false, triggers_qc: false, treat_as_terminal: false, archived_at: null, ...extra,
});
const record = (id: string, extra: Partial<AcaOverviewRecord> = {}): AcaOverviewRecord => ({
  id, display_number: `ENR-${id}`, client_name: id, stage_id: "open", agent_email: null,
  caller_email: null, responsible_enroll_email: "a@example.com", due_date: null, qc_checked_at: null, created_at: "2026-08-01T00:00:00Z",
  closed_at: null, archived_at: null, stage_entered_at: "2026-08-03T00:00:00Z", stage_entered_source: "live",
  last_work_activity_at: null, responsible_assigned_at: null, updated_at: "2026-08-13T00:00:00Z", ...extra,
});
const input = (records: AcaOverviewRecord[]): AcaOverviewInput => ({
  records, stages: [stage("open", "1-Need quote"), stage("done", "10-ID card done", { is_terminal: true }), stage("cc", "11-ID card unavailable", { is_terminal: true })],
  people: [{ email: "a@example.com", name: "A", canWork: true, queueEnabled: true }], stageDwellMedianSeconds: new Map(), thresholdDays: 3, now,
});

describe("ACA overview primitives", () => {
  it("uses Final Stage as the only terminal signal", () => {
    expect(isTerminalStage(stage("legacy", "Legacy", { treat_as_terminal: true }))).toBe(false);
    expect(isTerminalStage(stage("workflow", "Workflow", { is_terminal: true }))).toBe(true);
  });

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
    expect(snapshot.actions.find((row) => row.recordId === "open")?.stageColor).toBe("#123456");
    expect(snapshot.stageTable.find((row) => row.stageId === "cc")?.inStage).toBe(1);
    expect(snapshot.stageTable.find((row) => row.stageId === "open")?.inStage).toBe(1);
    expect(snapshot.matrix.rows).toHaveLength(2);
    expect(snapshot.queue[0]?.email).toBe("a@example.com");
  });
});

describe("ACA overview fairness guards", () => {
  const stages = [
    stage("open", "1-Need quote"),
    stage("done", "10-ID card done", { is_terminal: true }),
    stage("terminated", "12-Terminated", { is_terminal: true }),
  ];
  const twoPeople = (records: AcaOverviewRecord[]): AcaOverviewInput => ({
    records, stages,
    people: [
      { email: "a@example.com", name: "A", canWork: true, queueEnabled: true },
      { email: "b@example.com", name: "B", canWork: true, queueEnabled: true },
    ],
    stageDwellMedianSeconds: new Map(), thresholdDays: 3, now,
  });

  it("averages assigned work per person, not the unassigned queue as well", () => {
    const snapshot = aggregateAcaOverview(twoPeople([
      record("r1", { responsible_enroll_email: "a@example.com" }),
      record("r2", { responsible_enroll_email: "b@example.com" }),
      record("r3", { responsible_enroll_email: null }),
      record("r4", { responsible_enroll_email: null }),
    ]));
    expect(snapshot.scorecards.open).toBe(4);
    expect(snapshot.scorecards.activePeople).toBe(2);
    // 2 assigned / 2 people, not 4 open / 2 people.
    expect(snapshot.scorecards.avgTasksPerPerson).toBe(1);
  });

  it("counts ACA outcome stages separately", () => {
    const snapshot = aggregateAcaOverview(twoPeople([
      record("won", { stage_id: "done", closed_at: "2026-08-12T00:00:00Z", responsible_enroll_email: "a@example.com" }),
      record("lost", { stage_id: "terminated", closed_at: "2026-08-12T00:00:00Z", responsible_enroll_email: "a@example.com" }),
    ]));
    const a = snapshot.people.find((row) => row.email === "a@example.com");
    expect(a?.doneInPeriod).toBe(1);
    expect(snapshot.scorecards.done).toBe(1);
    expect(snapshot.scorecards.terminated).toBe(1);
  });

  it("counts QC pending and overdue only for open records", () => {
    const qcStages = [
      stage("open", "1-Need quote", { triggers_qc: true }),
      stage("done", "10-ID card done", { is_terminal: true }),
    ];
    const snapshot = aggregateAcaOverview({
      ...twoPeople([]),
      stages: qcStages,
      records: [
        record("qc", { stage_id: "open" }),
        record("reviewed", { stage_id: "open", qc_checked_at: "2026-08-12T00:00:00Z" }),
        record("overdue", { stage_id: "open", due_date: "2026-08-01" }),
        record("due-today", { stage_id: "open", due_date: "2026-08-13" }),
        record("closed-overdue", { stage_id: "done", due_date: "2026-08-01", closed_at: "2026-08-02T00:00:00Z" }),
      ],
    });
    expect(snapshot.scorecards.qcPending).toBe(3);
    expect(snapshot.scorecards.overdue).toBe(1);
  });

  it("emits a team baseline row and an unassigned row that are not people", () => {
    const snapshot = aggregateAcaOverview(twoPeople([
      record("r1", { responsible_enroll_email: "a@example.com" }),
      record("r2", { responsible_enroll_email: "b@example.com" }),
      record("r3", { responsible_enroll_email: null }),
    ]));
    const team = snapshot.people.find((row) => row.kind === "team");
    const unassigned = snapshot.people.find((row) => row.kind === "unassigned");
    expect(team?.holding).toBe(2);
    expect(unassigned?.holding).toBe(1);
    expect(snapshot.people.filter((row) => row.kind === "person")).toHaveLength(2);
  });

  it("reports how many stage clocks in a row are estimated rather than a single flag", () => {
    const snapshot = aggregateAcaOverview(twoPeople([
      record("measured", { responsible_enroll_email: "a@example.com" }),
      record("guessed", { responsible_enroll_email: "a@example.com", stage_entered_source: "history_backfill" }),
    ]));
    const row = snapshot.stageTable.find((entry) => entry.stageId === "open");
    expect(row?.inStage).toBe(2);
    expect(row?.estimatedCount).toBe(1);
  });

  it("leaves terminal rows with no waiting figures at all", () => {
    const snapshot = aggregateAcaOverview(twoPeople([
      record("won", { stage_id: "done", closed_at: "2026-08-12T00:00:00Z" }),
    ]));
    const row = snapshot.stageTable.find((entry) => entry.stageId === "done");
    expect(row?.estimatedCount).toBeNull();
    expect(row?.stuckCount).toBeNull();
    expect(row?.sharePercent).toBeNull();
  });
});
