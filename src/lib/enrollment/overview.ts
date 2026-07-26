import { enrollmentIsDueSoon, enrollmentIsOverdue } from "./helpers";
import type { EnrollmentOption, EnrollmentProgram } from "./types";
import {
  ENROLLMENT_OVERVIEW_RISK_FLAGS,
  type EnrollmentOverviewAccount,
  type EnrollmentOverviewAttentionBar,
  type EnrollmentOverviewKpis,
  type EnrollmentOverviewRecordInput,
  type EnrollmentOverviewRiskFlag,
  type EnrollmentOverviewRow,
  type EnrollmentOverviewSnapshot,
  type EnrollmentOverviewStageBucket,
  type EnrollmentOverviewStatus,
  type EnrollmentOverviewThresholds,
  type EnrollmentOverviewWorkMix,
  type EnrollmentRecommendationCandidate,
  type EnrollmentUnassignedOverviewRecord,
} from "./overview-types";

export type AggregateEnrollmentOverviewInput = {
  now: Date;
  program: EnrollmentProgram;
  accounts: EnrollmentOverviewAccount[];
  stageOptions: EnrollmentOption[];
  records: EnrollmentOverviewRecordInput[];
  thresholds: EnrollmentOverviewThresholds;
  qcStaleHours: number;
};

const ATTENTION_LABELS: Record<EnrollmentOverviewRiskFlag, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  qc_stale: "QC stale",
  missing_owner: "No owner",
  no_due_date: "No due date",
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function ageSeconds(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
}

type Derived = {
  record: EnrollmentOverviewRecordInput;
  isOpen: boolean;
  riskFlags: EnrollmentOverviewRiskFlag[];
};

function deriveRecord(
  record: EnrollmentOverviewRecordInput,
  stageById: Map<string, EnrollmentOption>,
  now: Date,
  qcStaleHours: number
): Derived {
  const isOpen = !record.closed_at;
  const stage = record.stage_id ? stageById.get(record.stage_id) ?? null : null;
  const flags: EnrollmentOverviewRiskFlag[] = [];

  if (isOpen) {
    if (enrollmentIsOverdue(record, now)) flags.push("overdue");
    else if (enrollmentIsDueSoon(record, now)) flags.push("due_soon");
    if (!record.responsible_enroll_email) flags.push("missing_owner");
    if (!record.due_date) flags.push("no_due_date");
  }

  // QC-stale applies to closed records still needing QC — mirrors the cron's
  // qcCutoff logic exactly (src/app/api/cron/check-enrollment-due/route.ts)
  // so the Overview flags precisely the records that would get a qc_stale
  // notification, not a second, drifting definition of "stale."
  if (!isOpen && stage?.triggers_qc && !record.qc_checked_at && record.closed_at) {
    const staleCutoff = now.getTime() - qcStaleHours * 3600_000;
    if (new Date(record.closed_at).getTime() <= staleCutoff) flags.push("qc_stale");
  }

  return { record, isOpen, riskFlags: flags };
}

function statusFromOpenCount(
  openCount: number,
  thresholds: EnrollmentOverviewThresholds
): EnrollmentOverviewStatus {
  if (openCount === 0) return "free";
  if (openCount >= thresholds.openOverloaded) return "overloaded";
  if (openCount >= thresholds.openBusy) return "busy";
  return "ok";
}

