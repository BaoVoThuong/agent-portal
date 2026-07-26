# Enrollment Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Overview" workload dashboard to Health Enrollment (List/Overview switcher, per program tab), mirroring the CS Workload Overview (`src/lib/tasks/overview*.ts` + `CSWorkloadOverview.tsx`) but adapted to Enrollment's actual shape: no priority field, no SLA-minutes clock, and two programs (ACA/Medicare) with different stage vocabularies.

**Architecture:** Same three-layer split as CS Overview — pure aggregation functions (`src/lib/enrollment/overview.ts`, fully unit-tested, no I/O) fed by a data-fetch layer (`src/lib/enrollment/overview-data.ts`) that a new `GET /api/enrollment/overview?program=` route calls, rendered by a new client component (`EnrollmentOverview.tsx`) wired into the existing `EnrollmentClient.tsx` view switcher (the `List` button in the toolbar is currently a non-functional placeholder — this plan makes it a real switcher).

**Tech Stack:** Next.js App Router API routes, Supabase (service-role queries), React client component, Vitest for the pure aggregation layer.

## Global Constraints

- Overview is scoped to **one program at a time** — ACA and Medicare have different stage sets and must never be aggregated together in one row/bar. The `program` query param (already threaded everywhere else in this module) selects which snapshot loads.
- No priority field exists on `enrollment_records` — do not port CS's priority-pressure concept. Risk/workload signals are: overdue, due-soon, QC-stale, missing owner, missing due date (already computed ad hoc per-record in `EnrollmentClient.tsx`'s `enrollmentRisk`/`enrollmentNeedsAttention` — this plan promotes that logic into the shared aggregator so list-row flags and the Overview agree).
- No SLA-minutes clock exists — workload is **count-based** (open record count), not time-budget-based like CS's `slaLoadMinutes`.
- Reuse `resolveReminderSettings` from `@/lib/tasks/reminder-settings` for the QC-stale threshold (`qcHours`) — this is already the source of truth the enrollment cron (`src/app/api/cron/check-enrollment-due/route.ts:60-61`) uses; the Overview must flag the same records the cron would nudge about, not invent a second threshold.
- The "pool" of people is the same account/permission pool CS's Overview already resolves (`portal_account` + `task.work`/`task.manage` role permissions) — Enrollment's page already gates access on `PERMISSIONS.TASK_MANAGE`/`PERMISSIONS.TASK_WORK` (`src/app/(authed)/enrollment/page.tsx:18-21`), so it is the same pool, not a new one.
- Assigning from the Unassigned queue reuses the existing `PATCH /api/enrollment/:id` (optimistic-locked via `expected_updated_at`) — do **not** build a dedicated atomic RPC like CS's `assign_unassigned`. Enrollment's assignment frequency is far lower than CS's, so the race window the RPC exists to close doesn't apply here; note this as an intentional scope reduction, not an oversight.
- Follow existing formatting/style conventions in `EnrollmentClient.tsx` (Tailwind classes, `#hex` color literals, `useAnchoredMenu` for popovers) — this feature lives in that module's visual language, not a new one.

---

### Task 1: Overview types

**Files:**
- Create: `src/lib/enrollment/overview-types.ts`

**Interfaces:**
- Produces: `EnrollmentOverviewStatus`, `EnrollmentOverviewRiskFlag`, `ENROLLMENT_OVERVIEW_THRESHOLDS`, `EnrollmentOverviewAccount`, `EnrollmentOverviewRecordInput`, `EnrollmentOverviewRecordSummary`, `EnrollmentOverviewRow`, `EnrollmentOverviewAttentionBar`, `EnrollmentOverviewStageBucket`, `EnrollmentOverviewWorkMix`, `EnrollmentOverviewKpis`, `EnrollmentUnassignedOverviewRecord`, `EnrollmentOverviewSnapshot`, `EnrollmentRecommendationCandidate` — every later task imports from here.

- [ ] **Step 1: Write the file**

