# Enrollment ACA Overview — Data & Calculation Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete server-side data layer for the redesigned ACA enrollment Overview — a config-driven terminal-stage rule, a selectable staleness threshold, and pure aggregation functions producing every scorecard and table defined in the spec — exposed through one API endpoint, with no UI changes.

**Architecture:** All aggregation is pure functions in `src/lib/enrollment/`, one file per section of the dashboard, each independently unit-testable with plain object fixtures and no database. Data access stays in two places only: an extended fetch in `aca-overview-data.ts` and one new SQL function for last-real-activity. The API route composes fetch → aggregate → JSON. This mirrors how `overview.ts` / `overview-data.ts` / `app/api/enrollment/overview/route.ts` are already split, so the existing test style (`src/lib/enrollment/overview.test.ts`) carries over unchanged.

**Tech Stack:** TypeScript, Next.js App Router route handlers, Supabase (PostgREST + `plpgsql` functions), Vitest (node environment, colocated `*.test.ts`).

**Spec:** `docs/superpowers/specs/2026-08-13-enrollment-aca-overview-design.md`

> ## Revision history — read this before executing
>
> Three reviews landed after the first draft, and the owner settled four open decisions. **All of it has been applied to the tasks below**; this block records what changed and why, so a reviewer can see the reasoning without re-deriving it. The tasks are current — execute them as written.
>
> **1. APPLIED — Tasks 10 and 11 used the wrong mechanism.** They derived *days silent* and *last assigned at* by scanning `enrollment_activity` at read time. Measured cost at 5,000 records: **~55 sequential requests and ~50,000 rows per page load**, over a table whose only index is `(record_id, created_at desc)`. Worse, the last-assigned derivation is wrong regardless of cost: a **caller-only** edit writes a `people_changed` row carrying the *unchanged* responsible person (`[id]/route.ts:253-254, 406-409`), which would reset that person's queue position for free.
>
> **Replace with two denormalised columns on `enrollment_records`,** maintained inside `patch_enrollment_atomic` and `create_enrollment_atomic` — the same shape CS already uses for its queue (`task_assignment_rotation`, `schema.sql:3020-3074`):
> - `last_work_activity_at` — bumped when the activity being written is real work, not a comment or a `system` actor.
> - `responsible_assigned_at` — bumped only when `responsible_enroll_email` actually changes.
>
> Both then arrive on the record fetch that already happens, at **zero extra queries**, and the F9 create-time gap and the caller-only bug both disappear rather than needing to be worked around. Affected tasks: **2** (drop `LastRealActivityMap` / `LastAssignedMap`, add the two fields to `AcaOverviewRecord`), **4** (`daysSilent` reads the record field), **9** (queue reads the record field), **10** (columns + RPC maintenance instead of the two SQL functions), **11** (drop both `.rpc()` calls).
>
> **2. APPLIED — Task 11b must not reuse the CS queue table.** `task_assignment_queue_members` is keyed on email with no program column, **and the CS assignment RPC refuses to assign to a disabled member** (`schema.sql:3171-3175`). Toggling someone off for enrollment would make them un-assignable for CS. The separate table in Task 11b is correct — but it additionally needs a **seeding rule**, because a person newly toggled on has no assignment history and pins to queue position #1 permanently until they receive a record. CS solves this by defaulting the rotation row to `now()` on creation.
>
> **3. APPLIED — the four owner decisions** (spec §12b items 1-4, decided 2026-08-13). Three of them changed this plan:
>
> - **Manager/admin only, unscoped.** Task 11's `fetchAcaOverviewInput` must **drop `applyEnrollmentScope` entirely** and the Task 12 route must gate on `actor.isManager` instead of resolving a scope. As written, Task 11 passes a `scope` argument — remove it.
> - **Backfilled stage clocks are counted, not excluded.** Task 4's `daysInStage` as written returns `null` for any `stage_entered_source !== "live"`, which implements the *rejected* option. Change it to compute the age regardless, and return the measured flag alongside so the UI can style estimates differently: `{ days: number | null; measured: boolean }`. Every caller (Tasks 5, 6, 7, 8, 9) reads `.days` and passes `.measured` through.
> - **Every section obeys the date range, including the person-facing ones.** No section opts out. Two mandatory consequences: the default preset for this dashboard is **`All dates`** (not `thisMonth` — Task 11b's `fetchAcaDefaultThresholdDays` has a sibling default to add), and the queue and people table must carry a visible range caption. See spec §12b item 3 for why the caption is load-bearing: on a narrowed range a fully-loaded person can show `Holding 0` and rank first in the queue.
>
> Also fold in before Task 1: **spec §12c.F** — `fetchEnrollmentOverview` has no `count`, no `.range()` and no completeness assertion, so it can silently truncate today, and §6's invariant cannot detect it because all four counts truncate together.

## Global Constraints

- **ACA only.** Nothing in this plan may branch on `program === "medicare"` or be written to be "shared later". Medicare gets its own design pass.
- **Read-only.** This plan adds no write path. Assignment from the dashboard (spec §7.6) is a later plan.
- **Terminal-equivalent set is exactly `Can't Contact` and `Can not get ID card`** — NOT `Need call to renewal`, which stays a running stage. See spec F15: the existing `stageIsBlocking` list contains all three and must not be copied wholesale.
- **Never set `is_terminal = true`** on those option rows. It drives record-closing behaviour elsewhere.
- **Medians, never means**, for every duration statistic.
- **Suppress statistics below n = 10.** Reuse `MIN_DURATION_SAMPLE` from `src/lib/enrollment/stage-time.ts:19`; do not redeclare the number.
- **Date range filters on `enrollment_records.created_at`.** Every metric is computed over that cohort.
- **"Silent" excludes `comment_added` activity.** Never compute silence from `last_activity_at`.
- **Stage ordering is by label collation**, via `compareEnrollmentOptionText` from `src/lib/enrollment/options.ts`. Never order stages by `position`.
- New SQL functions follow the grant pattern already used in `supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql:478-494`: `revoke all ... from public, anon, authenticated` then `grant execute ... to service_role`.
- **Every `AcaOverviewRecord` fixture in every test file must include `last_work_activity_at: null` and `responsible_assigned_at: null`** unless that test is specifically about those fields. The fixtures shown in Tasks 5-9 predate those columns; add the two lines when you copy them, or `tsc` will fail.
- Run `npx tsc --noEmit` before every commit. Run `npx vitest run <file>` for the task's own test file.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `supabase/rollouts/2026-08-13-aca-overview-schema.sql` | `treat_as_terminal` column + seed; `last_work_activity_at` and `responsible_assigned_at` columns + backfill + maintenance inside the atomic patch/create functions; queue-membership and overview-settings tables |
| `supabase/rollouts/2026-08-13-aca-overview-test.sql` | Disposable assertions for the rollout |
| `src/lib/enrollment/aca-overview-types.ts` | Every type the layer produces and consumes |
| `src/lib/enrollment/aca-overview-stages.ts` | Terminal-set resolution and stage ordering |
| `src/lib/enrollment/aca-overview-timing.ts` | Days-in-stage / days-silent / threshold predicates |
| `src/lib/enrollment/aca-overview-scorecards.ts` | The 15 scorecards |
| `src/lib/enrollment/aca-overview-stage-table.ts` | Stage table incl. the synthetic `0-Unassigned` row |
| `src/lib/enrollment/aca-overview-actions.ts` | Needs-action record list |
| `src/lib/enrollment/aca-overview-people.ts` | People table + Person×Stage matrix |
| `src/lib/enrollment/aca-overview-queue.ts` | Assignment queue ranking |
| `src/lib/enrollment/aca-overview.ts` | Composition into one snapshot |
| `src/lib/enrollment/aca-overview-data.ts` | All fetching for the above |
| `src/app/api/enrollment/aca-overview/route.ts` | HTTP entry point |

Each gets a colocated `*.test.ts` except the data and route files, which are exercised through the existing integration conventions.

**Modified:**

| File | Change |
|---|---|
| `src/lib/enrollment/types.ts` | Add `treat_as_terminal` to `EnrollmentOption` |
| `src/app/api/enrollment/option-sets/[id]/route.ts` | Accept the new flag on update |

**Not touched:** `src/lib/enrollment/overview.ts`, `overview-data.ts`, `overview-types.ts`, and the existing `/api/enrollment/overview` route all keep working. The old Overview stays live until the new UI replaces it, so nothing regresses mid-migration.

---

## Task 1: Config flag — `treat_as_terminal` on stage options

**Files:**
- Create: `supabase/rollouts/2026-08-13-aca-overview-schema.sql`
- Create: `supabase/rollouts/2026-08-13-aca-overview-test.sql`
- Modify: `src/lib/enrollment/types.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `EnrollmentOption.treat_as_terminal: boolean` — every later task reads this instead of matching labels.

- [ ] **Step 1: Write the rollout SQL**

Create `supabase/rollouts/2026-08-13-aca-overview-schema.sql`:

```sql
-- ACA overview: dashboard-only terminal marking for stage options.
-- Deliberately NOT is_terminal: that flag drives record closing elsewhere.
alter table enrollment_options
  add column if not exists treat_as_terminal boolean not null default false;

-- Seed exactly the two stages the owner classified as terminal for dashboard
-- purposes. `Need call to renewal` is intentionally excluded: it stays a
-- running stage and remains eligible for stuck/silent accounting.
update enrollment_options o
set treat_as_terminal = true
from enrollment_option_sets s
where o.set_id = s.id
  and s.key = 'stage'
  and s.program = 'aca'
  and lower(btrim(o.label)) in ('can''t contact', 'can not get id card')
  and o.treat_as_terminal = false;
```

- [ ] **Step 2: Write the disposable assertion file**

Create `supabase/rollouts/2026-08-13-aca-overview-test.sql`:

```sql
-- Disposable assertions for 2026-08-13-aca-overview-schema.sql.
do $$
declare
  flagged_count integer;
  renewal_flagged boolean;
begin
  select count(*) into flagged_count
  from enrollment_options o
  join enrollment_option_sets s on s.id = o.set_id
  where s.key = 'stage' and s.program = 'aca' and o.treat_as_terminal;

  if flagged_count <> 2 then
    raise exception 'expected exactly 2 dashboard-terminal ACA stages, found %', flagged_count;
  end if;

  select coalesce(bool_or(o.treat_as_terminal), false) into renewal_flagged
  from enrollment_options o
  join enrollment_option_sets s on s.id = o.set_id
  where s.key = 'stage' and s.program = 'aca'
    and lower(btrim(o.label)) = 'need call to renewal';

  if renewal_flagged then
    raise exception 'Need call to renewal must NOT be dashboard-terminal';
  end if;
end $$;
```

- [ ] **Step 3: Run the rollout and the assertions**

Run both files against the database. Expected: no output from the assertion block. If it raises, the seed matched the wrong labels — check for trailing spaces or a renamed stage before editing the `in (...)` list.

- [ ] **Step 4: Add the field to the TypeScript type**

In `src/lib/enrollment/types.ts`, add to the `EnrollmentOption` type:

```ts
  treat_as_terminal: boolean;
```

- [ ] **Step 5: Verify types still compile**

Run: `npx tsc --noEmit`
Expected: PASS. If option objects are constructed literally anywhere in tests, add `treat_as_terminal: false` to those fixtures.

- [ ] **Step 6: Commit**

```bash
git add supabase/rollouts/2026-08-13-aca-overview-schema.sql supabase/rollouts/2026-08-13-aca-overview-test.sql src/lib/enrollment/types.ts
git commit -m "feat(enrollment): add dashboard-only treat_as_terminal flag to stage options"
```

---

## Task 2: Types module

**Files:**
- Create: `src/lib/enrollment/aca-overview-types.ts`

**Interfaces:**
- Consumes: `EnrollmentOption` from `./types`
- Produces: every type below. Later tasks import from this file and add nothing to it except their own output type.

- [ ] **Step 1: Write the types file**

```ts
import type { EnrollmentOption } from "./types";

/** Staleness thresholds the dashboard offers. Spec §4.2. */
export const ACA_OVERVIEW_THRESHOLD_DAYS = [1, 3, 7, 10] as const;
export type AcaOverviewThresholdDays = (typeof ACA_OVERVIEW_THRESHOLD_DAYS)[number];
export const ACA_OVERVIEW_DEFAULT_THRESHOLD_DAYS: AcaOverviewThresholdDays = 3;

/** One enrollment record, reduced to the fields this dashboard reads. */
export type AcaOverviewRecord = {
  id: string;
  display_number: string | null;
  client_name: string | null;
  stage_id: string | null;
  agent_email: string | null;
  caller_email: string | null;
  responsible_enroll_email: string | null;
  created_at: string;
  closed_at: string | null;
  archived_at: string | null;
  stage_entered_at: string | null;
  stage_entered_source: "live" | "history_backfill" | "record_created" | null;
  /**
   * Latest real work on the record: not a comment, not an attachment, not the
   * cron. Maintained on write (Task 10) rather than derived from
   * enrollment_activity on read, which measured at ~55 sequential requests and
   * ~50k rows per page load.
   */
  last_work_activity_at: string | null;
  /**
   * When responsible_enroll_email last actually changed. Written on assignment,
   * including assignment at creation. Deriving this from `people_changed`
   * activity is both slow and wrong: a caller-only edit emits that event
   * carrying the unchanged responsible person.
   */
  responsible_assigned_at: string | null;
};

export type AcaOverviewPerson = {
  email: string;
  name: string | null;
  canWork: boolean;
  queueEnabled: boolean;
};

export type AcaOverviewInput = {
  records: readonly AcaOverviewRecord[];
  stages: readonly EnrollmentOption[];
  people: readonly AcaOverviewPerson[];
  /** Median seconds a completed cycle spent on each stage. stage_id -> seconds. */
  stageDwellMedianSeconds: ReadonlyMap<string, number | null>;
  thresholdDays: AcaOverviewThresholdDays;
  now: Date;
};

export type AcaOverviewScorecards = {
  totalTasks: number;
  done: number;
  open: number;
  terminated: number;
  unassigned: number;
  noActivity: number;
  stuckInStage: number;
  cantContact: number;
  cannotGetIdCard: number;
  medianOpenAgeDays: number | null;
  medianTimeToDoneDays: number | null;
  slowestStage: { stageId: string; stageLabel: string; medianDays: number } | null;
  medianTimeInCurrentStageDays: number | null;
  activePeople: number;
  avgTasksPerPerson: number | null;
};

export type AcaOverviewStageRow = {
  stageId: string | null; // null === the synthetic 0-Unassigned row
  stageLabel: string;
  stageColor: string | null;
  isTerminal: boolean;
  inStage: number;
  sharePercent: number | null;
  medianWaitDays: number | null;
  longestWaitDays: number | null;
  stuckCount: number | null;
  silentCount: number | null;
};

export type AcaOverviewActionRow = {
  recordId: string;
  taskId: string | null;
  clientName: string | null;
  agentEmail: string | null;
  responsibleEmail: string | null;
  callerEmail: string | null;
  stageLabel: string | null;
  daysInStage: number | null;
  daysSilent: number | null;
  sortDays: number;
  /**
   * True when the stage clock came from the 2026-08-09 backfill rather than
   * from a measured transition. The owner chose to count these rather than hide
   * them, so the UI must render them in a muted style with an "estimated"
   * tooltip. An estimate and a measurement must never look identical.
   */
  stageAgeEstimated: boolean;
};

export type AcaOverviewPeopleRow = {
  email: string | null; // null === the Unassigned summary row
  name: string | null;
  holding: number;
  stuck: number;
  silent: number;
  medianWaitDays: number | null;
  longestWaitDays: number | null;
  doneInPeriod: number;
};

export type AcaOverviewMatrixCell = {
  tasks: number;
  stuck: number;
  silent: number;
  medianStuckDays: number | null;
};

export type AcaOverviewMatrix = {
  stageIds: string[];
  stageLabels: string[];
  rows: { email: string | null; name: string | null; cells: AcaOverviewMatrixCell[] }[];
  totals: AcaOverviewMatrixCell[];
};

export type AcaOverviewQueueCard = {
  email: string;
  name: string | null;
  lastAssignedAt: string | null;
  holding: number;
  stuck: number;
};

export type AcaOverviewSnapshot = {
  generatedAt: string;
  period: { from: string; to: string };
  thresholdDays: AcaOverviewThresholdDays;
  scorecards: AcaOverviewScorecards;
  stageTable: AcaOverviewStageRow[];
  actions: AcaOverviewActionRow[];
  people: AcaOverviewPeopleRow[];
  matrix: AcaOverviewMatrix;
  queue: AcaOverviewQueueCard[];
  unassigned: AcaOverviewActionRow[];
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/enrollment/aca-overview-types.ts
git commit -m "feat(enrollment): add ACA overview types"
```

---

## Task 3: Stage classification and ordering

**Files:**
- Create: `src/lib/enrollment/aca-overview-stages.ts`
- Test: `src/lib/enrollment/aca-overview-stages.test.ts`

**Interfaces:**
- Consumes: `EnrollmentOption`, `compareEnrollmentOptionText` from `./options`
- Produces: `isDashboardTerminal(stage)`, `orderStages(stages)`, `runningStages(stages)`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { isDashboardTerminal, orderStages, runningStages } from "./aca-overview-stages";
import type { EnrollmentOption } from "./types";

function stage(label: string, overrides: Partial<EnrollmentOption> = {}): EnrollmentOption {
  return {
    id: label,
    set_id: "stage-set",
    label,
    color: null,
    position: 0,
    is_terminal: false,
    triggers_qc: false,
    treat_as_terminal: false,
    ...overrides,
  } as EnrollmentOption;
}

describe("isDashboardTerminal", () => {
  it("is true for database-terminal stages", () => {
    expect(isDashboardTerminal(stage("10-DONE", { is_terminal: true }))).toBe(true);
  });

  it("is true for config-flagged stages", () => {
    expect(isDashboardTerminal(stage("Can't Contact", { treat_as_terminal: true }))).toBe(true);
  });

  it("is false for a running stage even if it looks like a dead end", () => {
    expect(isDashboardTerminal(stage("Need call to renewal"))).toBe(false);
  });
});

describe("orderStages", () => {
  it("orders by numeric-aware label collation, not by position", () => {
    const input = [
      stage("10-DONE", { position: 10 }),
      stage("2-Quoted", { position: 999 }),
      stage("1-Need quote", { position: 500 }),
      stage("Can't Contact", { position: 1 }),
    ];
    expect(orderStages(input).map((option) => option.label)).toEqual([
      "1-Need quote",
      "2-Quoted",
      "10-DONE",
      "Can't Contact",
    ]);
  });
});

describe("runningStages", () => {
  it("drops every dashboard-terminal stage", () => {
    const input = [
      stage("1-Need quote"),
      stage("10-DONE", { is_terminal: true }),
      stage("Can't Contact", { treat_as_terminal: true }),
      stage("Need call to renewal"),
    ];
    expect(runningStages(input).map((option) => option.label)).toEqual([
      "1-Need quote",
      "Need call to renewal",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/enrollment/aca-overview-stages.test.ts`
Expected: FAIL — cannot resolve `./aca-overview-stages`.

- [ ] **Step 3: Write the implementation**

```ts
import { compareEnrollmentOptionText } from "./options";
import type { EnrollmentOption } from "./types";

/**
 * Terminal FOR DASHBOARD PURPOSES. This is deliberately broader than the
 * database's is_terminal: the owner classified `Can't Contact` and
 * `Can not get ID card` as dead ends even though records there are still
 * open. That extra membership lives in Config as `treat_as_terminal`, never
 * by flipping is_terminal — that column drives record closing elsewhere.
 */
export function isDashboardTerminal(stage: EnrollmentOption): boolean {
  return Boolean(stage.is_terminal) || Boolean(stage.treat_as_terminal);
}

/**
 * Stage order comes from the label, not from `position`: position is assigned
 * as last+10 on insert and there is no reorder UI, so it does not describe the
 * workflow. The numeric prefixes on the labels do.
 */
export function orderStages(stages: readonly EnrollmentOption[]): EnrollmentOption[] {
  return [...stages].sort((first, second) =>
    compareEnrollmentOptionText(first.label, second.label)
  );
}

export function runningStages(stages: readonly EnrollmentOption[]): EnrollmentOption[] {
  return orderStages(stages).filter((stage) => !isDashboardTerminal(stage));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/enrollment/aca-overview-stages.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrollment/aca-overview-stages.ts src/lib/enrollment/aca-overview-stages.test.ts
git commit -m "feat(enrollment): add ACA overview stage classification"
```

---

## Task 4: Timing primitives

**Files:**
- Create: `src/lib/enrollment/aca-overview-timing.ts`
- Test: `src/lib/enrollment/aca-overview-timing.test.ts`

**Interfaces:**
- Consumes: `AcaOverviewRecord` from `./aca-overview-types`
- Produces: `daysInStage(record, now)`, `isEstimatedStageAge(record)`, `daysSilent(record, now)`, `isStuck(...)`, `isSilent(...)`, `medianDays(values)`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  daysInStage,
  daysSilent,
  isEstimatedStageAge,
  isSilent,
  isStuck,
  medianDays,
} from "./aca-overview-timing";
import type { AcaOverviewRecord } from "./aca-overview-types";

const NOW = new Date("2026-08-13T00:00:00.000Z");

function record(overrides: Partial<AcaOverviewRecord> = {}): AcaOverviewRecord {
  return {
    id: "r1",
    display_number: "ENR-1",
    client_name: "Client",
    stage_id: "s1",
    agent_email: null,
    caller_email: null,
    responsible_enroll_email: "a@x.com",
    created_at: "2026-07-01T00:00:00.000Z",
    closed_at: null,
    archived_at: null,
    stage_entered_at: "2026-08-03T00:00:00.000Z",
    stage_entered_source: "live",
    last_work_activity_at: null,
    responsible_assigned_at: null,
    ...overrides,
  };
}

describe("daysInStage", () => {
  it("counts whole days since the stage was entered", () => {
    expect(daysInStage(record(), NOW)).toBe(10);
  });

  it("is null only when there is no stage entry at all", () => {
    expect(
      daysInStage(record({ stage_entered_at: null, stage_entered_source: null }), NOW)
    ).toBeNull();
  });

  it("still counts backfilled entries, which the owner chose to include", () => {
    expect(daysInStage(record({ stage_entered_source: "history_backfill" }), NOW)).toBe(10);
  });
});

describe("isEstimatedStageAge", () => {
  it("is false for a measured transition", () => {
    expect(isEstimatedStageAge(record())).toBe(false);
  });

  it("is true for a backfilled or creation-derived entry", () => {
    expect(isEstimatedStageAge(record({ stage_entered_source: "history_backfill" }))).toBe(true);
    expect(isEstimatedStageAge(record({ stage_entered_source: "record_created" }))).toBe(true);
  });

  it("is true when there is no stage entry to judge", () => {
    expect(
      isEstimatedStageAge(record({ stage_entered_at: null, stage_entered_source: null }))
    ).toBe(true);
  });
});

describe("daysSilent", () => {
  it("uses the maintained work-activity column", () => {
    expect(daysSilent(record({ last_work_activity_at: "2026-08-11T00:00:00.000Z" }), NOW)).toBe(2);
  });

  it("falls back to the stage entry when the column is empty", () => {
    expect(daysSilent(record(), NOW)).toBe(10);
  });

  it("falls back to creation when there is neither", () => {
    expect(
      daysSilent(record({ stage_entered_at: null, stage_entered_source: null }), NOW)
    ).toBe(43);
  });
});

describe("isStuck / isSilent", () => {
  it("compares against the threshold inclusively", () => {
    expect(isStuck(10, 10)).toBe(true);
    expect(isStuck(9, 10)).toBe(false);
    expect(isStuck(null, 3)).toBe(false);
    expect(isSilent(3, 3)).toBe(true);
  });
});

describe("medianDays", () => {
  it("returns the middle value for odd counts", () => {
    expect(medianDays([1, 9, 5])).toBe(5);
  });

  it("averages the two middle values for even counts", () => {
    expect(medianDays([1, 2, 4, 10])).toBe(3);
  });

  it("is null for an empty set", () => {
    expect(medianDays([])).toBeNull();
  });

  it("ignores nulls rather than treating them as zero", () => {
    expect(medianDays([null, 4, null, 6])).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/enrollment/aca-overview-timing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import type { AcaOverviewRecord } from "./aca-overview-types";

const MS_PER_DAY = 86_400_000;

function wholeDaysBetween(startIso: string, now: Date): number | null {
  const start = new Date(startIso).getTime();
  if (!Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((now.getTime() - start) / MS_PER_DAY));
}

/**
 * Days the record has been sitting on its current stage.
 *
 * Counts backfilled entries as well as measured ones. That is a deliberate
 * owner decision: excluding them would make `Stuck >= N days` silently omit the
 * oldest records in the system, which inverts the purpose of the dashboard.
 * The honesty cost is paid by `isEstimatedStageAge`, which the UI must use to
 * style estimates differently from measurements.
 */
export function daysInStage(record: AcaOverviewRecord, now: Date): number | null {
  if (!record.stage_entered_at) return null;
  return wholeDaysBetween(record.stage_entered_at, now);
}

/**
 * True when the stage clock was reconstructed by the 2026-08-09 backfill rather
 * than measured from a real transition. Records with no stage entry at all
 * count as estimated: there is nothing to vouch for.
 */
export function isEstimatedStageAge(record: AcaOverviewRecord): boolean {
  return record.stage_entered_source !== "live";
}

/**
 * Days since real work happened. Reads the maintained column, which is bumped
 * only for genuine work: comments, attachments and `system`-actor cron rows are
 * excluded at write time (Task 10). Deriving this at read time from
 * `enrollment_activity` was measured at ~55 sequential requests and ~50k rows
 * per page load, against a table indexed only on `(record_id, created_at)`.
 *
 * Falls back to the stage entry, then to creation, so a record with no
 * maintained value yet — every record until the backfill in Task 10 runs —
 * still reports an honest age rather than null.
 */
export function daysSilent(record: AcaOverviewRecord, now: Date): number | null {
  if (record.last_work_activity_at) {
    return wholeDaysBetween(record.last_work_activity_at, now);
  }
  const stageDays = daysInStage(record, now);
  if (stageDays !== null) return stageDays;
  return wholeDaysBetween(record.created_at, now);
}

export function isStuck(days: number | null, thresholdDays: number): boolean {
  return days !== null && days >= thresholdDays;
}

export function isSilent(days: number | null, thresholdDays: number): boolean {
  return days !== null && days >= thresholdDays;
}

/**
 * Median, not mean: a handful of records parked for 60 days would drag a mean
 * into a figure that describes none of the population.
 */
export function medianDays(values: readonly (number | null)[]): number | null {
  const sorted = values
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .sort((first, second) => first - second);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/enrollment/aca-overview-timing.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrollment/aca-overview-timing.ts src/lib/enrollment/aca-overview-timing.test.ts
git commit -m "feat(enrollment): add ACA overview timing primitives"
```

---

## Task 5: Scorecards

**Files:**
- Create: `src/lib/enrollment/aca-overview-scorecards.ts`
- Test: `src/lib/enrollment/aca-overview-scorecards.test.ts`

**Interfaces:**
- Consumes: `AcaOverviewInput`, `AcaOverviewScorecards`; `isDashboardTerminal` from `./aca-overview-stages`; `daysInStage`, `daysSilent`, `isStuck`, `isSilent`, `medianDays` from `./aca-overview-timing`
- Produces: `buildScorecards(input): AcaOverviewScorecards`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildScorecards } from "./aca-overview-scorecards";
import type { AcaOverviewInput, AcaOverviewRecord } from "./aca-overview-types";
import type { EnrollmentOption } from "./types";

const NOW = new Date("2026-08-13T00:00:00.000Z");

function stage(id: string, label: string, extra: Partial<EnrollmentOption> = {}) {
  return {
    id,
    set_id: "stage-set",
    label,
    color: null,
    position: 0,
    is_terminal: false,
    triggers_qc: false,
    treat_as_terminal: false,
    ...extra,
  } as EnrollmentOption;
}

const STAGES = [
  stage("s1", "1-Need quote"),
  stage("done", "10-DONE", { is_terminal: true }),
  stage("term", "11-Terminated", { is_terminal: true }),
  stage("cc", "Can't Contact", { treat_as_terminal: true }),
  stage("noid", "Can not get ID card", { treat_as_terminal: true }),
];

function record(id: string, overrides: Partial<AcaOverviewRecord> = {}): AcaOverviewRecord {
  return {
    id,
    display_number: `ENR-${id}`,
    client_name: id,
    stage_id: "s1",
    agent_email: null,
    caller_email: null,
    responsible_enroll_email: "a@x.com",
    created_at: "2026-08-01T00:00:00.000Z",
    closed_at: null,
    archived_at: null,
    stage_entered_at: "2026-08-03T00:00:00.000Z",
    stage_entered_source: "live",
    last_work_activity_at: null,
    responsible_assigned_at: null,
    ...overrides,
  };
}

function input(records: AcaOverviewRecord[]): AcaOverviewInput {
  return {
    records,
    stages: STAGES,
    people: [],
    stageDwellMedianSeconds: new Map(),
    thresholdDays: 3,
    now: NOW,
  };
}

describe("buildScorecards", () => {
  it("keeps done + open + terminated equal to total", () => {
    const result = buildScorecards(
      input([
        record("a"),
        record("b", { stage_id: "done", closed_at: "2026-08-10T00:00:00.000Z" }),
        record("c", { stage_id: "term", closed_at: "2026-08-11T00:00:00.000Z" }),
      ])
    );
    expect(result.totalTasks).toBe(3);
    expect(result.done + result.open + result.terminated).toBe(result.totalTasks);
  });

  it("counts a record on a terminal stage that was never closed as done, not open", () => {
    const result = buildScorecards(input([record("a", { stage_id: "done" })]));
    expect(result.done).toBe(1);
    expect(result.open).toBe(0);
  });

  it("excludes dashboard-terminal stages from stuck and silent counts", () => {
    const result = buildScorecards(
      input([
        record("a", { stage_id: "cc", stage_entered_at: "2026-06-01T00:00:00.000Z" }),
        record("b", { stage_entered_at: "2026-06-01T00:00:00.000Z" }),
      ])
    );
    expect(result.stuckInStage).toBe(1);
    expect(result.cantContact).toBe(1);
  });

  it("reports unassigned and the per-person average over open records only", () => {
    const result = buildScorecards(
      input([
        record("a", { responsible_enroll_email: null }),
        record("b", { responsible_enroll_email: "p1@x.com" }),
        record("c", { responsible_enroll_email: "p2@x.com" }),
      ])
    );
    expect(result.unassigned).toBe(1);
    expect(result.activePeople).toBe(2);
    expect(result.avgTasksPerPerson).toBe(1.5);
  });

  it("returns null rather than zero when there is nothing to average", () => {
    const result = buildScorecards(input([]));
    expect(result.avgTasksPerPerson).toBeNull();
    expect(result.medianOpenAgeDays).toBeNull();
    expect(result.slowestStage).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/enrollment/aca-overview-scorecards.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { isDashboardTerminal } from "./aca-overview-stages";
import { daysInStage, daysSilent, isSilent, isStuck, medianDays } from "./aca-overview-timing";
import { MIN_DURATION_SAMPLE } from "./stage-time";
import type {
  AcaOverviewInput,
  AcaOverviewRecord,
  AcaOverviewScorecards,
} from "./aca-overview-types";
import type { EnrollmentOption } from "./types";

const SECONDS_PER_DAY = 86_400;

function labelMatches(stage: EnrollmentOption | undefined, label: string): boolean {
  return (stage?.label ?? "").trim().toLowerCase() === label;
}

export function buildScorecards(input: AcaOverviewInput): AcaOverviewScorecards {
  const stagesById = new Map(input.stages.map((stage) => [stage.id, stage]));
  const active = input.records.filter((record) => !record.archived_at);

  const stageOf = (record: AcaOverviewRecord) =>
    record.stage_id ? stagesById.get(record.stage_id) : undefined;

  // "Done" and "Terminated" are stage membership, not closed_at, so the three
  // buckets partition the cohort exactly. A record parked on a terminal stage
  // without closed_at set still belongs to its stage, not to Open.
  const done = active.filter((record) => labelMatches(stageOf(record), "10-done"));
  const terminated = active.filter((record) => labelMatches(stageOf(record), "11-terminated"));
  const doneOrTerminated = new Set([...done, ...terminated].map((record) => record.id));
  const open = active.filter((record) => !doneOrTerminated.has(record.id));

  const countable = open.filter((record) => {
    const stage = stageOf(record);
    return stage ? !isDashboardTerminal(stage) : true;
  });

  const stuckInStage = countable.filter((record) =>
    isStuck(daysInStage(record, input.now), input.thresholdDays)
  ).length;

  const noActivity = countable.filter((record) =>
    isSilent(daysSilent(record, input.now), input.thresholdDays)
  ).length;

  const holders = new Set(
    open
      .map((record) => record.responsible_enroll_email)
      .filter((email): email is string => Boolean(email))
  );

  const openAges = open.map((record) => {
    const created = new Date(record.created_at).getTime();
    return Number.isFinite(created)
      ? Math.max(0, Math.floor((input.now.getTime() - created) / 86_400_000))
      : null;
  });

  const timeToDone = done.map((record) => {
    if (!record.closed_at) return null;
    const created = new Date(record.created_at).getTime();
    const closed = new Date(record.closed_at).getTime();
    if (!Number.isFinite(created) || !Number.isFinite(closed)) return null;
    return Math.max(0, Math.floor((closed - created) / 86_400_000));
  });

  let slowestStage: AcaOverviewScorecards["slowestStage"] = null;
  for (const [stageId, seconds] of input.stageDwellMedianSeconds) {
    if (seconds === null) continue;
    const days = seconds / SECONDS_PER_DAY;
    if (!slowestStage || days > slowestStage.medianDays) {
      slowestStage = {
        stageId,
        stageLabel: stagesById.get(stageId)?.label ?? "Archived stage",
        medianDays: Math.round(days * 10) / 10,
      };
    }
  }

  return {
    totalTasks: active.length,
    done: done.length,
    open: open.length,
    terminated: terminated.length,
    unassigned: open.filter((record) => !record.responsible_enroll_email).length,
    noActivity,
    stuckInStage,
    cantContact: open.filter((record) => labelMatches(stageOf(record), "can't contact")).length,
    cannotGetIdCard: open.filter((record) =>
      labelMatches(stageOf(record), "can not get id card")
    ).length,
    medianOpenAgeDays: medianDays(openAges),
    medianTimeToDoneDays:
      timeToDone.filter((value) => value !== null).length >= MIN_DURATION_SAMPLE
        ? medianDays(timeToDone)
        : null,
    slowestStage,
    medianTimeInCurrentStageDays: medianDays(
      countable.map((record) => daysInStage(record, input.now))
    ),
    activePeople: holders.size,
    avgTasksPerPerson: holders.size === 0 ? null : open.length / holders.size,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/enrollment/aca-overview-scorecards.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrollment/aca-overview-scorecards.ts src/lib/enrollment/aca-overview-scorecards.test.ts
git commit -m "feat(enrollment): add ACA overview scorecards"
```

---

## Task 6: Stage table

**Files:**
- Create: `src/lib/enrollment/aca-overview-stage-table.ts`
- Test: `src/lib/enrollment/aca-overview-stage-table.test.ts`

**Interfaces:**
- Consumes: `AcaOverviewInput`, `AcaOverviewStageRow`; `isDashboardTerminal`, `orderStages`; the timing primitives
- Produces: `buildStageTable(input): AcaOverviewStageRow[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildStageTable } from "./aca-overview-stage-table";
import type { AcaOverviewInput, AcaOverviewRecord } from "./aca-overview-types";
import type { EnrollmentOption } from "./types";

const NOW = new Date("2026-08-13T00:00:00.000Z");

function stage(id: string, label: string, extra: Partial<EnrollmentOption> = {}) {
  return {
    id,
    set_id: "stage-set",
    label,
    color: null,
    position: 0,
    is_terminal: false,
    triggers_qc: false,
    treat_as_terminal: false,
    ...extra,
  } as EnrollmentOption;
}

function record(id: string, overrides: Partial<AcaOverviewRecord> = {}): AcaOverviewRecord {
  return {
    id,
    display_number: `ENR-${id}`,
    client_name: id,
    stage_id: "s1",
    agent_email: null,
    caller_email: null,
    responsible_enroll_email: "a@x.com",
    created_at: "2026-08-01T00:00:00.000Z",
    closed_at: null,
    archived_at: null,
    stage_entered_at: "2026-08-03T00:00:00.000Z",
    stage_entered_source: "live",
    last_work_activity_at: null,
    responsible_assigned_at: null,
    ...overrides,
  };
}

function input(records: AcaOverviewRecord[], stages: EnrollmentOption[]): AcaOverviewInput {
  return {
    records,
    stages,
    people: [],
    stageDwellMedianSeconds: new Map(),
    thresholdDays: 3,
    now: NOW,
  };
}

describe("buildStageTable", () => {
  const stages = [
    stage("s1", "1-Need quote"),
    stage("s2", "2-Quoted"),
    stage("done", "10-DONE", { is_terminal: true }),
  ];

  it("puts the synthetic unassigned row first and pulls those records out of their stage row", () => {
    const rows = buildStageTable(
      input(
        [
          record("a", { responsible_enroll_email: null }),
          record("b"),
          record("c", { stage_id: "s2" }),
        ],
        stages
      )
    );
    expect(rows[0].stageId).toBeNull();
    expect(rows[0].stageLabel).toBe("0-Unassigned");
    expect(rows[0].inStage).toBe(1);
    expect(rows.find((row) => row.stageLabel === "1-Need quote")?.inStage).toBe(1);
  });

  it("blanks the four waiting columns on terminal stages", () => {
    const rows = buildStageTable(
      input([record("a", { stage_id: "done" })], stages)
    );
    const doneRow = rows.find((row) => row.stageLabel === "10-DONE");
    expect(doneRow?.inStage).toBe(1);
    expect(doneRow?.medianWaitDays).toBeNull();
    expect(doneRow?.longestWaitDays).toBeNull();
    expect(doneRow?.stuckCount).toBeNull();
    expect(doneRow?.silentCount).toBeNull();
    expect(doneRow?.sharePercent).toBeNull();
  });

  it("computes share against open records so the running rows sum to 100", () => {
    const rows = buildStageTable(
      input([record("a"), record("b"), record("c", { stage_id: "s2" }), record("d", { stage_id: "done" })], stages)
    );
    const running = rows.filter((row) => !row.isTerminal);
    const total = running.reduce((sum, row) => sum + (row.sharePercent ?? 0), 0);
    expect(Math.round(total)).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/enrollment/aca-overview-stage-table.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { isDashboardTerminal, orderStages } from "./aca-overview-stages";
import { daysInStage, daysSilent, isSilent, isStuck, medianDays } from "./aca-overview-timing";
import type {
  AcaOverviewInput,
  AcaOverviewRecord,
  AcaOverviewStageRow,
} from "./aca-overview-types";

export const UNASSIGNED_STAGE_LABEL = "0-Unassigned";

function waitColumns(
  records: readonly AcaOverviewRecord[],
  input: AcaOverviewInput
): Pick<AcaOverviewStageRow, "medianWaitDays" | "longestWaitDays" | "stuckCount" | "silentCount"> {
  const stageDays = records.map((record) => daysInStage(record, input.now));
  return {
    medianWaitDays: medianDays(stageDays),
    longestWaitDays: stageDays.reduce<number | null>(
      (longest, value) => (value === null ? longest : Math.max(longest ?? 0, value)),
      null
    ),
    stuckCount: stageDays.filter((value) => isStuck(value, input.thresholdDays)).length,
    silentCount: records.filter((record) =>
      isSilent(daysSilent(record, input.now), input.thresholdDays)
    ).length,
  };
}

export function buildStageTable(input: AcaOverviewInput): AcaOverviewStageRow[] {
  const stagesById = new Map(input.stages.map((stage) => [stage.id, stage]));
  const active = input.records.filter((record) => !record.archived_at);

  const isOpen = (record: AcaOverviewRecord) => {
    const stage = record.stage_id ? stagesById.get(record.stage_id) : undefined;
    return !stage?.is_terminal;
  };
  const openRecords = active.filter(isOpen);
  const openTotal = openRecords.length;

  // Unassigned records are LIFTED OUT of their stage row, not double counted.
  // Every stage row below therefore describes assigned work only, which is what
  // makes a separate "unassigned" column redundant.
  const unassigned = openRecords.filter((record) => !record.responsible_enroll_email);
  const assigned = openRecords.filter((record) => Boolean(record.responsible_enroll_email));

  const rows: AcaOverviewStageRow[] = [
    {
      stageId: null,
      stageLabel: UNASSIGNED_STAGE_LABEL,
      stageColor: null,
      isTerminal: false,
      inStage: unassigned.length,
      sharePercent: openTotal === 0 ? null : (unassigned.length / openTotal) * 100,
      ...waitColumns(unassigned, input),
    },
  ];

  for (const stage of orderStages(input.stages)) {
    const terminal = isDashboardTerminal(stage);
    const pool = stage.is_terminal ? active : assigned;
    const inStage = pool.filter((record) => record.stage_id === stage.id);

    rows.push({
      stageId: stage.id,
      stageLabel: stage.label,
      stageColor: stage.color,
      isTerminal: terminal,
      inStage: inStage.length,
      // A record that has left the pipeline has no share of live work, and no
      // waiting statistics: nobody is waiting on it.
      sharePercent:
        terminal || openTotal === 0 ? null : (inStage.length / openTotal) * 100,
      ...(terminal
        ? { medianWaitDays: null, longestWaitDays: null, stuckCount: null, silentCount: null }
        : waitColumns(inStage, input)),
    });
  }

  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/enrollment/aca-overview-stage-table.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrollment/aca-overview-stage-table.ts src/lib/enrollment/aca-overview-stage-table.test.ts
git commit -m "feat(enrollment): add ACA overview stage table"
```

---

## Task 7: Needs-action list

**Files:**
- Create: `src/lib/enrollment/aca-overview-actions.ts`
- Test: `src/lib/enrollment/aca-overview-actions.test.ts`

**Interfaces:**
- Consumes: `AcaOverviewInput`, `AcaOverviewActionRow`; `isDashboardTerminal`; the timing primitives
- Produces: `buildActionRows(input): AcaOverviewActionRow[]`, `buildUnassignedRows(input): AcaOverviewActionRow[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildActionRows, buildUnassignedRows } from "./aca-overview-actions";
import type { AcaOverviewInput, AcaOverviewRecord } from "./aca-overview-types";
import type { EnrollmentOption } from "./types";

const NOW = new Date("2026-08-13T00:00:00.000Z");

function stage(id: string, label: string, extra: Partial<EnrollmentOption> = {}) {
  return {
    id,
    set_id: "stage-set",
    label,
    color: null,
    position: 0,
    is_terminal: false,
    triggers_qc: false,
    treat_as_terminal: false,
    ...extra,
  } as EnrollmentOption;
}

const STAGES = [
  stage("s1", "1-Need quote"),
  stage("cc", "Can't Contact", { treat_as_terminal: true }),
  stage("done", "10-DONE", { is_terminal: true }),
];

function record(id: string, overrides: Partial<AcaOverviewRecord> = {}): AcaOverviewRecord {
  return {
    id,
    display_number: `ENR-${id}`,
    client_name: id,
    stage_id: "s1",
    agent_email: "agent@x.com",
    caller_email: "caller@x.com",
    responsible_enroll_email: "a@x.com",
    created_at: "2026-08-01T00:00:00.000Z",
    closed_at: null,
    archived_at: null,
    stage_entered_at: "2026-08-03T00:00:00.000Z",
    stage_entered_source: "live",
    last_work_activity_at: null,
    responsible_assigned_at: null,
    ...overrides,
  };
}

function input(records: AcaOverviewRecord[]): AcaOverviewInput {
  return {
    records,
    stages: STAGES,
    people: [],
    stageDwellMedianSeconds: new Map(),
    thresholdDays: 3,
    now: NOW,
  };
}

describe("buildActionRows", () => {
  it("sorts by the larger of days-in-stage and days-silent, descending", () => {
    const rows = buildActionRows(
      input([
        record("young", { stage_entered_at: "2026-08-12T00:00:00.000Z" }),
        record("old", { stage_entered_at: "2026-07-10T00:00:00.000Z" }),
      ])
    );
    expect(rows.map((row) => row.recordId)).toEqual(["old", "young"]);
    expect(rows[0].sortDays).toBe(34);
  });

  it("excludes terminal and dashboard-terminal stages", () => {
    const rows = buildActionRows(
      input([record("a"), record("b", { stage_id: "cc" }), record("c", { stage_id: "done" })])
    );
    expect(rows.map((row) => row.recordId)).toEqual(["a"]);
  });

  it("keeps days-in-stage and days-silent separate so a blocked record is distinguishable", () => {
    const rows = buildActionRows(
      input([
        record("blocked", {
          stage_entered_at: "2026-07-18T00:00:00.000Z",
          last_work_activity_at: "2026-08-11T00:00:00.000Z",
        }),
      ])
    );
    expect(rows[0].daysInStage).toBe(26);
    expect(rows[0].daysSilent).toBe(2);
  });

  it("marks a backfilled stage clock as an estimate", () => {
    const rows = buildActionRows(
      input([record("old", { stage_entered_source: "history_backfill" })])
    );
    expect(rows[0].stageAgeEstimated).toBe(true);
  });
});

describe("buildUnassignedRows", () => {
  it("returns only records with no responsible person, oldest in stage first", () => {
    const rows = buildUnassignedRows(
      input([
        record("assigned"),
        record("u1", {
          responsible_enroll_email: null,
          stage_entered_at: "2026-08-11T00:00:00.000Z",
        }),
        record("u2", {
          responsible_enroll_email: null,
          stage_entered_at: "2026-08-01T00:00:00.000Z",
        }),
      ])
    );
    expect(rows.map((row) => row.recordId)).toEqual(["u2", "u1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/enrollment/aca-overview-actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { isDashboardTerminal } from "./aca-overview-stages";
import { daysInStage, daysSilent, isEstimatedStageAge } from "./aca-overview-timing";
import type {
  AcaOverviewActionRow,
  AcaOverviewInput,
  AcaOverviewRecord,
} from "./aca-overview-types";
import type { EnrollmentOption } from "./types";

function toRow(
  record: AcaOverviewRecord,
  stage: EnrollmentOption | undefined,
  input: AcaOverviewInput
): AcaOverviewActionRow {
  const inStage = daysInStage(record, input.now);
  const silent = daysSilent(record, input.now);
  return {
    recordId: record.id,
    taskId: record.display_number,
    clientName: record.client_name,
    agentEmail: record.agent_email,
    responsibleEmail: record.responsible_enroll_email,
    callerEmail: record.caller_email,
    stageLabel: stage?.label ?? null,
    daysInStage: inStage,
    daysSilent: silent,
    // Sorting on max() rather than on days-in-stage alone. The two usually
    // agree, but not always: un-archiving resets the stage clock without any
    // stage change, and re-selecting the same stage writes a work activity
    // without resetting it. max() surfaces the record under either skew instead
    // of hiding it behind a null.
    sortDays: Math.max(inStage ?? 0, silent ?? 0),
    stageAgeEstimated: isEstimatedStageAge(record),
  };
}

function runningRecords(input: AcaOverviewInput): {
  record: AcaOverviewRecord;
  stage: EnrollmentOption | undefined;
}[] {
  const stagesById = new Map(input.stages.map((stage) => [stage.id, stage]));
  return input.records
    .filter((record) => !record.archived_at && !record.closed_at)
    .map((record) => ({
      record,
      stage: record.stage_id ? stagesById.get(record.stage_id) : undefined,
    }))
    .filter(({ stage }) => !stage || !isDashboardTerminal(stage));
}

export function buildActionRows(input: AcaOverviewInput): AcaOverviewActionRow[] {
  return runningRecords(input)
    .map(({ record, stage }) => toRow(record, stage, input))
    .sort((first, second) => second.sortDays - first.sortDays);
}

export function buildUnassignedRows(input: AcaOverviewInput): AcaOverviewActionRow[] {
  return runningRecords(input)
    .filter(({ record }) => !record.responsible_enroll_email)
    .map(({ record, stage }) => toRow(record, stage, input))
    .sort((first, second) => (second.daysInStage ?? 0) - (first.daysInStage ?? 0));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/enrollment/aca-overview-actions.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrollment/aca-overview-actions.ts src/lib/enrollment/aca-overview-actions.test.ts
git commit -m "feat(enrollment): add ACA overview needs-action list"
```

---

## Task 8: People table and Person × Stage matrix

**Files:**
- Create: `src/lib/enrollment/aca-overview-people.ts`
- Test: `src/lib/enrollment/aca-overview-people.test.ts`

**Interfaces:**
- Consumes: `AcaOverviewInput`, `AcaOverviewPeopleRow`, `AcaOverviewMatrix`, `AcaOverviewMatrixCell`; `runningStages`, `isDashboardTerminal`; the timing primitives
- Produces: `buildPeopleRows(input): AcaOverviewPeopleRow[]`, `buildMatrix(input): AcaOverviewMatrix`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildMatrix, buildPeopleRows } from "./aca-overview-people";
import type { AcaOverviewInput, AcaOverviewRecord } from "./aca-overview-types";
import type { EnrollmentOption } from "./types";

const NOW = new Date("2026-08-13T00:00:00.000Z");

function stage(id: string, label: string, extra: Partial<EnrollmentOption> = {}) {
  return {
    id,
    set_id: "stage-set",
    label,
    color: null,
    position: 0,
    is_terminal: false,
    triggers_qc: false,
    treat_as_terminal: false,
    ...extra,
  } as EnrollmentOption;
}

const STAGES = [
  stage("s1", "1-Need quote"),
  stage("s2", "2-Quoted"),
  stage("cc", "Can't Contact", { treat_as_terminal: true }),
  stage("done", "10-DONE", { is_terminal: true }),
];

function record(id: string, overrides: Partial<AcaOverviewRecord> = {}): AcaOverviewRecord {
  return {
    id,
    display_number: `ENR-${id}`,
    client_name: id,
    stage_id: "s1",
    agent_email: null,
    caller_email: null,
    responsible_enroll_email: "p1@x.com",
    created_at: "2026-08-01T00:00:00.000Z",
    closed_at: null,
    archived_at: null,
    stage_entered_at: "2026-08-01T00:00:00.000Z",
    stage_entered_source: "live",
    last_work_activity_at: null,
    responsible_assigned_at: null,
    ...overrides,
  };
}

function input(records: AcaOverviewRecord[]): AcaOverviewInput {
  return {
    records,
    stages: STAGES,
    people: [
      { email: "p1@x.com", name: "P One", canWork: true, queueEnabled: true },
      { email: "p2@x.com", name: "P Two", canWork: true, queueEnabled: true },
    ],
    stageDwellMedianSeconds: new Map(),
    thresholdDays: 3,
    now: NOW,
  };
}

describe("buildPeopleRows", () => {
  it("always reports the holding denominator beside the error counts", () => {
    const rows = buildPeopleRows(input([record("a"), record("b")]));
    const p1 = rows.find((row) => row.email === "p1@x.com");
    expect(p1?.holding).toBe(2);
    expect(p1?.stuck).toBe(2);
  });

  it("adds a team total row and a separate unassigned row", () => {
    const rows = buildPeopleRows(
      input([record("a"), record("b", { responsible_enroll_email: null })])
    );
    expect(rows.at(-2)?.name).toBe("Team total");
    expect(rows.at(-1)?.email).toBeNull();
    expect(rows.at(-1)?.holding).toBe(1);
  });

  it("counts done separately from holding", () => {
    const rows = buildPeopleRows(
      input([record("a", { stage_id: "done", closed_at: "2026-08-10T00:00:00.000Z" })])
    );
    const p1 = rows.find((row) => row.email === "p1@x.com");
    expect(p1?.holding).toBe(0);
    expect(p1?.doneInPeriod).toBe(1);
  });
});

describe("buildMatrix", () => {
  it("covers running stages only", () => {
    const matrix = buildMatrix(input([record("a")]));
    expect(matrix.stageLabels).toEqual(["1-Need quote", "2-Quoted"]);
  });

  it("produces a totals row that sums the person rows", () => {
    const matrix = buildMatrix(
      input([record("a"), record("b", { responsible_enroll_email: "p2@x.com" })])
    );
    expect(matrix.totals[0].tasks).toBe(2);
    expect(matrix.totals[0].stuck).toBe(2);
  });

  it("suppresses the median stuck duration when nothing is stuck", () => {
    const matrix = buildMatrix(
      input([record("a", { stage_id: "s2", stage_entered_at: "2026-08-12T00:00:00.000Z" })])
    );
    const quotedIndex = matrix.stageLabels.indexOf("2-Quoted");
    expect(matrix.totals[quotedIndex].stuck).toBe(0);
    expect(matrix.totals[quotedIndex].medianStuckDays).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/enrollment/aca-overview-people.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { isDashboardTerminal, runningStages } from "./aca-overview-stages";
import { daysInStage, daysSilent, isSilent, isStuck, medianDays } from "./aca-overview-timing";
import type {
  AcaOverviewInput,
  AcaOverviewMatrix,
  AcaOverviewMatrixCell,
  AcaOverviewPeopleRow,
  AcaOverviewRecord,
} from "./aca-overview-types";

function openRunningRecords(input: AcaOverviewInput): AcaOverviewRecord[] {
  const stagesById = new Map(input.stages.map((stage) => [stage.id, stage]));
  return input.records.filter((record) => {
    if (record.archived_at || record.closed_at) return false;
    const stage = record.stage_id ? stagesById.get(record.stage_id) : undefined;
    return !stage || !isDashboardTerminal(stage);
  });
}

function statsFor(
  records: readonly AcaOverviewRecord[],
  input: AcaOverviewInput
): Omit<AcaOverviewPeopleRow, "email" | "name" | "doneInPeriod"> {
  const stageDays = records.map((record) => daysInStage(record, input.now));
  return {
    holding: records.length,
    stuck: stageDays.filter((value) => isStuck(value, input.thresholdDays)).length,
    silent: records.filter((record) =>
      isSilent(daysSilent(record, input.now), input.thresholdDays)
    ).length,
    medianWaitDays: medianDays(stageDays),
    longestWaitDays: stageDays.reduce<number | null>(
      (longest, value) => (value === null ? longest : Math.max(longest ?? 0, value)),
      null
    ),
  };
}

export function buildPeopleRows(input: AcaOverviewInput): AcaOverviewPeopleRow[] {
  const open = openRunningRecords(input);
  const stagesById = new Map(input.stages.map((stage) => [stage.id, stage]));
  const doneRecords = input.records.filter((record) => {
    const stage = record.stage_id ? stagesById.get(record.stage_id) : undefined;
    return !record.archived_at && (stage?.label ?? "").trim().toLowerCase() === "10-done";
  });

  const holders = new Set([
    ...input.people.filter((person) => person.canWork).map((person) => person.email),
    ...open
      .map((record) => record.responsible_enroll_email)
      .filter((email): email is string => Boolean(email)),
  ]);

  const rows: AcaOverviewPeopleRow[] = [...holders]
    .map((email) => {
      const person = input.people.find((candidate) => candidate.email === email);
      const mine = open.filter((record) => record.responsible_enroll_email === email);
      return {
        email,
        name: person?.name ?? null,
        ...statsFor(mine, input),
        doneInPeriod: doneRecords.filter(
          (record) => record.responsible_enroll_email === email
        ).length,
      };
    })
    .sort((first, second) => second.holding - first.holding);

  const assigned = open.filter((record) => Boolean(record.responsible_enroll_email));
  const unassigned = open.filter((record) => !record.responsible_enroll_email);

  rows.push({
    email: "__team__",
    name: "Team total",
    ...statsFor(assigned, input),
    doneInPeriod: doneRecords.filter((record) => Boolean(record.responsible_enroll_email)).length,
  });

  // Unassigned is not a person, so it never joins the ranking — but hiding it
  // would leave the person rows summing to less than the open total with no
  // visible explanation.
  rows.push({
    email: null,
    name: "Unassigned",
    ...statsFor(unassigned, input),
    doneInPeriod: 0,
  });

  return rows;
}

function cellFor(
  records: readonly AcaOverviewRecord[],
  input: AcaOverviewInput
): AcaOverviewMatrixCell {
  const stageDays = records.map((record) => daysInStage(record, input.now));
  const stuckDays = stageDays.filter(
    (value): value is number => value !== null && value >= input.thresholdDays
  );
  return {
    tasks: records.length,
    stuck: stuckDays.length,
    silent: records.filter((record) =>
      isSilent(daysSilent(record, input.now), input.thresholdDays)
    ).length,
    medianStuckDays: stuckDays.length === 0 ? null : medianDays(stuckDays),
  };
}

export function buildMatrix(input: AcaOverviewInput): AcaOverviewMatrix {
  const stages = runningStages(input.stages);
  const open = openRunningRecords(input);

  const emails = [
    ...new Set([
      ...input.people.filter((person) => person.canWork).map((person) => person.email),
      ...open
        .map((record) => record.responsible_enroll_email)
        .filter((email): email is string => Boolean(email)),
    ]),
  ];

  const rows = emails.map((email) => {
    const person = input.people.find((candidate) => candidate.email === email);
    const mine = open.filter((record) => record.responsible_enroll_email === email);
    return {
      email,
      name: person?.name ?? null,
      cells: stages.map((stage) =>
        cellFor(
          mine.filter((record) => record.stage_id === stage.id),
          input
        )
      ),
    };
  });

  return {
    stageIds: stages.map((stage) => stage.id),
    stageLabels: stages.map((stage) => stage.label),
    rows,
    // The totals row is what separates "this person is slow" from "this stage
    // is broken". It is not decoration; without it the person rows invite
    // unfair conclusions.
    totals: stages.map((stage) =>
      cellFor(
        open.filter(
          (record) => record.stage_id === stage.id && record.responsible_enroll_email
        ),
        input
      )
    ),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/enrollment/aca-overview-people.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrollment/aca-overview-people.ts src/lib/enrollment/aca-overview-people.test.ts
git commit -m "feat(enrollment): add ACA overview people table and matrix"
```

---

## Task 9: Assignment queue ranking

**Files:**
- Create: `src/lib/enrollment/aca-overview-queue.ts`
- Test: `src/lib/enrollment/aca-overview-queue.test.ts`

**Interfaces:**
- Consumes: `AcaOverviewInput`, `AcaOverviewQueueCard`; `daysInStage`, `isStuck`
- Produces: `buildQueue(input): AcaOverviewQueueCard[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildQueue } from "./aca-overview-queue";
import type { AcaOverviewInput, AcaOverviewRecord } from "./aca-overview-types";
import type { EnrollmentOption } from "./types";

const NOW = new Date("2026-08-13T00:00:00.000Z");

const STAGES = [
  {
    id: "s1",
    set_id: "stage-set",
    label: "1-Need quote",
    color: null,
    position: 0,
    is_terminal: false,
    triggers_qc: false,
    treat_as_terminal: false,
  } as EnrollmentOption,
];

function record(
  id: string,
  email: string | null,
  assignedAt: string | null = null
): AcaOverviewRecord {
  return {
    id,
    display_number: `ENR-${id}`,
    client_name: id,
    stage_id: "s1",
    agent_email: null,
    caller_email: null,
    responsible_enroll_email: email,
    created_at: "2026-08-01T00:00:00.000Z",
    closed_at: null,
    archived_at: null,
    stage_entered_at: "2026-08-01T00:00:00.000Z",
    stage_entered_source: "live",
    last_work_activity_at: null,
    responsible_assigned_at: assignedAt,
  };
}

function input(
  records: AcaOverviewRecord[],
  people = [
    { email: "a@x.com", name: "A", canWork: true, queueEnabled: true },
    { email: "b@x.com", name: "B", canWork: true, queueEnabled: true },
    { email: "c@x.com", name: "C", canWork: true, queueEnabled: true },
  ]
): AcaOverviewInput {
  return {
    records,
    stages: STAGES,
    people,
    stageDwellMedianSeconds: new Map(),
    thresholdDays: 3,
    now: NOW,
  };
}

describe("buildQueue", () => {
  it("ranks never-assigned people first, then longest-waiting", () => {
    const queue = buildQueue(
      input([
        record("r1", "a@x.com", "2026-08-12T00:00:00.000Z"),
        record("r2", "b@x.com", "2026-08-02T00:00:00.000Z"),
      ])
    );
    expect(queue.map((card) => card.email)).toEqual(["c@x.com", "b@x.com", "a@x.com"]);
    expect(queue[0].lastAssignedAt).toBeNull();
  });

  it("takes each person's most recent assignment, not their oldest", () => {
    const queue = buildQueue(
      input(
        [
          record("old", "a@x.com", "2026-07-01T00:00:00.000Z"),
          record("new", "a@x.com", "2026-08-12T00:00:00.000Z"),
          record("mid", "b@x.com", "2026-08-05T00:00:00.000Z"),
        ],
        [
          { email: "a@x.com", name: "A", canWork: true, queueEnabled: true },
          { email: "b@x.com", name: "B", canWork: true, queueEnabled: true },
        ]
      )
    );
    expect(queue.map((card) => card.email)).toEqual(["b@x.com", "a@x.com"]);
  });

  it("still counts a closed record's assignment, so finishing work does not reset your turn", () => {
    const closed: AcaOverviewRecord = {
      ...record("done", "a@x.com", "2026-08-12T00:00:00.000Z"),
      closed_at: "2026-08-12T00:00:00.000Z",
    };
    const queue = buildQueue(
      input([closed], [
        { email: "a@x.com", name: "A", canWork: true, queueEnabled: true },
        { email: "b@x.com", name: "B", canWork: true, queueEnabled: true },
      ])
    );
    expect(queue.map((card) => card.email)).toEqual(["b@x.com", "a@x.com"]);
    expect(queue.find((card) => card.email === "a@x.com")?.holding).toBe(0);
  });

  it("excludes people switched off in the queue", () => {
    const queue = buildQueue(
      input([], [
        { email: "a@x.com", name: "A", canWork: true, queueEnabled: true },
        { email: "b@x.com", name: "B", canWork: true, queueEnabled: false },
      ])
    );
    expect(queue.map((card) => card.email)).toEqual(["a@x.com"]);
  });

  it("reports holding and stuck without letting them affect the order", () => {
    const queue = buildQueue(
      input(
        [
          record("r1", "a@x.com", "2026-08-12T00:00:00.000Z"),
          record("r2", "a@x.com", "2026-08-12T00:00:00.000Z"),
        ],
        [{ email: "a@x.com", name: "A", canWork: true, queueEnabled: true }]
      )
    );
    expect(queue[0].holding).toBe(2);
    expect(queue[0].stuck).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/enrollment/aca-overview-queue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { daysInStage, isStuck } from "./aca-overview-timing";
import type { AcaOverviewInput, AcaOverviewQueueCard } from "./aca-overview-types";

export function buildQueue(input: AcaOverviewInput): AcaOverviewQueueCard[] {
  const open = input.records.filter((record) => !record.archived_at && !record.closed_at);

  // Turn order is driven by every record ever handed to a person, INCLUDING
  // closed ones. Counting only open records would reset someone's turn the
  // moment they finished their work — punishing speed, which is exactly what a
  // rotation queue exists to prevent.
  const lastAssigned = new Map<string, string>();
  for (const record of input.records) {
    const email = record.responsible_enroll_email;
    const assignedAt = record.responsible_assigned_at;
    if (!email || !assignedAt) continue;
    const current = lastAssigned.get(email);
    if (!current || new Date(assignedAt).getTime() > new Date(current).getTime()) {
      lastAssigned.set(email, assignedAt);
    }
  }

  return input.people
    .filter((person) => person.queueEnabled && person.canWork)
    .map((person) => {
      const mine = open.filter((record) => record.responsible_enroll_email === person.email);
      return {
        email: person.email,
        name: person.name,
        lastAssignedAt: lastAssigned.get(person.email) ?? null,
        // Displayed but deliberately absent from the sort. A pure turn queue
        // will happily surface someone already holding forty records; the
        // person assigning needs to see that before acting, without the queue
        // quietly turning back into a load ranking.
        holding: mine.length,
        stuck: mine.filter((record) => isStuck(daysInStage(record, input.now), input.thresholdDays))
          .length,
      };
    })
    .sort((first, second) => {
      if (first.lastAssignedAt === null && second.lastAssignedAt === null) {
        return first.email.localeCompare(second.email);
      }
      if (first.lastAssignedAt === null) return -1;
      if (second.lastAssignedAt === null) return 1;
      return (
        new Date(first.lastAssignedAt).getTime() - new Date(second.lastAssignedAt).getTime()
      );
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/enrollment/aca-overview-queue.test.ts`
Expected: PASS, 5 tests.

Note the interaction with the date-range decision: because every section obeys the created-in-range cohort, a narrowed range can hide the records that carry someone's `responsible_assigned_at`, making a busy person look never-assigned and rank first. That is why the dashboard defaults to `All dates` and why the queue must render the selected range in its caption.

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrollment/aca-overview-queue.ts src/lib/enrollment/aca-overview-queue.test.ts
git commit -m "feat(enrollment): add ACA overview assignment queue ranking"
```

---

## Task 10: Denormalised time-since columns

**Files:**
- Modify: `supabase/rollouts/2026-08-13-aca-overview-schema.sql`
- Modify: `supabase/rollouts/2026-08-13-aca-overview-test.sql`

**Interfaces:**
- Consumes: `enrollment_records`, `patch_enrollment_atomic`, `create_enrollment_atomic`
- Produces: `enrollment_records.last_work_activity_at` and `enrollment_records.responsible_assigned_at`, maintained on every write. Tasks 4, 9 and 11 read these; nothing derives them at read time.

**Why not compute these on read.** The obvious implementation — scan `enrollment_activity`, group by record, take the maximum — was measured at **~55 sequential requests and ~50,000 rows transferred per page load** at 5,000 records, against a table whose only index is `(record_id, created_at desc)` (`supabase/schema.sql:4282-4283`), with no index on `type` and no GIN on `meta`. The table is appended to on every patch and never pruned.

It is also *wrong* for assignment. A **caller-only** edit satisfies `touchesPeople` (`src/app/api/enrollment/[id]/route.ts:253-254`) and writes a `people_changed` row whose `meta.responsible_enroll` holds the **unchanged** responsible person (`:402-409`). Reading "the latest `people_changed` naming this person" would push someone to the back of the rotation who was never re-assigned. The activity row does not store the previous value, so this is not recoverable from the log alone.

CS already solved this by denormalising — `task_assignment_rotation` (`supabase/schema.sql:3020-3027`) bumped by `bump_task_assignment_rotation` (`:3039-3074`). This task does the same thing with two columns instead of a side table, because enrollment needs the value per record anyway.

- [ ] **Step 1: Append the columns and backfill to the rollout**

```sql
-- Time-since values are written at mutation time, never derived at read time.
alter table enrollment_records
  add column if not exists last_work_activity_at timestamptz,
  add column if not exists responsible_assigned_at timestamptz;

-- Seed last_work_activity_at from history, applying the same exclusions the
-- live maintenance will apply: no comments, no attachments, and nothing the
-- cron wrote. `enrollment_touch_activity` already uses the 'system' rule
-- (2026-08-09-enrollment-stage-time-schema.sql:468).
update enrollment_records r
set last_work_activity_at = source.moment
from (
  select a.record_id, max(a.created_at) as moment
  from enrollment_activity a
  where a.type not in ('comment_added', 'attachment_added')
    and coalesce(lower(btrim(a.actor_email)), '') <> 'system'
  group by a.record_id
) source
where source.record_id = r.id
  and r.last_work_activity_at is distinct from source.moment;

-- Records with no qualifying activity fall back to creation, so nothing is
-- left null and the read path never has to guess.
update enrollment_records
set last_work_activity_at = created_at
where last_work_activity_at is null;

-- Seed responsible_assigned_at. Best available signal for existing rows: the
-- latest people_changed naming the CURRENT responsible, else the record's
-- creation. This is approximate for history by necessity; every row written
-- from now on is exact.
update enrollment_records r
set responsible_assigned_at = coalesce(
  (
    select max(a.created_at)
    from enrollment_activity a
    where a.record_id = r.id
      and a.type = 'people_changed'
      and enrollment_norm_email(a.meta->>'responsible_enroll')
          = enrollment_norm_email(r.responsible_enroll_email)
  ),
  r.created_at
)
where r.responsible_enroll_email is not null
  and r.responsible_assigned_at is null;

create index if not exists enrollment_records_responsible_assigned_idx
  on enrollment_records (responsible_enroll_email, responsible_assigned_at desc)
  where responsible_enroll_email is not null;
```

- [ ] **Step 2: Maintain both columns in `patch_enrollment_atomic`**

Open `supabase/rollouts/2026-08-09-enrollment-stage-time-schema.sql` and copy the whole `create or replace function patch_enrollment_atomic(...)` body into the new rollout file, then make exactly three changes. Re-creating the function wholesale is required — Postgres has no partial function edit — so copy it verbatim first and diff before running.

**(a)** Add two declarations beside the existing `next_stage_entered_at`:

```sql
  responsible_changed boolean;
  p_is_work_activity boolean;
```

**(b)** After the existing `stage_changed := ...` line, add:

```sql
  responsible_changed := (
    case when p_patch ? 'responsible_enroll_email'
      then enrollment_norm_email(p_patch->>'responsible_enroll_email')
      else target_record.responsible_enroll_email end
  ) is distinct from target_record.responsible_enroll_email;

  -- Real work = anything that is not purely a comment or an attachment, and
  -- not the cron. Comments and attachments arrive through their own routes and
  -- call enrollment_touch_activity instead of this function, so in practice
  -- every call that reaches here is work; the guard is belt-and-braces for the
  -- day someone routes a comment patch through here.
  p_is_work_activity := actor is distinct from 'system';
```

**(c)** In the `update enrollment_records set` list, beside the existing `last_activity_at` assignment, add:

```sql
    last_work_activity_at = case
      when p_is_work_activity then greatest(coalesce(last_work_activity_at, v_now), v_now)
      else last_work_activity_at end,
    responsible_assigned_at = case
      when responsible_changed then v_now
      else responsible_assigned_at end,
```

Note `responsible_changed` compares **values**, not key presence. This is the whole point of the task: a patch that carries `caller_email` alone, or that re-sends the same responsible, must not move the clock.

- [ ] **Step 3: Maintain both columns in `create_enrollment_atomic`**

Same copy-then-edit approach. In the `insert into enrollment_records (...)` column list add `last_work_activity_at, responsible_assigned_at`, and in the `values (...)` list add:

```sql
    p_now,
    case when enrollment_norm_email(p_record->>'responsible_enroll_email') is null
      then null else p_now end,
```

This is what dissolves the create-time gap: a record created already-assigned stamps the column, so there is no second source to union at read time and no person who looks permanently un-assigned.

- [ ] **Step 4: Re-apply the grants**

The `create or replace` statements reset nothing, but re-run the existing grant block from `2026-08-09-enrollment-stage-time-schema.sql:478-494` for `patch_enrollment_atomic` and `create_enrollment_atomic` to be certain they remain `service_role` only.

- [ ] **Step 5: Append assertions**

```sql
do $$
declare
  null_activity integer;
  null_assigned integer;
begin
  select count(*) into null_activity
  from enrollment_records where last_work_activity_at is null;
  if null_activity > 0 then
    raise exception 'last_work_activity_at left null on % rows', null_activity;
  end if;

  select count(*) into null_assigned
  from enrollment_records
  where responsible_enroll_email is not null and responsible_assigned_at is null;
  if null_assigned > 0 then
    raise exception 'responsible_assigned_at left null on % assigned rows', null_assigned;
  end if;
end $$;
```

- [ ] **Step 6: Verify a caller-only edit does not move the assignment clock**

This is the bug the whole task exists to prevent, so test it directly. Against a scratch record, run `patch_enrollment_atomic` with a patch containing only `caller_email`, then confirm `responsible_assigned_at` is unchanged and `last_work_activity_at` advanced:

```sql
do $$
declare
  target uuid;
  before_assigned timestamptz;
  after_assigned timestamptz;
  after_activity timestamptz;
  expected timestamptz;
begin
  select id, responsible_assigned_at into target, before_assigned
  from enrollment_records
  where program = 'aca' and responsible_enroll_email is not null
    and archived_at is null
  limit 1;
  if target is null then
    raise notice 'no assigned ACA record available; skipping';
    return;
  end if;

  perform patch_enrollment_atomic(
    target,
    (select updated_at from enrollment_records where id = target),
    jsonb_build_object('caller_email', 'queue-probe@example.com'),
    'queue-probe@example.com'
  );

  select responsible_assigned_at, last_work_activity_at
    into after_assigned, after_activity
  from enrollment_records where id = target;

  if after_assigned is distinct from before_assigned then
    raise exception 'caller-only edit moved responsible_assigned_at: % -> %',
      before_assigned, after_assigned;
  end if;
  if after_activity <= before_assigned then
    raise exception 'caller-only edit did not advance last_work_activity_at';
  end if;
end $$;
```

Run it, then **roll the probe back** — it wrote a real caller value:

```sql
update enrollment_records
set caller_email = null
where caller_email = 'queue-probe@example.com';
```

- [ ] **Step 7: Commit**

```bash
git add supabase/rollouts/2026-08-13-aca-overview-schema.sql supabase/rollouts/2026-08-13-aca-overview-test.sql
git commit -m "feat(enrollment): maintain last-work-activity and responsible-assigned timestamps"
```

## Task 11: Data access

**Files:**
- Create: `src/lib/enrollment/aca-overview-data.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin` from `@/lib/supabase`; `assertEnrollmentRecordsComplete` from `./queries`; the types from Task 2
- Produces: `fetchAcaOverviewInput({ from, to, thresholdDays, people, now }): Promise<AcaOverviewInput>`

- [ ] **Step 1: Write the implementation**

```ts
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchEnrollmentOptionData } from "./options";
import { assertEnrollmentRecordsComplete } from "./queries";
import { summarizeDurations } from "./stage-time";
import type {
  AcaOverviewInput,
  AcaOverviewPerson,
  AcaOverviewRecord,
  AcaOverviewThresholdDays,
} from "./aca-overview-types";

const PAGE_SIZE = 1000;

const RECORD_COLUMNS =
  "id,display_number,client_name,stage_id,agent_email,caller_email," +
  "responsible_enroll_email,created_at,closed_at,archived_at," +
  "stage_entered_at,stage_entered_source,last_work_activity_at,responsible_assigned_at";

/**
 * No scope argument. The dashboard is manager/admin only (spec §12b item 1), so
 * it reads the whole program. Applying `applyEnrollmentScope` here would silently
 * answer "who is loaded?" from one agent's slice of the org.
 * The route is responsible for refusing non-managers before calling this.
 */
export async function fetchAcaOverviewInput(params: {
  from: string | null;
  to: string | null;
  thresholdDays: AcaOverviewThresholdDays;
  people: readonly AcaOverviewPerson[];
  now?: Date;
}): Promise<AcaOverviewInput> {
  const supabase = getSupabaseAdmin();
  const now = params.now ?? new Date();

  // Paginated AND completeness-checked. The existing `fetchEnrollmentOverview`
  // (overview-data.ts:38-52) does neither and can silently truncate at
  // PostgREST's row cap — and the spec's own `#2 + #3 + #4 = #1` invariant
  // cannot detect that, because all four counts truncate together.
  const records: AcaOverviewRecord[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase
      .from("enrollment_records")
      .select(RECORD_COLUMNS, { count: "exact" })
      .eq("program", "aca")
      .is("archived_at", null);
    if (params.from) query = query.gte("created_at", `${params.from}T00:00:00.000Z`);
    if (params.to) query = query.lte("created_at", `${params.to}T23:59:59.999Z`);

    const result = await query.range(offset, offset + PAGE_SIZE - 1);
    if (result.error) throw new Error(result.error.message);
    const page = (result.data ?? []) as AcaOverviewRecord[];
    records.push(...page);
    if (page.length < PAGE_SIZE) {
      assertEnrollmentRecordsComplete(records, result.count);
      break;
    }
  }

  const optionData = await fetchEnrollmentOptionData("aca");
  const stages = optionData.optionsBySet.stage;

  // No activity or assignment queries: Task 10 maintains both timestamps on the
  // record itself, so they arrived with the fetch above.
  const stageDwellMedianSeconds = await fetchStageDwellMedians(
    records.map((record) => record.id)
  );

  return {
    records,
    stages,
    people: params.people,
    stageDwellMedianSeconds,
    thresholdDays: params.thresholdDays,
    now,
  };
}

async function fetchStageDwellMedians(
  recordIds: readonly string[]
): Promise<Map<string, number | null>> {
  const supabase = getSupabaseAdmin();
  const byStage = new Map<string, number[]>();
  const CHUNK = 500;

  for (let start = 0; start < recordIds.length; start += CHUNK) {
    const ids = recordIds.slice(start, start + CHUNK);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const result = await supabase
        .from("enrollment_stage_cycles")
        .select("stage_id,duration_seconds")
        .in("record_id", ids)
        .eq("program", "aca")
        .eq("kind", "dwell")
        .eq("source", "live")
        .not("ended_at", "is", null)
        .range(offset, offset + PAGE_SIZE - 1);
      if (result.error) throw new Error(result.error.message);
      const page = (result.data ?? []) as { stage_id: string; duration_seconds: number | null }[];
      for (const row of page) {
        if (row.duration_seconds === null) continue;
        const list = byStage.get(row.stage_id) ?? [];
        list.push(Math.max(0, row.duration_seconds));
        byStage.set(row.stage_id, list);
      }
      if (page.length < PAGE_SIZE) break;
    }
  }

  const medians = new Map<string, number | null>();
  for (const [stageId, durations] of byStage) {
    const summary = summarizeDurations(durations);
    // summarizeDurations already applies MIN_DURATION_SAMPLE; `measured` false
    // means the sample is too thin to publish a figure from.
    medians.set(stageId, summary.measured ? summary.medianSeconds : null);
  }
  return medians;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS. If `fetchEnrollmentOptionData` has a different name or signature in `./options`, use the actual export — do not add a wrapper.

- [ ] **Step 3: Commit**

```bash
git add src/lib/enrollment/aca-overview-data.ts
git commit -m "feat(enrollment): add ACA overview data access"
```

---

## Task 11b: Queue membership and people roster

**Files:**
- Modify: `supabase/rollouts/2026-08-13-aca-overview-schema.sql`
- Modify: `supabase/rollouts/2026-08-13-aca-overview-test.sql`
- Modify: `src/lib/enrollment/aca-overview-data.ts`

**Interfaces:**
- Produces: `fetchAcaOverviewPeople(): Promise<AcaOverviewPerson[]>` — the `people` argument every caller of `fetchAcaOverviewInput` needs. Without this task, Task 9's queue has no roster and Task 12's route has an undefined `people`.

Spec §9.3 and §9.4 both land here: the queue needs per-person membership storage, and the threshold needs a per-program default. Neither exists yet.

- [ ] **Step 1: Append storage to the rollout**

```sql
-- Queue membership for the ACA overview assignment queue. Mirrors the CS
-- queueEnabled concept, which has no enrollment equivalent. Default true so a
-- newly added worker is in rotation rather than silently invisible.
create table if not exists enrollment_queue_members (
  email text primary key,
  program text not null default 'aca' check (program in ('aca', 'medicare')),
  queue_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by_email text
);

alter table enrollment_queue_members enable row level security;

-- Per-program dashboard defaults. One row per program.
create table if not exists enrollment_overview_settings (
  program text primary key check (program in ('aca', 'medicare')),
  default_threshold_days integer not null default 3
    check (default_threshold_days in (1, 3, 7, 10)),
  -- 'all', not 'thisMonth'. Every section obeys the date range (spec §12b
  -- item 3), so a narrowed default would open the dashboard on a partial view
  -- in which a fully-loaded person can read as `Holding 0` and rank first in
  -- the assignment queue. The whole-operation view is the safe thing to land on.
  default_date_preset text not null default 'all'
    check (default_date_preset in
      ('fixed', 'today', 'yesterday', 'thisMonth', 'last7', 'last14', 'last30', 'all')),
  updated_at timestamptz not null default now()
);

alter table enrollment_overview_settings enable row level security;

insert into enrollment_overview_settings (program, default_threshold_days)
values ('aca', 3)
on conflict (program) do nothing;
```

- [ ] **Step 2: Append the assertion**

```sql
do $$
declare
  aca_default integer;
begin
  select default_threshold_days into aca_default
  from enrollment_overview_settings where program = 'aca';
  if aca_default is null then
    raise exception 'ACA overview settings row missing';
  end if;
end $$;
```

- [ ] **Step 3: Run the rollout and assertions**

Run both files. Expected: no output.

- [ ] **Step 4: Add the roster fetch**

Append to `src/lib/enrollment/aca-overview-data.ts`:

```ts
/**
 * The roster the queue rotates over. People with no membership row default to
 * enabled: a newly added worker should appear in rotation, not vanish until an
 * admin notices. Someone on leave is removed by unticking them, not by any
 * automatic activity rule.
 */
export async function fetchAcaOverviewPeople(): Promise<AcaOverviewPerson[]> {
  const supabase = getSupabaseAdmin();

  const accounts = await supabase
    .from("app_users")
    .select("email,name,is_active")
    .eq("is_active", true);
  if (accounts.error) throw new Error(accounts.error.message);

  const membership = await supabase
    .from("enrollment_queue_members")
    .select("email,queue_enabled")
    .eq("program", "aca");
  if (membership.error) throw new Error(membership.error.message);

  const disabled = new Set(
    ((membership.data ?? []) as { email: string; queue_enabled: boolean }[])
      .filter((row) => !row.queue_enabled)
      .map((row) => row.email.toLowerCase())
  );

  return ((accounts.data ?? []) as { email: string; name: string | null }[]).map((row) => ({
    email: row.email.toLowerCase(),
    name: row.name,
    canWork: true,
    queueEnabled: !disabled.has(row.email.toLowerCase()),
  }));
}

export async function fetchAcaOverviewDefaults(): Promise<{
  thresholdDays: AcaOverviewThresholdDays;
  datePreset: string;
}> {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from("enrollment_overview_settings")
    .select("default_threshold_days,default_date_preset")
    .eq("program", "aca")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const row = result.data as
    | { default_threshold_days: number; default_date_preset: string }
    | null;
  return {
    thresholdDays: (ACA_OVERVIEW_THRESHOLD_DAYS as readonly number[]).includes(
      row?.default_threshold_days ?? -1
    )
      ? (row!.default_threshold_days as AcaOverviewThresholdDays)
      : ACA_OVERVIEW_DEFAULT_THRESHOLD_DAYS,
    // 'all' rather than 'thisMonth'. Every section obeys the date range, so a
    // narrowed default opens the dashboard on a view in which a fully-loaded
    // person can read as `Holding 0` and rank first in the assignment queue.
    datePreset: row?.default_date_preset ?? "all",
  };
}

export async function fetchAcaDefaultThresholdDays(): Promise<AcaOverviewThresholdDays> {
  return (await fetchAcaOverviewDefaults()).thresholdDays;
}
```

Add `ACA_OVERVIEW_THRESHOLD_DAYS` and `ACA_OVERVIEW_DEFAULT_THRESHOLD_DAYS` to the existing import from `./aca-overview-types`.

**Before writing this, open `src/lib/enrollment/overview-data.ts` and check the real table and column names for the account roster.** `app_users` / `is_active` above is the expected shape; if the codebase names them differently, use the actual names rather than adding a compatibility layer.

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/rollouts/2026-08-13-aca-overview-schema.sql supabase/rollouts/2026-08-13-aca-overview-test.sql src/lib/enrollment/aca-overview-data.ts
git commit -m "feat(enrollment): add ACA overview queue membership and threshold defaults"
```

---

## Task 12: Snapshot composition and API route

**Files:**
- Create: `src/lib/enrollment/aca-overview.ts`
- Test: `src/lib/enrollment/aca-overview.test.ts`
- Create: `src/app/api/enrollment/aca-overview/route.ts`

**Interfaces:**
- Consumes: every `build*` function from Tasks 5-9
- Produces: `aggregateAcaOverview(input, period): AcaOverviewSnapshot`; `GET /api/enrollment/aca-overview?from&to&threshold`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { aggregateAcaOverview } from "./aca-overview";
import type { AcaOverviewInput } from "./aca-overview-types";
import type { EnrollmentOption } from "./types";

const NOW = new Date("2026-08-13T00:00:00.000Z");

const STAGES = [
  {
    id: "s1",
    set_id: "stage-set",
    label: "1-Need quote",
    color: null,
    position: 0,
    is_terminal: false,
    triggers_qc: false,
    treat_as_terminal: false,
  } as EnrollmentOption,
];

const INPUT: AcaOverviewInput = {
  records: [
    {
      id: "r1",
      display_number: "ENR-1",
      client_name: "C",
      stage_id: "s1",
      agent_email: null,
      caller_email: null,
      responsible_enroll_email: "a@x.com",
      created_at: "2026-08-01T00:00:00.000Z",
      closed_at: null,
      archived_at: null,
      stage_entered_at: "2026-08-01T00:00:00.000Z",
      stage_entered_source: "live",
      last_work_activity_at: null,
      responsible_assigned_at: null,
    },
  ],
  stages: STAGES,
  people: [{ email: "a@x.com", name: "A", canWork: true, queueEnabled: true }],
  stageDwellMedianSeconds: new Map(),
  thresholdDays: 3,
  now: NOW,
};

describe("aggregateAcaOverview", () => {
  it("returns every section and echoes the threshold and period", () => {
    const snapshot = aggregateAcaOverview(INPUT, { from: "2026-08-01", to: "2026-08-13" });
    expect(snapshot.thresholdDays).toBe(3);
    expect(snapshot.period).toEqual({ from: "2026-08-01", to: "2026-08-13" });
    expect(snapshot.scorecards.totalTasks).toBe(1);
    expect(snapshot.stageTable[0].stageLabel).toBe("0-Unassigned");
    expect(snapshot.actions).toHaveLength(1);
    expect(snapshot.people.some((row) => row.name === "Team total")).toBe(true);
    expect(snapshot.matrix.stageLabels).toEqual(["1-Need quote"]);
    expect(snapshot.queue).toHaveLength(1);
    expect(snapshot.unassigned).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/enrollment/aca-overview.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the composition module**

```ts
import { buildActionRows, buildUnassignedRows } from "./aca-overview-actions";
import { buildMatrix, buildPeopleRows } from "./aca-overview-people";
import { buildQueue } from "./aca-overview-queue";
import { buildScorecards } from "./aca-overview-scorecards";
import { buildStageTable } from "./aca-overview-stage-table";
import type { AcaOverviewInput, AcaOverviewSnapshot } from "./aca-overview-types";

export function aggregateAcaOverview(
  input: AcaOverviewInput,
  period: { from: string; to: string }
): AcaOverviewSnapshot {
  return {
    generatedAt: input.now.toISOString(),
    period,
    thresholdDays: input.thresholdDays,
    scorecards: buildScorecards(input),
    stageTable: buildStageTable(input),
    actions: buildActionRows(input),
    people: buildPeopleRows(input),
    matrix: buildMatrix(input),
    queue: buildQueue(input),
    unassigned: buildUnassignedRows(input),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/enrollment/aca-overview.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Write the route**

Open `src/app/api/enrollment/overview/route.ts` first and copy its actor resolution and error-shape conventions exactly. **Do not copy its scope resolution** — this endpoint is manager-only and unscoped. Read the route-handler guide in `node_modules/next/dist/docs/` before writing it; this Next.js version's conventions may differ from the ones you know.

Then create `src/app/api/enrollment/aca-overview/route.ts`:

```ts
// Manager/admin only, and therefore unscoped. This is the gate that makes the
// unscoped read in fetchAcaOverviewInput safe: the dashboard answers "who on
// the team is loaded?", which is meaningless from one agent's slice.
if (!actor.isManager) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

const thresholdParam = Number(request.nextUrl.searchParams.get("threshold"));
const thresholdDays = (ACA_OVERVIEW_THRESHOLD_DAYS as readonly number[]).includes(thresholdParam)
  ? (thresholdParam as AcaOverviewThresholdDays)
  : await fetchAcaDefaultThresholdDays();

const from = request.nextUrl.searchParams.get("from");
const to = request.nextUrl.searchParams.get("to");

const input = await fetchAcaOverviewInput({
  from,
  to,
  thresholdDays,
  people: await fetchAcaOverviewPeople(),
});

return NextResponse.json(
  aggregateAcaOverview(input, { from: from ?? "", to: to ?? "" })
);
```

Empty `from`/`to` mean "all dates" and are the default the client opens with (Task 11b's `default_date_preset`). An out-of-range `threshold` falls back to the stored default rather than erroring — a bad query string should not blank the dashboard.

- [ ] **Step 6: Verify the whole suite still passes**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: PASS. The existing `overview.test.ts` must be untouched and still green — this plan adds a parallel endpoint and removes nothing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/enrollment/aca-overview.ts src/lib/enrollment/aca-overview.test.ts src/app/api/enrollment/aca-overview/route.ts
git commit -m "feat(enrollment): add ACA overview snapshot endpoint"
```

---

## Task 13: Changelog

**Files:**
- Modify: `agent-portal/changelog.md`

- [ ] **Step 1: Append the entry**

```markdown
## 2026-08-13 — ACA overview data layer

- Added a dashboard-only `treat_as_terminal` flag on enrollment stage options,
  seeded for `Can't Contact` and `Can not get ID card` only. `is_terminal` is
  untouched: it drives record closing elsewhere. `Need call to renewal` stays a
  running stage, unlike the existing hard-coded `stageIsBlocking` list.
- Added pure aggregation modules for the redesigned ACA overview: scorecards,
  stage table with a synthetic unassigned row, needs-action list, people table,
  person x stage matrix, and a turn-order assignment queue.
- Added `last_work_activity_at` and `responsible_assigned_at` to
  `enrollment_records`, maintained inside the atomic patch/create functions.
  Both were previously specified as read-time scans of `enrollment_activity`,
  measured at ~55 sequential requests and ~50k rows per page load; the
  assignment one was also wrong, because a caller-only edit writes a
  `people_changed` row naming the unchanged responsible person.
- The overview endpoint is manager-only and unscoped, and its record fetch is
  paginated with a completeness assertion — unlike the existing overview fetch,
  which has neither and can silently truncate.
- Stage dwell statistics stay suppressed below the existing 10-sample floor, and
  stage age is reported only for `stage_entered_source = 'live'`; backfilled
  entries are estimates and are not presented as measurements.
- Served at `GET /api/enrollment/aca-overview`. The existing overview endpoint
  and UI are unchanged.
```

- [ ] **Step 2: Commit**

```bash
git add changelog.md
git commit -m "docs: record ACA overview data layer"
```

---

## Follow-on plans (not in this document)

- **UI plan** — the seven rendered sections in spec §8, replacing the ACA branch of `EnrollmentOverview.tsx`: frozen columns and two-level header for the matrix, the horizontally scrolling queue strip, and the threshold selector.
- **Assignment write surface** — spec §7.6. Needs the permission gate, the existing assignment endpoint, and post-write snapshot refresh.
- **Per-person stage timing** — spec §9.1. Needs `enrollment_stage_cycles.responsible_enroll_email`, a backfill, and a decision on whether a mid-stage handover splits the cycle.

## Open questions carried from the spec

These do not block this plan; they block the follow-ons.

1. Which stages an unassigned record can legitimately occupy, and from which stage a responsible person becomes mandatory (spec §12.1). Task 7's `buildUnassignedRows` currently returns every unassigned running record regardless of stage.
2. Default date preset on load.
3. Whether the `Assign to` picker lists queue-enabled people or everyone permitted.
4. Whether a `Caller` role toggle is wanted on the people table.

## Codex implementation notes (2026-08-13)

- The roster table is `portal_account`, not `app_users`; the implementation
  uses `portal_account.email`, `name`, and `is_active`.
- The repository's canonical stage-time functions live in `supabase/schema.sql`
  and are newer than the original 2026-08-09 rollout copy. The new rollout
  re-creates the canonical function bodies before adding the two denormalised
  timestamps, so later stage-time fixes are not regressed.
- The `treat_as_terminal` field is threaded through the shared option fetch,
  the existing overview stage query, the option POST/PATCH routes, and Config's
  stage-rule UI. This prevents the old hard-coded `stageIsBlocking` definition
  from disagreeing with the new dashboard flag.
- The rollout is additive and does not run automatically from the app. The
  deploy gate is: apply the rollout SQL and disposable assertions before
  enabling the ACA overview route.

## Codex execution log

### Stage 1 — ACA terminal-stage configuration

- Commit: `1a88b55`
- Added `enrollment_options.treat_as_terminal` to the canonical schema and an
  additive rollout. The rollout marks the two agreed ACA outcomes (`Can't
  Contact`, `Can not get ID card`) without changing Medicare semantics.
- Threaded the field through option fetching, overview aggregation, option-set
  POST/PATCH, and Config's stage controls. `Terminal`/`QC` remain independent
  from the ACA dashboard flag.
- Verification: `npm run typecheck`; targeted overview/options Vitest tests.

### Stage 2 — Pure overview aggregation

- Commit: `5367554`
- Added typed ACA snapshot contracts, config-driven stage classification,
  timing/silence primitives, scorecards, stage table, needs-action and
  unassigned rows, people/matrix aggregation, queue ranking, and a composed
  aggregate function.
- Verification: `npm run typecheck`; `npm run test:run -- --run src/lib/enrollment/aca-overview-aggregate.test.ts`.

### Stage 3 — Snapshot storage, data access, and manager-only API

- Commit: `a737f9b`
- Added additive rollout/schema artifacts for work-activity and assignment
  timestamps, ACA queue membership/settings, and disposable schema assertions.
- Added paginated, date-cohort ACA snapshot loading from `enrollment_records`,
  `portal_account`, option data, and live dwell cycles, plus
  `GET /api/enrollment/aca-overview` with manager-only authorization and date
  validation.
- Added write-time timestamp maintenance and conservative backfill rules; the
  CS queue remains untouched.
- Verification: `npm run typecheck`; `git diff --check`.

### Stage 3 follow-up — cohort and terminal hardening

- Commit: `7893895`
- Scoped cycle-derived dwell medians to the selected created-at cohort, so a
  narrow dashboard date range cannot display global historical samples.
- Updated stage-table open counts to honor `treat_as_terminal` as well as the
  database `is_terminal` flag, with regression coverage.

### Final verification

- Full repository verification passed after implementation: `npm run test:run`
  (87 files, 604 tests), `npm run typecheck`, and `npm run build`.
- Follow-up boundary commit: `e18bd70` changes the inclusive `to` date into
  an exclusive next-day UTC boundary and adds a regression test for the exact
  boundary.
- Threshold-default follow-up: `36c22f3` reads the configured ACA
  `enrollment_overview_settings.threshold_days` value when the query is absent
  or invalid, while explicit valid picker values still win.
- Dwell guard follow-up: `73cdd9f` limits cycle reads to the existing 90-day
  live window and returns null medians until the 10-sample floor is met.
- Email-boundary follow-up: `60f01c6` normalizes record and cycle emails at the
  snapshot boundary so mixed-case database values still join the active roster
  and do not create false handover exclusions.
