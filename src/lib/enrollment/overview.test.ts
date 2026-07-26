import { describe, expect, it } from "vitest";
import { aggregateEnrollmentOverview, rankEnrollmentRecommendation } from "./overview";
import { ENROLLMENT_OVERVIEW_THRESHOLDS } from "./overview-types";
import type { EnrollmentOverviewAccount, EnrollmentOverviewRecordInput } from "./overview-types";
import type { EnrollmentOption } from "./types";

function account(email: string, overrides: Partial<EnrollmentOverviewAccount> = {}): EnrollmentOverviewAccount {
  return { email, name: null, isActive: true, canWork: true, isAdmin: false, ...overrides };
}

function stageOption(overrides: Partial<EnrollmentOption> = {}): EnrollmentOption {
  return {
    id: "stage-1",
    set_id: "set-stage",
    set_key: "stage",
    label: "1-Need quote",
    color: "#0C66E4",
    position: 10,
    is_terminal: false,
    triggers_qc: false,
    archived_at: null,
    ...overrides,
  };
}

function record(overrides: Partial<EnrollmentOverviewRecordInput> = {}): EnrollmentOverviewRecordInput {
  return {
    id: "rec-1",
    program: "aca",
    client_name: "Test client",
    stage_id: "stage-1",
    responsible_enroll_email: "cs@x.com",
    due_date: null,
    qc_checked_at: null,
    closed_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    archived_at: null,
    ...overrides,
  };
}

const now = new Date("2026-07-25T12:00:00.000Z");
const thresholds = ENROLLMENT_OVERVIEW_THRESHOLDS;

describe("aggregateEnrollmentOverview", () => {
  it("keeps a zero-load account visible in the workload rows", () => {
    const snapshot = aggregateEnrollmentOverview({
      now,
      program: "aca",
      accounts: [account("cs@x.com")],
      stageOptions: [stageOption()],
      records: [],
      thresholds,
      qcStaleHours: 48,
    });
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0].openCount).toBe(0);
    expect(snapshot.rows[0].status).toBe("free");
  });

  it("flags an open record past its due date as overdue, not a closed one", () => {
    const snapshot = aggregateEnrollmentOverview({
      now,
      program: "aca",
      accounts: [account("cs@x.com")],
      stageOptions: [stageOption()],
      records: [
        record({ id: "r1", due_date: "2026-07-01" }),
        record({ id: "r2", due_date: "2026-07-01", closed_at: "2026-07-02T00:00:00.000Z" }),
      ],
      thresholds,
      qcStaleHours: 48,
    });
    const row = snapshot.rows[0];
    expect(row.overdueCount).toBe(1);
    expect(row.openCount).toBe(1);
  });

  it("flags a closed record needing QC past qcStaleHours", () => {
    const doneStage = stageOption({ id: "stage-done", label: "10-DONE", is_terminal: true, triggers_qc: true });
    const snapshot = aggregateEnrollmentOverview({
      now,
      program: "aca",
      accounts: [account("cs@x.com")],
      stageOptions: [doneStage],
      records: [
        record({
          id: "r1",
          stage_id: "stage-done",
          closed_at: "2026-07-20T00:00:00.000Z", // 5 days before `now` > 48h
          qc_checked_at: null,
        }),
      ],
      thresholds,
      qcStaleHours: 48,
    });
    expect(snapshot.rows[0].qcStaleCount).toBe(1);
    expect(snapshot.kpis.needsAttentionCount).toBe(1);
  });

  it("does not flag a closed record as QC-stale before qcStaleHours has passed", () => {
    const doneStage = stageOption({ id: "stage-done", label: "10-DONE", is_terminal: true, triggers_qc: true });
    const snapshot = aggregateEnrollmentOverview({
      now,
      program: "aca",
      accounts: [account("cs@x.com")],
      stageOptions: [doneStage],
      records: [
        record({
          id: "r1",
          stage_id: "stage-done",
          closed_at: "2026-07-25T10:00:00.000Z", // 2h before `now`, under 48h
          qc_checked_at: null,
        }),
      ],
      thresholds,
      qcStaleHours: 48,
    });
    expect(snapshot.rows[0].qcStaleCount).toBe(0);
  });

  it("derives status from open count using the count-only thresholds", () => {
    const records = Array.from({ length: 6 }, (_, i) => record({ id: `r${i}` }));
    const snapshot = aggregateEnrollmentOverview({
      now,
      program: "aca",
      accounts: [account("cs@x.com")],
      stageOptions: [stageOption()],
      records,
      thresholds,
      qcStaleHours: 48,
    });
    expect(snapshot.rows[0].status).toBe("busy"); // 6 open >= openBusy(5), < openOverloaded(10)
  });

  it("buckets unassigned open records separately from the workload rows", () => {
    const snapshot = aggregateEnrollmentOverview({
      now,
      program: "aca",
      accounts: [account("cs@x.com")],
      stageOptions: [stageOption()],
      records: [record({ id: "r1", responsible_enroll_email: null })],
      thresholds,
      qcStaleHours: 48,
    });
    expect(snapshot.unassigned).toHaveLength(1);
    expect(snapshot.kpis.unassignedCount).toBe(1);
    expect(snapshot.rows[0].openCount).toBe(0);
  });

  it("builds one work-mix bucket per stage that has open records, in natural label order", () => {
    const stage1 = stageOption({ id: "s1", position: 90, label: "1-Need quote" });
    const stage2 = stageOption({ id: "s2", position: 20, label: "2-Quoted" });
    const stage10 = stageOption({ id: "s10", position: 10, label: "10-DONE" });
    const snapshot = aggregateEnrollmentOverview({
      now,
      program: "aca",
      accounts: [account("cs@x.com")],
      stageOptions: [stage10, stage2, stage1], // deliberately out of order by position and input order
      records: [
        record({ id: "r1", stage_id: "s2" }),
        record({ id: "r2", stage_id: "s1" }),
        record({ id: "r10", stage_id: "s10" }),
      ],
      thresholds,
      qcStaleHours: 48,
    });
    expect(snapshot.workMix.stages.map((s) => s.stageId)).toEqual(["s1", "s2", "s10"]);
  });

  it("excludes archived records from every computation", () => {
    const snapshot = aggregateEnrollmentOverview({
      now,
      program: "aca",
      accounts: [account("cs@x.com")],
      stageOptions: [stageOption()],
      records: [record({ id: "r1", archived_at: "2026-07-10T00:00:00.000Z" })],
      thresholds,
      qcStaleHours: 48,
    });
    expect(snapshot.rows[0].openCount).toBe(0);
    expect(snapshot.kpis.openRecordCount).toBe(0);
  });
});

