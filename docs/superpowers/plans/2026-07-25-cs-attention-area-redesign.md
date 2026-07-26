# CS Attention Area Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a real false-positive bug in the CS Task Overview's "Attention areas" (`src/lib/tasks/overview.ts`) and give each category a clear, explained meaning. Only tasks that genuinely need a human to look at them should appear here — healthy tasks must never show up.

**The bug:** `unknown_effort` ("Unknown effort") fires for *any* In Progress task whose SLA clock isn't actively counting (`!isSlaActiveInProgress`). That happens whenever a task has *ever* gone through Waiting even once — completely normal workflow — so a perfectly healthy task that briefly waited on a customer document, then resumed, is flagged forever after and inflates the "Needs attention" KPI. It conflates "we can't display a reliable SLA number" (a computation limitation) with "this needs attention" (a business signal).

**The fix:** Replace `unknown_effort` with `previously_overdue` (a real signal: this task broke SLA at least once, even if it's not breaching right now — worth a check even though it recovered). A task that only ever used Waiting normally now gets **zero** flags. Also add two categories that are today completely invisible in Attention despite already being tracked elsewhere in the product: `stale` (no activity in a long time — reuses the exact `isStale()` definition the stale-reminder cron already uses) and `qc_needed` (Done/Cancel tasks awaiting QC review — a core CS workflow concept currently absent from Overview entirely).

**Architecture:** No new tables. `previously_overdue`/`stale` slot into the existing per-open-task flag derivation (`deriveOpenTask`, pure). `qc_needed` is a different shape (it's about *closed* tasks, which `deriveOpenTask` already ignores) — it's computed as its own small pass inside `aggregateOverview` over the same `input.tasks` array, attributed to CS via the same `assigneesByTask` map already used everywhere else, and merged into both the per-CS `riskFlags` set and its own `OverviewAttentionBar` entry. The UI change is small: `RISK_HELP`/`RISK_COLOR`/`ATTENTION_LABELS` are already-existing lookup tables keyed by flag — this plan only updates their entries, no new components.

**Tech Stack:** Vitest for the pure `overview.ts` layer (TDD, matches the existing `overview.test.ts` conventions already in this file).

**Note on concurrent work:** This file (`overview.ts`/`overview-data.ts`) has recently gained fair-assignment-queue fields (`queueDueAt`, `queueEnabled`, etc. — a separate, already-shipped feature). This plan does not touch any of that; it only touches the Attention/risk-flag machinery, which the queue feature never modified. If line numbers below don't match exactly when you start, re-grep the function names given — don't assume this plan's line numbers are authoritative over the real file.

## Global Constraints

- Every category must correspond to a genuinely at-risk task — never a healthy one. If a change to this file is unsure whether it introduces a false positive, don't ship it without a test proving the healthy case stays flag-free (see Task 2's tests).
- Reuse existing definitions, don't invent parallel ones: `stale` uses the exact same threshold/condition as `isStale()` in `src/lib/tasks/reminders.ts:29` (already used by the CS stale-reminder cron) — same `staleHours` setting, same exclusions (done/cancel/backlog never stale).
- `qc_needed` covers both **Done** and **Cancel** tasks awaiting review (QC applies to both in this product — cancel needs QC same as done, per existing notification types `qc_needed`/`qc_stale`).

---

### Task 1: Update risk-flag types and labels

**Files:**
- Modify: `src/lib/tasks/overview-types.ts`

**Interfaces:**
- Produces: the new `OverviewRiskFlag` union (`overdue`, `previously_overdue`, `todo_stuck`, `waiting_stuck`, `stale`, `qc_needed`) — every later task in this plan depends on this exact set.

- [ ] **Step 1: Replace `OVERVIEW_RISK_FLAGS`**

Find:
```typescript
export const OVERVIEW_RISK_FLAGS = [
  "overdue",
  "todo_stuck",
  "waiting_stuck",
  "unknown_effort",
] as const;
```

Replace with:

```typescript
export const OVERVIEW_RISK_FLAGS = [
  "overdue",
  "previously_overdue",
  "todo_stuck",
  "waiting_stuck",
  "stale",
  "qc_needed",
] as const;
```

- [ ] **Step 2: Add `done_reviewed_at` to `OverviewTaskInput`**

Needed so `aggregateOverview` can tell which closed tasks still need QC. Add after `closed_at`:

```typescript
  closed_at: string | null;
  done_reviewed_at: string | null;
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/tasks/overview-types.ts
git commit -m "feat(tasks): redefine attention risk flags (drop unknown_effort, add previously_overdue/stale/qc_needed)"
```

---

### Task 2: Fix the per-task flag derivation — TDD

**Files:**
- Modify: `src/lib/tasks/overview.ts`
- Modify: `src/lib/tasks/overview.test.ts`

**Interfaces:**
- Consumes: `OVERVIEW_RISK_FLAGS` from Task 1; `isStale` from `@/lib/tasks/reminders` (new import — this function already exists and is already used by the cron; do not reimplement its logic).
- Produces: `deriveOpenTask`'s corrected `riskFlags` output — Task 3 (the qc_needed cross-cutting piece) and Task 4 (UI) both depend on this being right first.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/tasks/overview.test.ts` (this file already has `account`/`task` helpers and an `aggregateOverview`-calling pattern from earlier tests in the same file — match their exact shape rather than redefining):

```typescript
describe("attention flags — no false positives on healthy tasks", () => {
  it("does NOT flag an in-progress task that merely passed through Waiting once and is now healthy", () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    const snapshot = aggregateOverview({
      now,
      accounts: [account("cs@x.com")],
      categories: [],
      taskAgents: [],
      assistantEmails: [],
      tasks: [
        task({
          id: "t1",
          status: "in_progress",
          priority: "medium",
          assignee_email: "cs@x.com",
          in_progress_at: now.toISOString(),
          waiting_started_at: "2026-07-20T00:00:00.000Z", // was in Waiting before...
          waiting_seconds: 3600, // ...proof it entered Waiting at some point
          overdue_count: 0, // ...but never actually went overdue
        }),
      ],
      assigneesByTask: new Map([["t1", ["cs@x.com"]]]),
      rules: [],
      reminderSettings: { todoHours: 24, waitingHours: 24 },
      rotationByEmail: new Map(),
    });
    const row = snapshot.csRows.find((r) => r.email === "cs@x.com")!;
    expect(row.riskFlags).toEqual([]);
    expect(snapshot.kpis.needsAttentionTaskCount).toBe(0);
  });

  it("flags previously_overdue for an in-progress task with overdue_count > 0 that isn't currently breaching", () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    const snapshot = aggregateOverview({
      now,
      accounts: [account("cs@x.com")],
      categories: [],
      taskAgents: [],
      assistantEmails: [],
      tasks: [
        task({
          id: "t1",
          status: "in_progress",
          priority: "medium",
          assignee_email: "cs@x.com",
          in_progress_at: now.toISOString(),
          overdue_count: 1, // went overdue once before, already handled/reset
        }),
      ],
      assigneesByTask: new Map([["t1", ["cs@x.com"]]]),
      rules: [],
      reminderSettings: { todoHours: 24, waitingHours: 24 },
      rotationByEmail: new Map(),
    });
    const row = snapshot.csRows.find((r) => r.email === "cs@x.com")!;
    expect(row.riskFlags).toContain("previously_overdue");
    expect(row.riskFlags).not.toContain("overdue"); // not currently breaching
  });

  it("flags stale for an open task with no recent activity, using the same threshold as the cron", () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    const snapshot = aggregateOverview({
      now,
      accounts: [account("cs@x.com")],
      categories: [],
      taskAgents: [],
      assistantEmails: [],
      tasks: [
        task({
          id: "t1",
          status: "todo",
          priority: "medium",
          assignee_email: "cs@x.com",
          last_activity_at: "2026-07-20T00:00:00.000Z", // 5 days ago
          todo_started_at: "2026-07-20T00:00:00.000Z",
        }),
      ],
      assigneesByTask: new Map([["t1", ["cs@x.com"]]]),
      rules: [],
      reminderSettings: { todoHours: 999, waitingHours: 999 }, // rule out todo_stuck firing too
      rotationByEmail: new Map(),
    });
    const row = snapshot.csRows.find((r) => r.email === "cs@x.com")!;
    // default staleHours in resolveReminderSettings-equivalent test input is 48h; 5 days > 48h
    expect(row.riskFlags).toContain("stale");
  });
});
```

Check whether `reminderSettings` in the existing test file's `OverviewInput` construction already carries a `staleHours` field (it currently only types `{ todoHours, waitingHours }` per `OverviewInput`). If not, this task's Step 2 below extends `OverviewInput.reminderSettings` to include `staleHours: number` — update the test's `reminderSettings` object literals across this file accordingly (add `staleHours: 48` to any existing test that constructs this object, so already-passing tests don't break from a newly-required field... but `reminderSettings` fields are used by dot-access, not destructured-required, so verify via `npx tsc --noEmit` in Step 3 below whether existing tests actually need updating, and only touch the ones that do).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/tasks/overview.test.ts`
Expected: FAIL — `stale`/`previously_overdue` flags don't exist yet; the healthy-Waiting-task test currently fails because `unknown_effort` still fires.

- [ ] **Step 3: Extend `OverviewInput.reminderSettings` with `staleHours`**

In `src/lib/tasks/overview.ts`, find:

```typescript
  reminderSettings: { todoHours: number; waitingHours: number };