```typescript
import type { EnrollmentProgram } from "./types";

export const ENROLLMENT_OVERVIEW_STATUSES = ["free", "ok", "busy", "overloaded"] as const;
export type EnrollmentOverviewStatus = (typeof ENROLLMENT_OVERVIEW_STATUSES)[number];

// Enrollment has no priority field and no SLA-minutes clock, so risk is
// purely about due dates, QC turnaround, and missing ownership — not
// priority-pressure like CS's overview.
export const ENROLLMENT_OVERVIEW_RISK_FLAGS = [
  "overdue",
  "due_soon",
  "qc_stale",
  "missing_owner",
  "no_due_date",
] as const;
export type EnrollmentOverviewRiskFlag = (typeof ENROLLMENT_OVERVIEW_RISK_FLAGS)[number];

// Count-based thresholds (no SLA-minutes axis exists for Enrollment).
// Starter values — same "just a constant" pattern CS's OVERVIEW_THRESHOLDS
// uses; revisit once real per-person open-load volume is observed.
export const ENROLLMENT_OVERVIEW_THRESHOLDS = {
  version: "v1",
  openBusy: 5,
  openOverloaded: 10,
} as const;
export type EnrollmentOverviewThresholds = typeof ENROLLMENT_OVERVIEW_THRESHOLDS;

export type EnrollmentOverviewAccount = {
  email: string;
  name: string | null;
  isActive: boolean;
  canWork: boolean;
  isAdmin: boolean;
};

export type EnrollmentOverviewRecordInput = {
  id: string;
  program: EnrollmentProgram;
  client_name: string | null;
  stage_id: string | null;
  responsible_enroll_email: string | null;
  due_date: string | null;
  qc_checked_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type EnrollmentOverviewRecordSummary = {
  id: string;
  clientName: string | null;
  stageId: string | null;
  createdAt: string;
  dueDate: string | null;
  riskFlags: EnrollmentOverviewRiskFlag[];
};

export type EnrollmentOverviewRow = {
  email: string;
  name: string | null;
  openCount: number;
  overdueCount: number;
  qcStaleCount: number;
  riskFlags: EnrollmentOverviewRiskFlag[];
  oldestOpenCreatedAt: string | null;
  oldestOpenAgeSeconds: number | null;
  done7d: number;
  status: EnrollmentOverviewStatus;
  records: EnrollmentOverviewRecordSummary[];
};

export type EnrollmentOverviewAttentionBar = {
  key: EnrollmentOverviewRiskFlag;
  label: string;
  recordCount: number;
  affectedPeopleCount: number;
};

// One bucket per stage that has >=1 open record, ordered by stage position.
// A literal stage x risk-tone matrix (like CS's fixed 5-status table) isn't a
// good fit here because ACA alone has 14 configurable stages — a histogram
// with risk-tone shading scales to however many stages are actually in use.
export type EnrollmentOverviewStageBucket = {
  stageId: string;
  stageLabel: string;
  stageColor: string | null;
  total: number;
  danger: number;
  warning: number;
  ok: number;
};

export type EnrollmentOverviewWorkMix = {
  stages: EnrollmentOverviewStageBucket[];
};

export type EnrollmentOverviewKpis = {
  peopleCount: number;
  zeroLoadCount: number;
  openRecordCount: number;
  needsAttentionCount: number;
  unassignedCount: number;
  overdueCount: number;
};

export type EnrollmentUnassignedOverviewRecord = {
  id: string;
  clientName: string | null;
  stageId: string | null;
  stageLabel: string | null;
  stageColor: string | null;
  dueDate: string | null;
  createdAt: string;
  ageSeconds: number;
  isOverdue: boolean;
};

export type EnrollmentOverviewSnapshot = {
  program: EnrollmentProgram;
  generatedAt: string;
  thresholds: EnrollmentOverviewThresholds;
  kpis: EnrollmentOverviewKpis;
  attention: EnrollmentOverviewAttentionBar[];
  workMix: EnrollmentOverviewWorkMix;
  rows: EnrollmentOverviewRow[];
  unassigned: EnrollmentUnassignedOverviewRecord[];
};

export type EnrollmentRecommendationCandidate = {
  email: string;
  name: string | null;
  currentStatus: EnrollmentOverviewStatus;
  projectedStatus: EnrollmentOverviewStatus;
  openCount: number;
  projectedOpenCount: number;
  hasRiskFlag: boolean;
  why: string;
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/enrollment/overview-types.ts
git commit -m "feat(enrollment): add overview types"
```

---

### Task 2: Pure aggregation logic (`overview.ts`) — TDD

**Files:**
- Create: `src/lib/enrollment/overview.ts`
- Test: `src/lib/enrollment/overview.test.ts`

