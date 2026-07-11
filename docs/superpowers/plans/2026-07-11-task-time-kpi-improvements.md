# Task Time Tracking & Employee-KPI Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the task-board time model fully consistent end-to-end and turn the already-captured history into data a manager can actually use to evaluate staff.

**Architecture:** Time is tracked as cumulative per-stage seconds on `tasks` (`todo_seconds` / `in_progress_seconds` / `waiting_seconds`), with `*_started_at` marking the current open stint; an immutable audit trail lives in `task_stage_cycles`, `task_overdue_events`, `task_assignment_cycles`. This plan (A) closes small data-quality gaps so the audit trail is trustworthy, (B) surfaces a per-task time breakdown, and (C) adds a per-employee KPI report aggregating that data.

**Tech Stack:** Next.js App Router (v16, see `agent-portal/AGENTS.md`), Supabase (Postgres + service-role client), Vitest for pure-function tests, TypeScript.

## Global Constraints

- Pure time/SLA logic lives in `src/lib/tasks/sla.ts` and `src/lib/tasks/transitions.ts` and MUST stay unit-tested (Vitest). API routes call these; never duplicate the math in a route or component.
- `getSupabaseAdmin()` (service role) is server-only. Any new table must be added to the `protected_tables` RLS array in `supabase/schema.sql`.
- Schema changes go in `supabase/schema.sql` using `create table if not exists` / `add column if not exists` and are applied by the user re-running the file in the Supabase SQL editor — nothing auto-migrates.
- All new user-facing UI text in English (existing board convention).
- Commit after every task. Do NOT push to the `vercel` remote unless the user asks.

---

## Current State (verified 2026-07-11) — reference, not a task

The time model is internally consistent after the recent fixes. Recorded here so the plan's tasks don't re-litigate it:

- **Stage clocks** are cumulative: leaving a stage banks `elapsed(started_at → now)` into `{stage}_seconds` and nulls `{stage}_started_at`; display = accumulator + live open stint. Bouncing between stages never resets a clock.
- **SLA budget** (`sla_minutes`) is snapshotted once, on the first-ever In Progress entry, and never re-snapshotted — editing priority/category later can't move an in-flight deadline.
- **Active SLA window** (`isSlaActiveInProgress`, `sla.ts`): a task shows a live countdown/overdue state only while `status === "in_progress"` AND `overdue_count === 0` AND it has never entered Waiting. After Waiting (external blocker) or after the one overdue resolution, In Progress time is plain count-up effort — never overdue again.
- **Overdue happens at most once.** Resolving it (`/api/tasks/[id]/overdue-unlock`, reason required) and reopening a Done/Cancel task (`/api/tasks/[id]/reopen`, reason required) BOTH send the task back to **To Do**, bank the In Progress time already spent, keep the budget, and (for unlock) bump `overdue_count`. These two paths are now aligned.
- **Audit trail** is written on every transition: `task_stage_cycles` (one row per stint with `duration_seconds`, `started_by_email`, `ended_by_email`, `from/to_status`), `task_overdue_events` (one row per overdue incident with `overdue_seconds`, `resolved_by_email`, `reason`), `task_assignment_cycles` (assigned/unassigned windows per email).

## Findings & Gaps (ranked)

1. **[Biggest] No surface reads the history tables.** `task_stage_cycles` / `task_overdue_events` / `task_assignment_cycles` are write-only. The board's `agentStats` is a *live* count over the *currently-loaded* task list, keyed by **customer `agent_email`**, not by the **employee/assignee**, and its overdue count uses the once-only live `isTaskOverdue` so it under-reports historical overdue incidents. There is no way for a manager to answer "how did employee X do last month". → **Phase C.**
2. **No per-task time breakdown anywhere.** Opening a task shows the overdue log but not "To Do 2h / In Progress 3h / Waiting 1d / reopened 2×". Useful for a manager auditing one task, and cheap (data already on the row). → **Phase B.**
3. **[Data quality] Non-active In Progress stints still record a `due_at`/`sla_minutes` in `task_stage_cycles`.** When a task re-enters In Progress after Waiting or after an overdue resolution, the SLA is *not* active for that stint, but `recordStageTransition` still writes `due_at = started_at + sla_minutes`, implying a deadline that isn't enforced. A report that trusts `task_stage_cycles.due_at` would count false "should-have-been-done-by" deadlines. → **Phase A.**
4. **[Minor] `overdue_flagged_at` is now redundant with `overdue_count > 0`.** Both are set together by cron and by unlock; they must stay in sync. Not a bug — documented, no code change proposed.

---

## PHASE A — Data-quality fix so the audit trail is trustworthy

### Task A1: Only stamp SLA deadline on stage-cycles that are actually under active SLA

