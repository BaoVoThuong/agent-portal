import { describe, expect, it } from "vitest";
import {
  aggregateEnrollmentOverview,
  defaultEnrollmentOverviewPeriod,
} from "./overview";
import type {
  EnrollmentOverviewAccount,
  EnrollmentOverviewRecordInput,
  EnrollmentOverviewRequiredColumn,
} from "./overview-types";
import type { EnrollmentOption } from "./types";

function account(email = "worker@example.com"): EnrollmentOverviewAccount {
  return { email, name: null, isActive: true, canWork: true, isAdmin: false };
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
    description: "Description",
    fub_link: "https://example.com",
    stage_id: "stage-1",
    carrier_id: "carrier-1",
    platform_id: "platform-1",
    consent_id: "consent-1",
    payment_status_id: "payment-1",
    aca_status_id: "aca-1",
    pcp_2025: "pcp",
    pcp_2026: "pcp",
    custom_values: {},
    agent_email: "agent@example.com",
    caller_email: "caller@example.com",
    responsible_enroll_email: "worker@example.com",
    due_date: null,
    qc_checked_at: null,
    closed_at: null,
    created_at: "2026-08-02T00:00:00.000Z",
    updated_at: "2026-08-02T00:00:00.000Z",
    archived_at: null,
    ...overrides,
  };
}

const now = new Date("2026-08-09T12:00:00.000Z");
const period = { from: "2026-08-01", to: "2026-08-09" };

function aggregate(
  records: EnrollmentOverviewRecordInput[],
  options: EnrollmentOption[] = [stageOption()],
  requiredColumns: EnrollmentOverviewRequiredColumn[] = []
) {
  return aggregateEnrollmentOverview({
    now,
    program: "aca",
    period,
    accounts: [account()],
    stageOptions: options,
    records,
    requiredColumns,
  });
}

describe("defaultEnrollmentOverviewPeriod", () => {
  it("defaults to the current month through today", () => {
    expect(defaultEnrollmentOverviewPeriod(now)).toEqual({ from: "2026-08-01", to: "2026-08-09" });
  });
});

describe("aggregateEnrollmentOverview", () => {
  it("separates snapshot metrics from period metrics", () => {
    const snapshot = aggregate([
      record({ id: "new", created_at: "2026-08-03T00:00:00.000Z" }),
      record({ id: "old", created_at: "2026-07-01T00:00:00.000Z", closed_at: "2026-08-04T00:00:00.000Z" }),
      record({ id: "outside", created_at: "2026-07-01T00:00:00.000Z" }),
    ]);
    expect(snapshot.kpis.openCount).toBe(2);
    expect(snapshot.kpis.newCount).toBe(1);
    expect(snapshot.kpis.closedCount).toBe(1);
    expect(snapshot.kpis.netChange).toBe(0);
  });

  it("builds the needs-care union using the exact operational flags", () => {
    const blocking = stageOption({ id: "blocking", label: "Can't Contact" });
    const qc = stageOption({ id: "qc", label: "10-DONE", is_terminal: true, triggers_qc: true });
    const snapshot = aggregate(
      [
        record({ id: "overdue", due_date: "2026-08-01" }),
        record({ id: "due-soon", due_date: "2026-08-10" }),
        record({ id: "unowned", responsible_enroll_email: null }),
        record({ id: "blocking", stage_id: "blocking" }),
        record({ id: "qc", stage_id: "qc" }),
      ],
      [stageOption(), blocking, qc]
    );
    expect(snapshot.kpis.needsCareCount).toBe(5);
    expect(snapshot.kpis.overdueCount).toBe(1);
    expect(snapshot.needsCare.find((need) => need.key === "blocking_stage")?.count).toBe(1);
    expect(snapshot.needsCare.find((need) => need.key === "qc_pending")?.count).toBe(1);
  });

  it("only treats configured required columns as a missing-required risk", () => {
    const snapshot = aggregate(
      [record({ carrier_id: null })],
      [stageOption()],
      [{ key: "carrier", label: "Carrier", type: "dropdown", is_system: true }]
    );
    expect(snapshot.needsCare.find((need) => need.key === "missing_required")?.count).toBe(1);
    expect(snapshot.missingItems.find((item) => item.key === "carrier")?.missingCount).toBe(1);
  });

  it("keeps the natural stage label order and includes zero-open stages", () => {
    const stages = [
      stageOption({ id: "s10", label: "10-DONE" }),
      stageOption({ id: "s2", label: "2-Quoted" }),
      stageOption({ id: "s1", label: "1-Need quote" }),
    ];
    const snapshot = aggregate([record({ stage_id: "s2" })], stages);
    expect(snapshot.funnel.map((stage) => stage.stageId)).toEqual(["s1", "s2", "s10"]);
    expect(snapshot.funnel.find((stage) => stage.stageId === "s1")?.openCount).toBe(0);
  });

  it("calculates completeness, cycle time, and ACA outcome metrics", () => {
    const done = stageOption({ id: "done", label: "10-DONE", is_terminal: true });
    const terminated = stageOption({ id: "terminated", label: "11-Terminated", is_terminal: true });
    const snapshot = aggregate(
      [
        record({ id: "done-record", stage_id: "done", created_at: "2026-08-01T00:00:00.000Z", closed_at: "2026-08-03T00:00:00.000Z" }),
        record({ id: "lost-record", stage_id: "terminated", created_at: "2026-08-01T00:00:00.000Z", closed_at: "2026-08-04T00:00:00.000Z" }),
        record({ id: "open-record", pcp_2026: null }),
      ],
      [stageOption(), done, terminated]
    );
    expect(snapshot.outcome).toEqual({ successCount: 1, lostCount: 1, closedCount: 2 });
    expect(snapshot.cycleTime.find((metric) => metric.stageId === "done")?.medianDays).toBe(2);
    expect(snapshot.completeness.percentage).toBeLessThan(100);
  });

  it("uses the Medicare collectable set and omits ACA outcomes", () => {
    const snapshot = aggregateEnrollmentOverview({
      now,
      program: "medicare",
      period,
      accounts: [account()],
      stageOptions: [stageOption()],
      records: [record({ program: "medicare", payment_status_id: null, aca_status_id: null, platform_id: null, consent_id: null, pcp_2026: null })],
      requiredColumns: [],
    });
    expect(snapshot.outcome).toBeNull();
    expect(snapshot.missingItems.map((item) => item.key)).toEqual(["carrier", "pcp2025"]);
  });

  it("excludes archived records from snapshot and period metrics", () => {
    const snapshot = aggregate([record({ archived_at: "2026-08-03T00:00:00.000Z", closed_at: "2026-08-04T00:00:00.000Z" })]);
    expect(snapshot.kpis.openCount).toBe(0);
    expect(snapshot.kpis.closedCount).toBe(0);
    expect(snapshot.kpis.needsCareCount).toBe(0);
  });
});