```

Change to:

```typescript
  reminderSettings: { todoHours: number; waitingHours: number; staleHours: number };
```

- [ ] **Step 4: Fix `deriveOpenTask`**

Add the import at the top of `src/lib/tasks/overview.ts`:

```typescript
import { isStale } from "./reminders";
```

Find (the current buggy block):

```typescript
  if (task.status === "in_progress" && active) {
    const remainingSeconds = slaRemainingSeconds(task, rules, now);
    loadMinutes = Math.max(0, remainingSeconds / 60);
    if (isTaskOverdue(task, rules, now)) addFlag(flags, "overdue");
  } else if (task.status === "in_progress") {
    unknownEffort = true;
    addFlag(flags, "unknown_effort");
  } else if (task.status === "waiting") {
    loadMinutes = effective / 3;
  }

  if (task.status === "todo") {
    const age = ageSeconds(task.todo_started_at ?? task.created_at, now) ?? 0;
    if (age >= reminderSettings.todoHours * 3600) addFlag(flags, "todo_stuck");
  }
  if (task.status === "waiting") {
    const age = ageSeconds(task.waiting_started_at ?? task.created_at, now) ?? 0;
    if (age >= reminderSettings.waitingHours * 3600) addFlag(flags, "waiting_stuck");
  }
```

Replace with:

```typescript
  if (task.status === "in_progress" && active) {
    const remainingSeconds = slaRemainingSeconds(task, rules, now);
    loadMinutes = Math.max(0, remainingSeconds / 60);
    if (isTaskOverdue(task, rules, now)) addFlag(flags, "overdue");
  } else if (task.status === "in_progress") {
    // SLA tracking is inactive — either this task went overdue before, or it
    // passed through Waiting before. Only the former is worth flagging: a
    // task that simply waited on an external party once and is now
    // proceeding normally is healthy and gets no flag at all.
    unknownEffort = true;
    if (task.overdue_count > 0) addFlag(flags, "previously_overdue");
  } else if (task.status === "waiting") {
    loadMinutes = effective / 3;
  }

  if (task.status === "todo") {
    const age = ageSeconds(task.todo_started_at ?? task.created_at, now) ?? 0;
    if (age >= reminderSettings.todoHours * 3600) addFlag(flags, "todo_stuck");
  }
  if (task.status === "waiting") {
    const age = ageSeconds(task.waiting_started_at ?? task.created_at, now) ?? 0;
    if (age >= reminderSettings.waitingHours * 3600) addFlag(flags, "waiting_stuck");
  }
  if (isStale(task, reminderSettings.staleHours, now)) addFlag(flags, "stale");