**Files:**
- Modify: `src/lib/tasks/history.ts` (the `dueAtFor` helper + its two call sites `startStageCycle` and `closeStageCycle`)
- Modify: `src/app/api/tasks/[id]/route.ts` (PATCH handler — pass whether the new In Progress stint is SLA-active into `recordStageTransition`)
- Test: `src/lib/tasks/history.test.ts` (new file — pure helper only)

**Interfaces:**
- Consumes: `isSlaActiveInProgress(task)` from `src/lib/tasks/sla.ts` (already exported; signature `(task: { status; in_progress_at; overdue_count; waiting_started_at?; waiting_seconds? }) => boolean`).
- Produces: `dueAtFor(stage, startedAt, slaMinutes, slaActive)` — the added 4th boolean param gates the deadline; returns `string | null`.

- [ ] **Step 1: Write the failing test** for the pure helper.

Create `src/lib/tasks/history.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dueAtForStint } from "@/lib/tasks/history";

describe("dueAtForStint", () => {
  const startedAt = "2026-07-05T00:00:00.000Z";
  it("returns a deadline for an SLA-active In Progress stint", () => {
    expect(dueAtForStint("in_progress", startedAt, 60, true)).toBe(
      "2026-07-05T01:00:00.000Z"
    );
  });
  it("returns null for an In Progress stint that is NOT SLA-active (post-Waiting / post-overdue)", () => {
    expect(dueAtForStint("in_progress", startedAt, 60, false)).toBeNull();
  });
  it("returns null for non-In-Progress stages regardless", () => {
    expect(dueAtForStint("todo", startedAt, 60, true)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tasks/history.test.ts`
Expected: FAIL — `dueAtForStint` is not exported.

- [ ] **Step 3: Extract + gate the helper in `history.ts`**

Replace the existing private `dueAtFor` with an exported, gated version, and update both call sites to compute `slaActive` and pass it:

```ts
// Exported so it is unit-tested. A stint only has an enforceable SLA deadline
// when it is In Progress AND the SLA is active for it (first run, before any
// Waiting, before the one overdue resolution). Otherwise there is no deadline
// to record, so downstream reports can trust task_stage_cycles.due_at.
export function dueAtForStint(
  stage: TaskStatus,
  startedAt: string,
  slaMinutes: number | null,
  slaActive: boolean
): string | null {
  if (stage !== "in_progress" || !slaActive || typeof slaMinutes !== "number") {
    return null;
  }
  return slaDeadline(startedAt, slaMinutes).toISOString();
}
```

In `startStageCycle`, replace `dueAtFor(params.stage, params.startedAt, params.slaMinutes ?? null)` with `dueAtForStint(params.stage, params.startedAt, params.slaMinutes ?? null, params.slaActive ?? false)` and add `slaActive?: boolean` to its params type. Do the same in `closeStageCycle`'s fallback insert (a closing stint that was never SLA-active passes `false`). In `recordStageTransition`, when the new stage is `in_progress`, compute `slaActive` from the post-patch task state:

```ts
const enteringInProgress = nextStatus === "in_progress";
const slaActive =
  enteringInProgress &&
  (params.task.overdue_count ?? 0) === 0 &&
  !hasEnteredWaiting(params.task); // import hasEnteredWaiting from "./sla"
```

Pass `slaActive` into the `startStageCycle` call. Add `overdue_count`, `waiting_started_at`, `waiting_seconds` to the `TaskTimingRow` Pick so the check compiles.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tasks/history.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full verify + commit**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: all green.

```bash
git add src/lib/tasks/history.ts src/lib/tasks/history.test.ts "src/app/api/tasks/[id]/route.ts"
git commit -m "fix(tasks): only record an SLA deadline on stage-cycles under active SLA"
```

---

## PHASE B — Per-task time breakdown in the detail drawer

### Task B1: A `StageTimeBreakdown` component and wire it into the drawer