export function aggregateEnrollmentOverview(
  input: AggregateEnrollmentOverviewInput
): EnrollmentOverviewSnapshot {
  const { now, program, accounts, stageOptions, records, thresholds, qcStaleHours } = input;
  const stageById = new Map(stageOptions.map((option) => [option.id, option]));
  const sortedStages = [...stageOptions].sort((a, b) => a.position - b.position);

  const derived = records
    .filter((record) => !record.archived_at)
    .map((record) => deriveRecord(record, stageById, now, qcStaleHours));

  type Bucket = {
    account: EnrollmentOverviewAccount;
    openRecords: Derived[];
    qcStale: Derived[];
    done7dCount: number;
  };
  const buckets = new Map<string, Bucket>();
  for (const account of accounts) {
    buckets.set(normalizeEmail(account.email), { account, openRecords: [], qcStale: [], done7dCount: 0 });
  }
  const unassigned: EnrollmentUnassignedOverviewRecord[] = [];
  const sevenDaysAgo = now.getTime() - 7 * 24 * 3600_000;

  for (const item of derived) {
    const owner = item.record.responsible_enroll_email
      ? normalizeEmail(item.record.responsible_enroll_email)
      : null;

    if (item.isOpen) {
      if (!owner) {
        const stage = item.record.stage_id ? stageById.get(item.record.stage_id) ?? null : null;
        unassigned.push({
          id: item.record.id,
          clientName: item.record.client_name,
          stageId: item.record.stage_id,
          stageLabel: stage?.label ?? null,
          stageColor: stage?.color ?? null,
          dueDate: item.record.due_date,
          createdAt: item.record.created_at,
          ageSeconds: ageSeconds(item.record.created_at, now),
          isOverdue: item.riskFlags.includes("overdue"),
        });
      } else {
        const bucket = buckets.get(owner);
        if (bucket) bucket.openRecords.push(item);
        // else: assigned to someone outside the resolved pool — out of scope
        // for v1 (CS's Overview has a dedicated "outside pool" panel; add one
        // here only if this turns out to happen in practice).
      }
    } else if (owner) {
      const bucket = buckets.get(owner);
      if (bucket && item.riskFlags.includes("qc_stale")) bucket.qcStale.push(item);
      if (bucket && new Date(item.record.closed_at ?? item.record.updated_at).getTime() >= sevenDaysAgo) {
        bucket.done7dCount += 1;
      }
    }
  }

  const rows: EnrollmentOverviewRow[] = [...buckets.values()].map(
    ({ account, openRecords, qcStale, done7dCount }) => {
      const openCount = openRecords.length;
      const overdueCount = openRecords.filter((r) => r.riskFlags.includes("overdue")).length;
      const riskFlags = [
        ...new Set(
          openRecords.flatMap((r) => r.riskFlags).concat(qcStale.length > 0 ? (["qc_stale"] as const) : [])
        ),
      ];
      const oldest = openRecords.map((r) => r.record.created_at).sort((a, b) => a.localeCompare(b))[0] ?? null;

      return {
        email: account.email,
        name: account.name,
        openCount,
        overdueCount,
        qcStaleCount: qcStale.length,
        riskFlags,
        oldestOpenCreatedAt: oldest,
        oldestOpenAgeSeconds: oldest ? ageSeconds(oldest, now) : null,
        done7d: done7dCount,
        status: statusFromOpenCount(openCount, thresholds),
        records: openRecords.map((r) => ({
          id: r.record.id,
          clientName: r.record.client_name,
          stageId: r.record.stage_id,
          createdAt: r.record.created_at,
          dueDate: r.record.due_date,
          riskFlags: r.riskFlags,
        })),
      };
    }
  );

  const attention: EnrollmentOverviewAttentionBar[] = ENROLLMENT_OVERVIEW_RISK_FLAGS.map((flag) => {
    const recordIds = new Set<string>();
    const people = new Set<string>();
    for (const row of rows) {
      for (const record of row.records) {
        if (record.riskFlags.includes(flag)) {
          recordIds.add(record.id);
          people.add(row.email);
        }
      }
      if (flag === "qc_stale" && row.qcStaleCount > 0) {
        people.add(row.email);
      }
    }
    const qcStaleExtra = flag === "qc_stale" ? rows.reduce((sum, row) => sum + row.qcStaleCount, 0) : 0;
    return {
      key: flag,
      label: ATTENTION_LABELS[flag],
      recordCount: recordIds.size + qcStaleExtra,
      affectedPeopleCount: people.size,
    };
  });

  const stageBuckets: EnrollmentOverviewStageBucket[] = [];
  for (const stage of sortedStages) {
    const stageOpen = derived.filter((item) => item.isOpen && item.record.stage_id === stage.id);
    if (stageOpen.length === 0) continue;
    const danger = stageOpen.filter((r) => r.riskFlags.includes("overdue")).length;
    const warning = stageOpen.filter(
      (r) =>
        !r.riskFlags.includes("overdue") &&
        (r.riskFlags.includes("due_soon") ||
          r.riskFlags.includes("missing_owner") ||
          r.riskFlags.includes("no_due_date"))
    ).length;
    stageBuckets.push({
      stageId: stage.id,
      stageLabel: stage.label,
      stageColor: stage.color,
      total: stageOpen.length,
      danger,
      warning,
      ok: stageOpen.length - danger - warning,
    });
  }
  const workMix: EnrollmentOverviewWorkMix = { stages: stageBuckets };

  const kpis: EnrollmentOverviewKpis = {
    peopleCount: accounts.length,
    zeroLoadCount: rows.filter((row) => row.openCount === 0).length,
    openRecordCount: rows.reduce((sum, row) => sum + row.openCount, 0),
    needsAttentionCount: rows.filter((row) => row.riskFlags.length > 0).length,
    unassignedCount: unassigned.length,
    overdueCount: rows.reduce((sum, row) => sum + row.overdueCount, 0),
  };

  return {
    program,
    generatedAt: now.toISOString(),
    thresholds,
    kpis,
    attention,
    workMix,
    rows: rows.sort((a, b) => b.openCount - a.openCount),
    unassigned: unassigned.sort((a, b) => b.ageSeconds - a.ageSeconds),
  };
}

// Ranks the workload pool for a single unassigned record by projected load
// after adding it. Deliberately simple (count-only tuple) vs CS's
// multi-signal comparator — Enrollment has no priority/SLA-load axes to
// balance against, so open-count is the whole signal.
export function rankEnrollmentRecommendation(
  snapshot: EnrollmentOverviewSnapshot,
  targetRecordId: string
): EnrollmentRecommendationCandidate[] {
  void targetRecordId; // reserved for future per-record weighting (e.g. by stage)
  return snapshot.rows
    .map((row) => {
      const projectedOpenCount = row.openCount + 1;
      const projectedStatus = statusFromOpenCount(projectedOpenCount, snapshot.thresholds);
      const hasRiskFlag = row.riskFlags.length > 0;
      return {
        email: row.email,
        name: row.name,
        currentStatus: row.status,
        projectedStatus,
        openCount: row.openCount,
        projectedOpenCount,
        hasRiskFlag,
        why: hasRiskFlag
          ? `Has ${row.riskFlags.length} active risk flag(s)`
          : `${row.openCount} open -> ${projectedOpenCount} after assignment`,
      };
    })
    .sort((a, b) => {
      if (a.hasRiskFlag !== b.hasRiskFlag) return a.hasRiskFlag ? 1 : -1;
      if (a.projectedOpenCount !== b.projectedOpenCount) return a.projectedOpenCount - b.projectedOpenCount;
      return a.email.localeCompare(b.email);
    });
}

export function enrollmentOverviewRecordStatuses(): readonly EnrollmentOverviewStatus[] {
  return ["free", "ok", "busy", "overloaded"];
}