```

(`unknownEffort`/the `OverviewTaskSummary.unknownEffort` field stay as-is — that field is a separate "can't compute a load number" display concern used elsewhere for the SLA-load display, distinct from whether it's an *attention-worthy* signal. Only the flag-adding changed.)

- [ ] **Step 5: Update `ATTENTION_LABELS`**

Find:

```typescript
const ATTENTION_LABELS: Record<OverviewRiskFlag, string> = {
  overdue: "Overdue in progress",
  todo_stuck: "Todo stuck",
  waiting_stuck: "Waiting stuck",
  unknown_effort: "Unknown effort",
};
```

Replace with:

```typescript
const ATTENTION_LABELS: Record<OverviewRiskFlag, string> = {
  overdue: "Overdue in progress",
  previously_overdue: "Previously overdue",
  todo_stuck: "Todo stuck",
  waiting_stuck: "Waiting stuck",
  stale: "Stale (no activity)",
  qc_needed: "QC needed",
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/tasks/overview.test.ts`
Expected: PASS (all tests, including the 3 new ones). Note `qc_needed` isn't wired up yet (Task 3) — no test above exercises it, so this is expected to compile even though `qc_needed` can't fire yet.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors — this will surface every call site that constructs an `OverviewInput`-shaped `reminderSettings` object without `staleHours` (fix each: `src/lib/tasks/overview-data.ts` real caller, plus any other test file constructing this shape).

- [ ] **Step 8: Commit**

```bash
git add src/lib/tasks/overview.ts src/lib/tasks/overview.test.ts
git commit -m "fix(tasks): stop flagging healthy waited-once tasks; add previously_overdue and stale"
```

---

### Task 3: QC-needed (cross-cutting — closed tasks)

**Files:**
- Modify: `src/lib/tasks/overview.ts`
- Modify: `src/lib/tasks/overview-data.ts`
- Modify: `src/lib/tasks/overview.test.ts`

**Interfaces:**
- Consumes: `done_reviewed_at` from Task 1's `OverviewTaskInput` extension.
- Produces: `qc_needed` entries in both `CsOverviewRow.riskFlags` and `OverviewSnapshot.attention`.

`qc_needed` is structurally different from every other flag: it's about **closed** (done/cancel) tasks, which `deriveOpenTask` already returns `null` for and ignores. It needs its own pass over `input.tasks` inside `aggregateOverview`, not a change to `deriveOpenTask`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/tasks/overview.test.ts`:

```typescript
describe("qc_needed", () => {
  it("flags a done task with no done_reviewed_at, regardless of how long ago it closed", () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    const snapshot = aggregateOverview({
      now,
      accounts: [account("cs@x.com")],
      categories: [],
      taskAgents: [],
      assistantEmails: [],
      tasks: [
        task({
          id: "t1",
          status: "done",
          priority: "medium",
          assignee_email: "cs@x.com",
          closed_at: "2026-06-01T00:00:00.000Z", // long ago — must still count
          done_reviewed_at: null,
        }),
      ],
      assigneesByTask: new Map([["t1", ["cs@x.com"]]]),
      rules: [],
      reminderSettings: { todoHours: 24, waitingHours: 24, staleHours: 48 },
      rotationByEmail: new Map(),
    });
    const row = snapshot.csRows.find((r) => r.email === "cs@x.com")!;
    expect(row.riskFlags).toContain("qc_needed");
    const bar = snapshot.attention.find((a) => a.key === "qc_needed")!;
    expect(bar.taskCount).toBe(1);
    expect(bar.affectedCsCount).toBe(1);
  });

  it("does NOT flag a done task that's already been reviewed, and does NOT flag cancel/done tasks a CS didn't touch", () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    const snapshot = aggregateOverview({
      now,
      accounts: [account("cs@x.com")],
      categories: [],
      taskAgents: [],
      assistantEmails: [],
      tasks: [
        task({
          id: "t1",
          status: "done",
          priority: "medium",
          assignee_email: "cs@x.com",
          closed_at: now.toISOString(),
          done_reviewed_at: "2026-07-25T11:00:00.000Z",
        }),
      ],
      assigneesByTask: new Map([["t1", ["cs@x.com"]]]),
      rules: [],
      reminderSettings: { todoHours: 24, waitingHours: 24, staleHours: 48 },
      rotationByEmail: new Map(),
    });
    const row = snapshot.csRows.find((r) => r.email === "cs@x.com")!;
    expect(row.riskFlags).not.toContain("qc_needed");
  });

  it("flags an unreviewed cancel task the same as an unreviewed done task", () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    const snapshot = aggregateOverview({
      now,
      accounts: [account("cs@x.com")],
      categories: [],
      taskAgents: [],
      assistantEmails: [],
      tasks: [
        task({
          id: "t1",
          status: "cancel",
          priority: "medium",
          assignee_email: "cs@x.com",
          closed_at: now.toISOString(),
          done_reviewed_at: null,
        }),
      ],
      assigneesByTask: new Map([["t1", ["cs@x.com"]]]),
      rules: [],
      reminderSettings: { todoHours: 24, waitingHours: 24, staleHours: 48 },
      rotationByEmail: new Map(),
    });
    const row = snapshot.csRows.find((r) => r.email === "cs@x.com")!;
    expect(row.riskFlags).toContain("qc_needed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/tasks/overview.test.ts`
Expected: FAIL — nothing computes `qc_needed` yet.

- [ ] **Step 3: Add the QC-needed pass inside `aggregateOverview`**

In `src/lib/tasks/overview.ts`, inside the main `for (const task of input.tasks)` loop (the one that currently has the `if (task.status !== "done") continue;` pulse block near the end), the control flow is:

```typescript
    const derived = deriveOpenTask(/* ... */);
    if (derived) {
      openDerived.push(derived);
      for (const email of assignees) {
        const accumulator = accumulators.get(email);
        if (accumulator) addOpenTask(accumulator, derived, input.now);
      }
      continue;
    }

    if (task.status !== "done") continue;
    const closedAt = timestamp(task.closed_at);
    if (closedAt === null || closedAt < sevenDaysAgo) continue;
    for (const email of assignees) {
      if (!poolEmails.has(email)) continue;
      const pulse = doneByEmail.get(email) ?? { done24h: 0, done7d: 0 };
      pulse.done7d += 1;
      if (closedAt >= dayAgo) pulse.done24h += 1;
      doneByEmail.set(email, pulse);
    }
  }
```

Insert a QC-needed check **before** the `if (task.status !== "done") continue;` line (so it runs for done AND cancel tasks, independent of the 7-day pulse window):

```typescript
    if (
      (task.status === "done" || task.status === "cancel") &&
      !task.done_reviewed_at
    ) {
      for (const email of assignees) {
        if (!poolEmails.has(email)) continue;
        const ids = qcNeededByEmail.get(email) ?? new Set<string>();
        ids.add(task.id);
        qcNeededByEmail.set(email, ids);
      }
    }

    if (task.status !== "done") continue;
    const closedAt = timestamp(task.closed_at);
    if (closedAt === null || closedAt < sevenDaysAgo) continue;
    // ... (pulse block unchanged)
```

Declare `qcNeededByEmail` alongside the other per-loop accumulator maps near the top of `aggregateOverview` (next to `const doneByEmail = new Map<string, { done24h: number; done7d: number }>();`):

```typescript
  const qcNeededByEmail = new Map<string, Set<string>>();
```

After the loop (where `doneByEmail` currently gets folded into accumulators — the `for (const [email, pulse] of doneByEmail) { ... }` block), add:

```typescript
  for (const [email, ids] of qcNeededByEmail) {
    const accumulator = accumulators.get(email);
    if (accumulator && ids.size > 0) accumulator.riskFlags.add("qc_needed");
  }
```

- [ ] **Step 4: Add the `qc_needed` attention bar**

`buildAttention` only knows about `openDerived` tasks, so it can't produce a `qc_needed` bar itself. In `aggregateOverview`, find where `buildAttention(openDerived, poolEmails)` is called (its result is assigned to the `attention` field of the returned snapshot) and append a manually-built bar:

```typescript
  const qcNeededTaskIds = new Set<string>();
  for (const ids of qcNeededByEmail.values()) for (const id of ids) qcNeededTaskIds.add(id);
  const attention = [
    ...buildAttention(openDerived, poolEmails),
    {
      key: "qc_needed" as const,
      label: ATTENTION_LABELS.qc_needed,
      taskCount: qcNeededTaskIds.size,
      affectedCsCount: qcNeededByEmail.size,
    },
  ];
```

Use this `attention` local in place of the previous inline `buildAttention(...)` call wherever the returned `OverviewSnapshot` object is constructed.

- [ ] **Step 5: Include qc_needed tasks in the `needsAttentionTaskCount` KPI**

Find where `attentionTaskIds` is built (`if (derived.riskFlags.length > 0) attentionTaskIds.add(derived.task.id);`, inside the work-mix loop over `openDerived`) and, after that loop, union in the QC-needed ids:

```typescript
  for (const id of qcNeededTaskIds) attentionTaskIds.add(id);
```

(Place this right before `needsAttentionTaskCount: attentionTaskIds.size` is read into the `kpis` object.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/tasks/overview.test.ts`
Expected: PASS (all tests)

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/lib/tasks/overview.ts src/lib/tasks/overview.test.ts
git commit -m "feat(tasks): surface QC-needed (done/cancel awaiting review) in Attention areas"
```

---

### Task 4: Data layer — fetch what's needed for `qc_needed` and `stale`

**Files:**
- Modify: `src/lib/tasks/overview-data.ts`

**Interfaces:**
- Consumes: nothing new structurally — extends existing queries.
- Produces: `done_reviewed_at` on fetched task rows; cancel-status + all-time-unreviewed done/cancel tasks included in `input.tasks`; `staleHours` passed into `reminderSettings`.

- [ ] **Step 1: Add `done_reviewed_at` to the column list**

Find:

```typescript
const OVERVIEW_TASK_COLUMNS =
  "id,title,status,priority,category_id,agent_email,assignee_email,todo_started_at,in_progress_at,waiting_started_at,last_activity_at,sla_minutes,overdue_count,in_progress_seconds,waiting_seconds,closed_at,created_at,updated_at,archived_at";
```

Add `done_reviewed_at` before `closed_at`:

```typescript
const OVERVIEW_TASK_COLUMNS =
  "id,title,status,priority,category_id,agent_email,assignee_email,todo_started_at,in_progress_at,waiting_started_at,last_activity_at,sla_minutes,overdue_count,in_progress_seconds,waiting_seconds,done_reviewed_at,closed_at,created_at,updated_at,archived_at";
```

- [ ] **Step 2: Broaden the "done" fetch to include cancel + all unreviewed, not just recent done**

Find:

```typescript
      supabase
        .from("tasks")
        .select(OVERVIEW_TASK_COLUMNS)
        .is("archived_at", null)
        .eq("status", "done")
        .gte("closed_at", recentDoneSince),
```

Replace with:

```typescript
      supabase
        .from("tasks")
        .select(OVERVIEW_TASK_COLUMNS)
        .is("archived_at", null)
        .in("status", ["done", "cancel"])
        .or(`closed_at.gte.${recentDoneSince},done_reviewed_at.is.null`),
```

(This keeps the recent-done-tasks-for-the-pulse-metric behavior intact — `aggregateOverview`'s pulse loop already independently re-checks `closedAt < sevenDaysAgo` and `task.status !== "done"`, so cancel tasks and old-but-unreviewed done tasks pulled in by this broader fetch correctly fall through the pulse logic untouched and only feed the new QC-needed pass from Task 3.)

- [ ] **Step 3: Pass `staleHours` into `reminderSettings`**

Find where `reminderSettings` is built for the `aggregateOverview(...)` call (likely `const reminderSettings = resolveReminderSettings(reminderResult.data);` followed by passing `reminderSettings` object, or constructing an inline `{ todoHours, waitingHours }` object — check which). `resolveReminderSettings` (from `src/lib/tasks/reminder-settings.ts`) already returns a `staleHours` field on its result (confirmed: `ReminderSettings` type includes `staleHours: number`), so if `reminderSettings` is passed through directly, no change may be needed — but if this file destructures only `{ todoHours, waitingHours }` into a smaller object before calling `aggregateOverview`, extend it to include `staleHours` too. Verify with `npx tsc --noEmit` after Task 2/3's type change — a missing field here will surface as a type error at this exact call site.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/overview-data.ts
git commit -m "feat(tasks): fetch done_reviewed_at and cancel tasks for QC-needed attention"
```

---

### Task 5: UI — update help text and colors, verify rendering

**Files:**
- Modify: `src/app/(authed)/tasks/_components/CSWorkloadOverview.tsx`

**Interfaces:**
- Consumes: the new `OverviewRiskFlag` set from Task 1. No new components — `RISK_HELP`/`RISK_COLOR` are existing lookup tables already rendered via a tooltip (`title`/`aria-label` on a "!" badge next to each bar) and a colored bar, per the existing `AttentionChart` component. This task only updates their entries.

- [ ] **Step 1: Update `RISK_HELP`**

Find:

```typescript
const RISK_HELP: Record<OverviewRiskFlag, string> = {
  overdue: "In Progress task is past its SLA budget.",
  todo_stuck: "Todo task has waited past the Todo reminder threshold.",
  waiting_stuck: "Waiting task has waited past the Waiting reminder threshold.",
  unknown_effort: "In Progress task has no active SLA timer, so effort is unknown.",
};
```

Replace with:

```typescript
const RISK_HELP: Record<OverviewRiskFlag, string> = {
  overdue: "In Progress task is past its SLA budget right now.",
  previously_overdue: "In Progress task went overdue at least once before — not currently breaching, but worth a check.",
  todo_stuck: "Todo task has waited past the Todo reminder threshold without being started.",
  waiting_stuck: "Waiting task has waited past the Waiting reminder threshold.",
  stale: "Task has had no activity (comments, updates) for longer than the stale threshold.",
  qc_needed: "Done or Cancel task is still waiting for QC review.",
};
```

- [ ] **Step 2: Update `RISK_COLOR`**

Find:

```typescript
const RISK_COLOR: Record<OverviewRiskFlag, string> = {
  overdue: "#dc2626",
  todo_stuck: "#ea580c",
  waiting_stuck: "#d97706",
  unknown_effort: "#7c3aed",
};
```

Replace with:

```typescript
const RISK_COLOR: Record<OverviewRiskFlag, string> = {
  overdue: "#dc2626",
  previously_overdue: "#f97316",
  todo_stuck: "#ea580c",
  waiting_stuck: "#d97706",
  stale: "#6b7280",
  qc_needed: "#7c3aed",
};
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint "src/app/(authed)/tasks/_components/CSWorkloadOverview.tsx"`
Expected: no errors (a missing key in either `Record<OverviewRiskFlag, string>` would be a type error, confirming nothing was missed)

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open Task Overview, confirm:
- Attention areas shows 6 bars with the new labels, hovering the "!" badge shows the new explanation text.
- A task that only ever used Waiting once (find or create one) does not appear under any Attention bar and does not count toward "Needs attention" KPI.
- A Done task with no QC yet shows under "QC needed".

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authed)/tasks/_components/CSWorkloadOverview.tsx"
git commit -m "feat(tasks): update Attention area labels/colors for the redesigned risk flags"
```

---

## Self-Review Notes

- **Spec coverage:** false-positive fix (healthy waited-once task) ✓, "Overdue in progress" kept exactly as the user's own example ✓, clear category + explanation shown in UI for all 6 ✓, Stale reusing the existing cron definition (not a new concept) ✓, QC-needed added per the user's "cứ nghĩ đi" latitude ✓.
- **Placeholder scan:** Task 4 Step 3 is conditionally worded ("if... check which") because this plan's author confirmed `resolveReminderSettings` already returns `staleHours` but did not have the exact current call-site destructuring pattern in `overview-data.ts` memorized with full certainty at time of writing — flagged explicitly with a concrete fallback (add the field) rather than glossed over.
- **Type consistency:** `OverviewRiskFlag`'s 6 values are used identically across `ATTENTION_LABELS`, `RISK_HELP`, `RISK_COLOR`, and every test — a missing entry in any `Record<OverviewRiskFlag, ...>` fails `tsc`, so Task 5 Step 3's typecheck is a real completeness gate, not just a formality.
- **Known follow-up, not blocking:** `qc_needed`'s `taskCount` in the attention bar counts tasks, but a task could theoretically be assigned to multiple CS (junction table) — `qcNeededTaskIds` (a `Set`) already dedupes correctly for the bar's total, and `qcNeededByEmail`'s per-CS sets independently and correctly attribute to every assignee. No double-counting bug here, but worth a second look if multi-assignee Done tasks turn out to be common in practice.