**Files:**
- Create: `src/app/(authed)/tasks/_components/StageTimeBreakdown.tsx`
- Modify: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx` (render it near the OverdueLog)
- Test: none for the component (presentational); reuses the already-tested `stageElapsedSeconds` / `formatDurationSeconds` from `sla.ts`.

**Interfaces:**
- Consumes: `stageElapsedSeconds(accumulatorSeconds, startedAtIso, now)` and `formatDurationSeconds(totalSeconds)` from `src/lib/tasks/sla.ts`; the `TaskRow` fields `todo_seconds/in_progress_seconds/waiting_seconds`, `todo_started_at/in_progress_at/waiting_started_at`, `overdue_count`, `reopened_at`.
- Produces: `<StageTimeBreakdown task={TaskRow} now={Date} />`.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import type { TaskRow } from "@/lib/tasks/types";
import { formatDurationSeconds, stageElapsedSeconds } from "@/lib/tasks/sla";

// Cumulative time the task has spent in each stage across all stints, plus the
// permanent overdue / reopen counters. `now` ticks from the parent so open
// stints keep counting.
export function StageTimeBreakdown({ task, now }: { task: TaskRow; now: Date }) {
  const rows: { label: string; seconds: number }[] = [
    { label: "To Do", seconds: stageElapsedSeconds(task.todo_seconds, task.todo_started_at, now) },
    { label: "In Progress", seconds: stageElapsedSeconds(task.in_progress_seconds, task.in_progress_at, now) },
    { label: "Waiting", seconds: stageElapsedSeconds(task.waiting_seconds, task.waiting_started_at, now) },
  ];

  return (
    <div className="rounded border border-[#dfe1e6] p-3">
      <h3 className="mb-2 text-xs font-bold uppercase text-[#6b778c]">Time in stage</h3>
      <dl className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between text-sm">
            <dt className="text-[#44546f]">{row.label}</dt>
            <dd className="font-semibold text-[#172b4d]">{formatDurationSeconds(row.seconds)}</dd>
          </div>
        ))}
      </dl>
      {(task.overdue_count > 0 || task.reopened_at) ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {task.overdue_count > 0 ? (
            <span className="rounded bg-[#fff7d6] px-1.5 py-0.5 text-[11px] font-bold text-[#7f5f01]">
              Went overdue {task.overdue_count}×
            </span>
          ) : null}
          {task.reopened_at ? (
            <span className="rounded bg-[#deebff] px-1.5 py-0.5 text-[11px] font-bold text-[#0055cc]">
              Reopened
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Wire into the drawer**

In `TaskDetailDrawer.tsx`, import `StageTimeBreakdown` and render `<StageTimeBreakdown task={task} now={now} />` just above the existing `<OverdueLog … />`. If the drawer doesn't already receive a ticking `now`, pass `new Date()` from its parent the same way the board does (`SLA_TICK_MS` interval in `TaskBoardClient.tsx`); if that's more than a one-line change, render with `now={new Date()}` for v1 (updates on next drawer re-render) and note it.

- [ ] **Step 3: Verify + commit**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all green.

```bash
git add "src/app/(authed)/tasks/_components/StageTimeBreakdown.tsx" "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx"
git commit -m "feat(tasks): per-task stage-time breakdown in the detail drawer"
```

---

## PHASE C — Employee KPI report (NEEDS YOUR SIGN-OFF BEFORE CODING)

This is the main value for "quản lý nhân viên", but it needs product decisions before it can become bite-sized tasks — writing fabricated tasks for an unspecced report would be guesswork. Here is the proposed design and the decisions to lock.

### Proposed v1 (no schema change required)

Aggregate the data that already exists, per **assignee** (the employee), over a **date range**:

- **Source:** `tasks` joined to `task_assignees` (current assignee), plus `task_overdue_events` for historical overdue incidents. v1 attributes a task's whole stage time to its *current* assignee (simple, defensible). Precise time-windowed attribution via `task_assignment_cycles` is a v2.
- **Metrics per employee:** tasks assigned, tasks completed (Done), completion rate, total & average In Progress time (`sum/avg(in_progress_seconds)`), average handle time (created → closed), # tasks that went overdue (`count(overdue_count > 0)`) and total overdue minutes (`sum(task_overdue_events.overdue_seconds)`), # reopened (`count(reopened_at)`), # currently Waiting > 24h.
- **Surface:** a new `/api/tasks/report?from=&to=&assignee=` route (manager-only, gated by `PERMISSIONS.TASK_MANAGE`) returning the aggregates, and a Management-sidebar page rendering a sortable table + CSV export.

### Decisions to confirm (blocking)

1. **Attribution:** v1 = whole task time → *current* assignee (simple). Or do you need precise split across reassignments from day one (v2, uses `task_assignment_cycles`, more work)?
2. **Metric set:** is the list above the right one, or add/remove any (e.g. per-category breakdown, per customer-agent, urgent-only)?
3. **Overdue for KPI:** count "# tasks that ever went overdue" (once per task, matches the new model) — confirm that's the number you'll evaluate people on, vs total overdue duration, vs both.
4. **Access:** manager-only, or should an Agent/Assistant see the report for their own team's CS?

Once 1–4 are answered I'll extend this file with the Phase C TDD tasks (pure aggregation function + tests, the API route, the page) and we execute.

---

## Self-Review

- **Spec coverage:** Finding 3 → Task A1; Finding 2 → Task B1; Finding 1 → Phase C (design + blocking decisions, intentionally not yet decomposed). Finding 4 → documented, no task (correct — it's not a defect).
- **Placeholders:** Phase A/B steps contain real code and exact commands. Phase C is explicitly a proposal pending decisions, not fake tasks.
- **Type consistency:** `dueAtForStint` 4-arg signature used consistently in A1; `StageTimeBreakdown` props match `TaskRow` fields verified in `src/lib/tasks/types.ts`; `stageElapsedSeconds`/`formatDurationSeconds`/`hasEnteredWaiting`/`isSlaActiveInProgress` are all real current exports of `sla.ts`.