**Interfaces:**
- Consumes: types from Task 1; `enrollmentIsOverdue`, `enrollmentIsDueSoon` from `./helpers` (already exist — reuse, don't reimplement); `EnrollmentOption` from `./types`.
- Produces: `aggregateEnrollmentOverview(input): EnrollmentOverviewSnapshot`, `rankEnrollmentRecommendation(snapshot, targetRecordId): EnrollmentRecommendationCandidate[]`, `enrollmentOverviewRecordStatuses()` — Task 3 (data layer) and Task 6 (UI) both call these.

This task follows the existing test-first convention in `src/lib/tasks/overview.test.ts` — write the failing tests first, then the implementation.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { aggregateEnrollmentOverview, rankEnrollmentRecommendation } from "./overview";
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

describe("aggregateEnrollmentOverview", () => {
  it("keeps a zero-load account visible in the workload rows", () => {
    const snapshot = aggregateEnrollmentOverview({
      now,
      program: "aca",
      accounts: [account("cs@x.com")],
      stageOptions: [stageOption()],
      records: [],
      thresholds: { version: "v1", openBusy: 5, openOverloaded: 10 },
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
      thresholds: { version: "v1", openBusy: 5, openOverloaded: 10 },
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
      thresholds: { version: "v1", openBusy: 5, openOverloaded: 10 },
      qcStaleHours: 48,
    });
    expect(snapshot.rows[0].qcStaleCount).toBe(1);
    expect(snapshot.kpis.needsAttentionCount).toBe(1);
  });

  it("derives status from open count using the count-only thresholds", () => {
    const records = Array.from({ length: 6 }, (_, i) => record({ id: `r${i}` }));
    const snapshot = aggregateEnrollmentOverview({
      now,
      program: "aca",
      accounts: [account("cs@x.com")],
      stageOptions: [stageOption()],
      records,
      thresholds: { version: "v1", openBusy: 5, openOverloaded: 10 },
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
      thresholds: { version: "v1", openBusy: 5, openOverloaded: 10 },
      qcStaleHours: 48,
    });
    expect(snapshot.unassigned).toHaveLength(1);
    expect(snapshot.kpis.unassignedCount).toBe(1);
    expect(snapshot.rows[0].openCount).toBe(0);
  });

  it("builds one work-mix bucket per stage that has open records, in stage position order", () => {
    const stage1 = stageOption({ id: "s1", position: 10, label: "1-Need quote" });
    const stage2 = stageOption({ id: "s2", position: 20, label: "2-Quoted" });
    const snapshot = aggregateEnrollmentOverview({
      now,
      program: "aca",
      accounts: [account("cs@x.com")],
      stageOptions: [stage2, stage1], // deliberately out of order
      records: [record({ id: "r1", stage_id: "s2" }), record({ id: "r2", stage_id: "s1" })],
      thresholds: { version: "v1", openBusy: 5, openOverloaded: 10 },
      qcStaleHours: 48,
    });
    expect(snapshot.workMix.stages.map((s) => s.stageId)).toEqual(["s1", "s2"]);
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
      thresholds: { version: "v1", openBusy: 5, openOverloaded: 10 },
      qcStaleHours: 48,
    });
    const ranked = rankEnrollmentRecommendation(snapshot, "target");
    expect(ranked[0].email).toBe("free@x.com");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/enrollment/overview.test.ts`
Expected: FAIL — `overview.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
import { enrollmentIsDueSoon, enrollmentIsOverdue } from "./helpers";
import type { EnrollmentOption, EnrollmentProgram } from "./types";
import {
  ENROLLMENT_OVERVIEW_RISK_FLAGS,
  type EnrollmentOverviewAccount,
  type EnrollmentOverviewAttentionBar,
  type EnrollmentOverviewKpis,
  type EnrollmentOverviewRecordInput,
  type EnrollmentOverviewRecordSummary,
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

  const rows: EnrollmentOverviewRow[] = [...buckets.values()].map(({ account, openRecords, qcStale, done7dCount }) => {
    const openCount = openRecords.length;
    const overdueCount = openRecords.filter((r) => r.riskFlags.includes("overdue")).length;
    const riskFlags = [...new Set(openRecords.flatMap((r) => r.riskFlags).concat(qcStale.map(() => "qc_stale" as const)))];
    const oldest = openRecords
      .map((r) => r.record.created_at)
      .sort((a, b) => a.localeCompare(b))[0] ?? null;

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
  });

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
      (r) => !r.riskFlags.includes("overdue") && (r.riskFlags.includes("due_soon") || r.riskFlags.includes("missing_owner") || r.riskFlags.includes("no_due_date"))
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/enrollment/overview.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrollment/overview.ts src/lib/enrollment/overview.test.ts
git commit -m "feat(enrollment): add pure overview aggregation + recommendation ranking"
```

---

### Task 3: Data-fetch layer

**Files:**
- Create: `src/lib/enrollment/overview-data.ts`

**Interfaces:**
- Consumes: `aggregateEnrollmentOverview` from Task 2; `resolveReminderSettings` from `@/lib/tasks/reminder-settings`; `EnrollmentProgram` from `./types`.
- Produces: `fetchEnrollmentOverview(program, now?): Promise<EnrollmentOverviewSnapshot>` — Task 5 (API route) calls this.

- [ ] **Step 1: Write the file**

```typescript
import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveReminderSettings } from "@/lib/tasks/reminder-settings";
import { aggregateEnrollmentOverview } from "./overview";
import type { EnrollmentOverviewAccount, EnrollmentOverviewRecordInput, EnrollmentOverviewSnapshot } from "./overview-types";
import type { EnrollmentOption, EnrollmentProgram } from "./types";

const OVERVIEW_RECORD_COLUMNS =
  "id,program,client_name,stage_id,responsible_enroll_email,due_date,qc_checked_at,closed_at,created_at,updated_at,archived_at";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function fetchEnrollmentOverview(
  program: EnrollmentProgram,
  now = new Date()
): Promise<EnrollmentOverviewSnapshot> {
  const supabase = getSupabaseAdmin();
  const [accountsResult, rolesResult, rolePermissionsResult, userRolesResult, stageSetResult, recordsResult, reminderResult] =
    await Promise.all([
      supabase.from("portal_account").select("id,email,name,is_active,role"),
      supabase.from("roles").select("id,name,is_active"),
      supabase
        .from("role_permissions")
        .select("role_id,permission_key")
        .in("permission_key", ["task.work", "task.manage"]),
      supabase.from("user_roles").select("user_id,role_id"),
      supabase
        .from("enrollment_option_sets")
        .select("id,enrollment_options(id,set_id,label,color,position,is_terminal,triggers_qc,archived_at)")
        .eq("program", program)
        .eq("key", "stage")
        .maybeSingle(),
      supabase
        .from("enrollment_records")
        .select(OVERVIEW_RECORD_COLUMNS)
        .eq("program", program)
        .is("archived_at", null),
      supabase.from("task_reminder_settings").select("*").maybeSingle(),
    ]);

  const firstError = [
    accountsResult.error,
    rolesResult.error,
    rolePermissionsResult.error,
    userRolesResult.error,
    stageSetResult.error,
    recordsResult.error,
    reminderResult.error,
  ].find(Boolean);
  if (firstError) throw new Error(firstError.message);

  const accounts = (accountsResult.data ?? []) as Array<{
    id: string;
    email: string;
    name: string | null;
    is_active: boolean;
    role: string;
  }>;
  const roles = (rolesResult.data ?? []) as Array<{ id: string; name: string; is_active: boolean }>;
  const rolePermissions = (rolePermissionsResult.data ?? []) as Array<{ role_id: string; permission_key: string }>;
  const userRoles = (userRolesResult.data ?? []) as Array<{ user_id: string; role_id: string }>;

  const activeRoleIds = new Set(roles.filter((role) => role.is_active).map((role) => role.id));
  const workRoleIds = new Set(
    rolePermissions
      .filter((row) => row.permission_key === "task.work" && activeRoleIds.has(row.role_id))
      .map((row) => row.role_id)
  );
  const activeAdminRoleIds = new Set(
    roles.filter((role) => role.is_active && (role.name === "Admin" || role.name === "Super Admin")).map((role) => role.id)
  );
  const workUserIds = new Set(userRoles.filter((row) => workRoleIds.has(row.role_id)).map((row) => row.user_id));
  const adminUserIds = new Set(userRoles.filter((row) => activeAdminRoleIds.has(row.role_id)).map((row) => row.user_id));

  const normalizedAccounts: EnrollmentOverviewAccount[] = accounts
    .filter((account) => account.is_active)
    .map((account) => ({
      email: normalizeEmail(account.email),
      name: account.name,
      isActive: account.is_active,
      canWork: workUserIds.has(account.id),
      isAdmin: account.role === "admin" || adminUserIds.has(account.id),
    }))
    .filter((account) => account.canWork || account.isAdmin);

  const stageSet = stageSetResult.data as {
    id: string;
    enrollment_options: EnrollmentOption[];
  } | null;
  const stageOptions = (stageSet?.enrollment_options ?? []).filter((option) => !option.archived_at);

  const records = ((recordsResult.data ?? []) as EnrollmentOverviewRecordInput[]).map((record) => ({
    ...record,
    responsible_enroll_email: record.responsible_enroll_email
      ? normalizeEmail(record.responsible_enroll_email)
      : null,
  }));

  const reminderSettings = resolveReminderSettings(reminderResult.data);

  return aggregateEnrollmentOverview({
    now,
    program,
    accounts: normalizedAccounts,
    stageOptions,
    records,
    thresholds: { version: "v1", openBusy: 5, openOverloaded: 10 },
    qcStaleHours: reminderSettings.qcHours,
  });
}
```

- [ ] **Step 2: Verify the Supabase embedded-select shape**

The `enrollment_option_sets(...)` embedded select for stage options depends on `enrollment_options` having a `set_id` foreign key to `enrollment_option_sets` (it does — see `supabase/schema.sql`). Run `npx tsc --noEmit` after this step; if the embedded-select return shape doesn't match, replace it with two separate queries (fetch the stage set id, then fetch its options) — same pattern `src/lib/enrollment/options.ts:fetchEnrollmentOptionData` already uses. Prefer matching that existing pattern for consistency if the embedded select is awkward.

Run: `npx tsc --noEmit`
Expected: no new errors in `overview-data.ts`

- [ ] **Step 3: Commit**

```bash
git add src/lib/enrollment/overview-data.ts
git commit -m "feat(enrollment): add overview data-fetch layer"
```

---

### Task 4: API route

**Files:**
- Create: `src/app/api/enrollment/overview/route.ts`

**Interfaces:**
- Consumes: `fetchEnrollmentOverview` from Task 3; `loadEnrollmentActor` from `@/lib/enrollment/access` (same access gate every other enrollment route uses); `toEnrollmentProgram` from `@/lib/enrollment/types`.

- [ ] **Step 1: Write the file**

```typescript
import { NextResponse } from "next/server";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { fetchEnrollmentOverview } from "@/lib/enrollment/overview-data";
import { toEnrollmentProgram } from "@/lib/enrollment/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json({ error: actorResult.error }, { status: actorResult.status });
  }

  const program = toEnrollmentProgram(new URL(request.url).searchParams.get("program"));
  const snapshot = await fetchEnrollmentOverview(program);
  return NextResponse.json(snapshot);
}
```

- [ ] **Step 2: Manual verification**

Run: `npm run dev`, then `curl -s "http://localhost:3000/api/enrollment/overview?program=aca" | head -c 500` while logged in (or check in-browser via the Network tab once Task 6 wires the UI).
Expected: JSON snapshot with `kpis`, `attention`, `workMix`, `rows`, `unassigned`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/enrollment/overview/route.ts
git commit -m "feat(enrollment): add GET /api/enrollment/overview route"
```

---

### Task 5: `EnrollmentOverview` UI component

**Files:**
- Create: `src/app/(authed)/enrollment/_components/EnrollmentOverview.tsx`

**Interfaces:**
- Consumes: `EnrollmentOverviewSnapshot` type (Task 1); fetches `/api/enrollment/overview?program=` itself (client component, own loading state — mirrors how `EnrollmentClient` already self-fetches `/api/enrollment/option-sets`).
- Produces: `EnrollmentOverview({ program, onOpenRecord }: { program: EnrollmentProgram; onOpenRecord: (id: string) => void })` — Task 6 renders this when the view switcher is on "Overview".

Structure (mirror `CSWorkloadOverview.tsx`'s visual language — `MetricTile`, `StatusBadge`, section cards with `text-sm font-bold text-[#172b4d]` headers — but swap CS's SLA/priority sections for Enrollment's count/stage-risk sections):

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import type {
  EnrollmentOverviewAttentionBar,
  EnrollmentOverviewRow,
  EnrollmentOverviewSnapshot,
  EnrollmentOverviewStatus,
  EnrollmentRecommendationCandidate,
} from "@/lib/enrollment/overview-types";
import type { EnrollmentProgram } from "@/lib/enrollment/types";
import { formatEmailAsName } from "@/lib/tasks/people";
import { Initials } from "../../tasks/_components/board-ui";

const STATUS_STYLE: Record<EnrollmentOverviewStatus, { bg: string; fg: string; label: string }> = {
  free: { bg: "#e3fcef", fg: "#00875a", label: "Free" },
  ok: { bg: "#e6effd", fg: "#0c66e4", label: "OK" },
  busy: { bg: "#fff7d6", fg: "#7f5f01", label: "Busy" },
  overloaded: { bg: "#ffebe6", fg: "#bf2600", label: "Overloaded" },
};

export function EnrollmentOverview({
  program,
  onOpenRecord,
  onAssign,
}: {
  program: EnrollmentProgram;
  onOpenRecord: (id: string) => void;
  onAssign: (recordId: string, email: string) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<EnrollmentOverviewSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusedFlag, setFocusedFlag] = useState<string | null>(null);
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [recommendFor, setRecommendFor] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/enrollment/overview?program=${program}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load overview.");
      setSnapshot((await response.json()) as EnrollmentOverviewSnapshot);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load overview.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setSnapshot(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program]);

  if (loading && !snapshot) {
    return <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]">Loading overview...</div>;
  }
  if (error || !snapshot) {
    return <div className="rounded border border-[#ffbdad] bg-[#ffebe6] px-6 py-4 text-sm font-bold text-[#bf2600]">{error ?? "No data."}</div>;
  }

  const filteredRows = focusedFlag
    ? snapshot.rows.filter((row) => row.riskFlags.includes(focusedFlag as never))
    : snapshot.rows;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-[#6b778c]">
          Generated {new Date(snapshot.generatedAt).toLocaleTimeString()}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-[#cfd8e5] bg-white px-2.5 text-xs font-bold text-[#344054] hover:bg-[#f8fafc]"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile label="People" value={snapshot.kpis.peopleCount} />
        <MetricTile label="Free" value={snapshot.kpis.zeroLoadCount} tone="ok" />
        <MetricTile label="Open records" value={snapshot.kpis.openRecordCount} />
        <MetricTile label="Overdue" value={snapshot.kpis.overdueCount} tone={snapshot.kpis.overdueCount > 0 ? "danger" : "default"} />
        <MetricTile label="Needs attention" value={snapshot.kpis.needsAttentionCount} tone={snapshot.kpis.needsAttentionCount > 0 ? "warning" : "default"} />
        <MetricTile label="Unassigned" value={snapshot.kpis.unassignedCount} tone={snapshot.kpis.unassignedCount > 0 ? "warning" : "default"} />
      </div>

      <div className="rounded-lg border border-[#e6eaf0] bg-white p-4">
        <h3 className="text-sm font-bold text-[#172b4d]">Attention areas</h3>
        <p className="mt-1 text-xs text-[#667085]">Click a bar to focus the table below on the affected people.</p>
        <div className="mt-3 space-y-2">
          {snapshot.attention.map((bar) => (
            <AttentionRow key={bar.key} bar={bar} active={focusedFlag === bar.key} onClick={() => setFocusedFlag((current) => (current === bar.key ? null : bar.key))} />
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[#e6eaf0] bg-white p-4">
        <h3 className="text-sm font-bold text-[#172b4d]">Work mix by stage</h3>
        <p className="mt-1 text-xs text-[#667085]">Open records per stage, shaded by risk (red = overdue, amber = at risk, green = on track).</p>
        <div className="mt-3 space-y-1.5">
          {snapshot.workMix.stages.map((stage) => (
            <div key={stage.stageId} className="flex items-center gap-2 text-xs">
              <span className="w-40 shrink-0 truncate font-semibold text-[#42526e]">{stage.stageLabel}</span>
              <div className="flex h-4 flex-1 overflow-hidden rounded bg-[#f4f5f7]">
                {stage.danger > 0 ? <div style={{ width: `${(stage.danger / stage.total) * 100}%`, backgroundColor: "#ff5630" }} /> : null}
                {stage.warning > 0 ? <div style={{ width: `${(stage.warning / stage.total) * 100}%`, backgroundColor: "#ffab00" }} /> : null}
                {stage.ok > 0 ? <div style={{ width: `${(stage.ok / stage.total) * 100}%`, backgroundColor: "#36b37e" }} /> : null}
              </div>
              <span className="w-8 shrink-0 text-right font-bold text-[#172b4d]">{stage.total}</span>
            </div>
          ))}
          {snapshot.workMix.stages.length === 0 ? <p className="text-xs text-[#97a0af]">No open records.</p> : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#e6eaf0] bg-white">
        <div className="flex items-center justify-between border-b border-[#e6eaf0] px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-[#172b4d]">Workload</h3>
            <p className="mt-1 text-xs text-[#667085]">{filteredRows.length} of {snapshot.rows.length} people shown.</p>
          </div>
          {focusedFlag ? (
            <button type="button" onClick={() => setFocusedFlag(null)} className="text-xs font-bold text-[#0c66e4] hover:underline">
              Clear filter
            </button>
          ) : null}
        </div>
        <ul className="divide-y divide-[#ebecf0]">
          {filteredRows.map((row) => (
            <WorkloadRow
              key={row.email}
              row={row}
              expanded={expandedEmail === row.email}
              onToggle={() => setExpandedEmail((current) => (current === row.email ? null : row.email))}
              onOpenRecord={onOpenRecord}
            />
          ))}
        </ul>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#e6eaf0] bg-white">
        <div className="border-b border-[#e6eaf0] px-4 py-3">
          <h3 className="text-sm font-bold text-[#172b4d]">Unassigned queue</h3>
          <p className="mt-1 text-xs text-[#667085]">{snapshot.unassigned.length} record(s) waiting for an owner.</p>
        </div>
        <ul className="divide-y divide-[#ebecf0]">
          {snapshot.unassigned.map((record) => (
            <li key={record.id} className="flex items-center gap-3 px-4 py-2.5">
              <button type="button" onClick={() => onOpenRecord(record.id)} className="min-w-0 flex-1 truncate text-left text-sm font-medium text-[#172b4d] hover:text-[#0c66e4]">
                {record.clientName || "Unnamed client"}
              </button>
              {record.isOverdue ? <AlertTriangle className="h-4 w-4 shrink-0 text-[#ff5630]" /> : null}
              <button
                type="button"
                onClick={() => setRecommendFor((current) => (current === record.id ? null : record.id))}
                className="shrink-0 rounded border border-[#cfd8e5] bg-white px-2 py-1 text-xs font-bold text-[#344054] hover:bg-[#f8fafc]"
              >
                Recommend
              </button>
            </li>
          ))}
          {snapshot.unassigned.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-[#97a0af]">Nothing unassigned.</li>
          ) : null}
        </ul>
        {recommendFor ? (
          <RecommendationPanel
            snapshot={snapshot}
            recordId={recommendFor}
            onAssign={async (email) => {
              await onAssign(recommendFor, email);
              setRecommendFor(null);
              void load();
            }}
            onClose={() => setRecommendFor(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

function MetricTile({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "ok" | "warning" | "danger" }) {
  const toneClass = {
    default: "text-[#172b4d]",
    ok: "text-[#00875a]",
    warning: "text-[#b76e00]",
    danger: "text-[#bf2600]",
  }[tone];
  return (
    <div className="rounded-lg border border-[#e6eaf0] bg-white p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#8993a4]">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

function AttentionRow({ bar, active, onClick }: { bar: EnrollmentOverviewAttentionBar; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded px-2 py-1.5 text-left transition ${active ? "bg-[#deebff]" : "hover:bg-[#f7f8fa]"}`}
    >
      <span className="w-28 shrink-0 text-xs font-semibold text-[#42526e]">{bar.label}</span>
      <span className="text-xs text-[#6b778c]">{bar.recordCount} record(s) &middot; {bar.affectedPeopleCount} people</span>
    </button>
  );
}

function WorkloadRow({
  row,
  expanded,
  onToggle,
  onOpenRecord,
}: {
  row: EnrollmentOverviewRow;
  expanded: boolean;
  onToggle: () => void;
  onOpenRecord: (id: string) => void;
}) {
  const style = STATUS_STYLE[row.status];
  const label = row.name?.trim() || formatEmailAsName(row.email);
  return (
    <li>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f7f8f9]">
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-[#6b778c]" /> : <ChevronRight className="h-4 w-4 shrink-0 text-[#6b778c]" />}
        <Initials email={row.email} label={label} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#172b4d]">{label}</span>
        <span className="rounded px-2 py-0.5 text-[11px] font-bold uppercase" style={{ backgroundColor: style.bg, color: style.fg }}>
          {style.label}
        </span>
        <span className="w-16 shrink-0 text-right text-sm font-bold text-[#172b4d]">{row.openCount} open</span>
        {row.overdueCount > 0 ? <span className="shrink-0 text-xs font-bold text-[#bf2600]">{row.overdueCount} overdue</span> : null}
      </button>
      {expanded ? (
        <ul className="space-y-1 bg-[#fafbfc] px-4 py-2 pl-11">
          {row.records.map((record) => (
            <li key={record.id}>
              <button type="button" onClick={() => onOpenRecord(record.id)} className="text-xs font-medium text-[#42526e] hover:text-[#0c66e4]">
                {record.clientName || "Unnamed client"}
              </button>
            </li>
          ))}
          {row.records.length === 0 ? <li className="text-xs text-[#97a0af]">No open records.</li> : null}
        </ul>
      ) : null}
    </li>
  );
}

function RecommendationPanel({
  snapshot,
  recordId,
  onAssign,
  onClose,
}: {
  snapshot: EnrollmentOverviewSnapshot;
  recordId: string;
  onAssign: (email: string) => Promise<void>;
  onClose: () => void;
}) {
  const [assigning, setAssigning] = useState<string | null>(null);
  const candidates = rankLocally(snapshot);

  return (
    <div className="border-t border-[#e6eaf0] bg-[#f7f8fa] p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wide text-[#8993a4]">Who has room?</h4>
        <button type="button" onClick={onClose} className="text-xs font-bold text-[#6b778c] hover:underline">Close</button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {candidates.slice(0, 5).map((candidate) => (
          <li key={candidate.email} className="flex items-center justify-between rounded border border-[#e6eaf0] bg-white px-3 py-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-[#172b4d]">
              {candidate.hasRiskFlag ? <AlertTriangle className="h-3.5 w-3.5 text-[#ffab00]" /> : <Check className="h-3.5 w-3.5 text-[#00875a]" />}
              {candidate.name?.trim() || formatEmailAsName(candidate.email)}
            </span>
            <span className="text-xs text-[#6b778c]">{candidate.openCount} to {candidate.projectedOpenCount}</span>
            <button
              type="button"
              disabled={assigning === candidate.email}
              onClick={async () => {
                setAssigning(candidate.email);
                await onAssign(candidate.email);
                setAssigning(null);
              }}
              className="rounded bg-[#0c66e4] px-2 py-1 text-xs font-bold text-white hover:bg-[#0055cc] disabled:opacity-50"
            >
              Assign
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  function rankLocally(snap: EnrollmentOverviewSnapshot): EnrollmentRecommendationCandidate[] {
    return snap.rows
      .map((row) => ({
        email: row.email,
        name: row.name,
        currentStatus: row.status,
        projectedStatus: row.status,
        openCount: row.openCount,
        projectedOpenCount: row.openCount + 1,
        hasRiskFlag: row.riskFlags.length > 0,
        why: "",
      }))
      .sort((a, b) => {
        if (a.hasRiskFlag !== b.hasRiskFlag) return a.hasRiskFlag ? 1 : -1;
        return a.projectedOpenCount - b.projectedOpenCount;
      });
  }
}
```

> Note on Step 1: the `RecommendationPanel`'s local `rankLocally` duplicates `rankEnrollmentRecommendation`'s comparator instead of calling it directly, because `rankEnrollmentRecommendation` is a server/pure-logic export and this keeps the component self-contained for the client bundle. If bundling `overview.ts`'s pure functions client-side turns out to be fine (it has no server-only imports — check `getSupabaseAdmin` isn't transitively pulled in), delete `rankLocally` and call `rankEnrollmentRecommendation(snapshot, recordId)` directly instead. Prefer that if it works — don't leave both implementations if one call site path is unnecessary.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/EnrollmentOverview.tsx"
git commit -m "feat(enrollment): add EnrollmentOverview UI component"
```

---

### Task 6: Wire the List/Overview switcher into `EnrollmentClient`

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`

**Interfaces:**
- Consumes: `EnrollmentOverview` from Task 5.

The toolbar currently renders a single non-functional `List` button (`src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, inside `EnrollmentToolbar`, `aria-current="page"` with no `onClick`). This step makes it a real two-way switch and conditionally renders the table vs. the new Overview.

- [ ] **Step 1: Add a `view` state to `EnrollmentClient`**

Find the `const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);` line and add directly after it:

```typescript
const [view, setView] = useState<"list" | "overview">("list");
```

- [ ] **Step 2: Replace the static List button with a real switcher**

In `EnrollmentToolbar`, add `view` and `onViewChange` props, and replace:

```tsx
<div className="inline-flex shrink-0 rounded bg-[#f4f5f7] p-0.5">
  <button
    type="button"
    className="rounded bg-white px-3 py-1.5 text-sm font-semibold text-[#0c66e4] shadow-sm"
    aria-current="page"
  >
    List
  </button>
</div>
```

with:

```tsx
<div className="inline-flex shrink-0 rounded bg-[#f4f5f7] p-0.5">
  {(["list", "overview"] as const).map((key) => (
    <button
      key={key}
      type="button"
      onClick={() => onViewChange(key)}
      aria-current={view === key ? "page" : undefined}
      className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
        view === key ? "bg-white text-[#0c66e4] shadow-sm" : "text-[#5e6c84] hover:text-[#172b4d]"
      }`}
    >
      {key === "list" ? "List" : "Overview"}
    </button>
  ))}
</div>
```

Update the `EnrollmentToolbar` props type and destructure to include `view: "list" | "overview"` and `onViewChange: (view: "list" | "overview") => void`.

- [ ] **Step 3: Pass `view`/`onViewChange` at the call site and conditionally render**

Update the `<EnrollmentToolbar ...>` call in `EnrollmentClient` to pass `view={view}` and `onViewChange={setView}`.

Replace the `<EnrollmentTable ... />` block with:

```tsx
{view === "list" ? (
  <EnrollmentTable
    program={program}
    records={visibleRecords}
    peopleByEmail={peopleByEmail}
    optionsById={optionsById}
    optionsBySet={optionsBySet}
    sort={sort}
    onSort={(key) => /* unchanged */}
    onOpen={openRecordById}
    onPatch={patchRecord}
  />
) : (
  <EnrollmentOverview
    program={program}
    onOpenRecord={openRecordById}
    onAssign={(recordId, email) => patchRecord(recordId, { responsible_enroll_email: email })}
  />
)}
```

(Keep the existing `onSort` callback body — this snippet only shows the wrapping change.)

- [ ] **Step 4: Import `EnrollmentOverview`**

Add near the other cross-module imports:

```typescript
import { EnrollmentOverview } from "./EnrollmentOverview";
```

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"`
Expected: no errors

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open `/enrollment?program=aca`, click "Overview", confirm KPIs/attention/work-mix/workload/unassigned all render with the seeded sample data (20 ACA records). Switch to the `Medicare Enroll` tab and confirm Overview renders there too (with the 7 Medicare sample records, fewer stages).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"
git commit -m "feat(enrollment): wire List/Overview switcher into the toolbar"
```

---

## Self-Review Notes (already applied above)

- **Spec coverage:** KPIs ✓, attention areas ✓, work mix ✓, per-person workload table with expand ✓, unassigned queue + recommend + assign ✓, program-scoped (no ACA/Medicare mixing) ✓.
- **Placeholder scan:** none — every step has real code.
- **Type consistency:** `EnrollmentOverviewSnapshot`/`EnrollmentOverviewRow`/etc. defined once in Task 1 and reused verbatim through Tasks 2–6; `rankEnrollmentRecommendation`'s signature matches its two call sites (test in Task 2, noted-as-preferred-if-it-works direct call in Task 5).
- **Known follow-up, not blocking:** the "outside pool" case (a record assigned to someone outside the resolved account pool) is explicitly out of scope for v1 per the comment in Task 2 — add a panel for it only if it turns out to happen with real data, mirroring how CS's Overview added that panel after a real gap was found, not preemptively.