describe("rankEnrollmentRecommendation", () => {
  it("prefers the account with fewer projected open records", () => {
    const snapshot = aggregateEnrollmentOverview({
      now,
      program: "aca",
      accounts: [account("busy@x.com"), account("free@x.com")],
      stageOptions: [stageOption()],
      records: [
        record({ id: "r1", responsible_enroll_email: "busy@x.com" }),
        record({ id: "r2", responsible_enroll_email: "busy@x.com" }),
        record({ id: "target", responsible_enroll_email: null }),
      ],
      thresholds,
      qcStaleHours: 48,
    });
    const ranked = rankEnrollmentRecommendation(snapshot, "target");
    expect(ranked[0].email).toBe("free@x.com");
  });

  it("de-ranks a candidate with an active risk flag even if their open count is lower", () => {
    const snapshot = aggregateEnrollmentOverview({
      now,
      program: "aca",
      accounts: [account("risky@x.com"), account("clean@x.com")],
      stageOptions: [stageOption()],
      records: [
        record({ id: "r1", responsible_enroll_email: "risky@x.com", due_date: "2026-07-01" }), // overdue
        record({ id: "r2", responsible_enroll_email: "clean@x.com", due_date: "2026-08-01" }),
        record({ id: "r3", responsible_enroll_email: "clean@x.com", due_date: "2026-08-01" }),
        record({ id: "target", responsible_enroll_email: null }),
      ],
      thresholds,
      qcStaleHours: 48,
    });
    const ranked = rankEnrollmentRecommendation(snapshot, "target");
    expect(ranked[0].email).toBe("clean@x.com");
  });
});
