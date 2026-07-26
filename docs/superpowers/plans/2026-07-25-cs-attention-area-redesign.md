# CS Attention Area Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a real false-positive bug in the CS Task Overview's "Attention areas" (`src/lib/tasks/overview.ts`) and give every category a clear, explained meaning. Only tasks that genuinely need a human to look at them should appear here — healthy tasks must never show up.

**The bug:** `unknown_effort` ("Unknown effort") fires for *any* In Progress task whose SLA clock isn't actively counting (`!isSlaActiveInProgress`). That happens whenever a task has *ever* gone through Waiting even once — completely normal workflow — so a perfectly healthy task that briefly waited on a customer document, then resumed, is flagged forever after and inflates the "Needs attention" KPI. It conflates "we can't display a reliable SLA number" (a computation limitation) with "this needs attention" (a business signal).

**The fix, plus 4 additions:** Replace `unknown_effort` with `previously_overdue` (a real signal: this task broke SLA at least once, even if not breaching right now). A task that only ever used Waiting normally now gets **zero** flags. Add four categories that are today completely invisible in Attention despite already being tracked (or half-tracked) elsewhere in the product, so nothing new is invented from scratch:

- `stale` — no activity in a long time. Reuses the exact `isStale()` the stale-reminder cron already uses.
- `due_soon` — approaching its SLA deadline, not yet breached. Reuses the exact `isDueSoon()` the due-soon notification already uses. An early warning that doesn't exist anywhere in Overview today.
- `qc_needed` — Done/Cancel tasks awaiting QC review. A core CS workflow concept currently absent from Overview entirely.
- `unassigned_urgent` — urgent/high-priority tasks sitting in Backlog with nobody assigned. This **already exists** as a notification concept (`backlog_attention`, sent at task-creation time in `src/app/api/tasks/route.ts`) but is invisible in the Overview dashboard where an admin would actually look for it — only a generic, priority-blind "Unassigned" count exists today.

Considered and explicitly rejected: a "reopened recently" category (too short-lived/low-value to justify its own bar) and a "stuck despite activity" category (no existing threshold to ground it in — same mistake class as the `unknown_effort` bug this plan fixes).

**Architecture:** No new tables. `previously_overdue`/`stale`/`due_soon` slot into the existing per-open-task flag derivation (`deriveOpenTask`, pure). `qc_needed` and `unassigned_urgent` are a different shape — they're about tasks `deriveOpenTask` never sees at all (closed tasks; backlog tasks) — both computed as their own small passes inside `aggregateOverview` over the same `input.tasks` array it already iterates. The UI change is small: `RISK_HELP`/`RISK_COLOR`/`ATTENTION_LABELS` are already-existing lookup tables keyed by flag — this plan only updates their entries, no new components.

**Tech Stack:** Vitest for the pure `overview.ts` layer (TDD, matches the existing `overview.test.ts` conventions already in this file).

**Note on concurrent work:** This file (`overview.ts`/`overview-data.ts`) has recently gained fair-assignment-queue fields (`queueDueAt`, `queueEnabled`, etc. — a separate, already-shipped feature). This plan does not touch any of that; it only touches the Attention/risk-flag machinery, which the queue feature never modified. If line numbers below don't match exactly when you start, re-grep the function names given — don't assume this plan's line numbers are authoritative over the real file.

## Global Constraints

- Every category must correspond to a genuinely at-risk task — never a healthy one. If unsure whether a change introduces a false positive, don't ship it without a test proving the healthy case stays flag-free.
- Reuse existing definitions, don't invent parallel ones:
  - `stale` uses the exact same threshold/condition as `isStale()` in `src/lib/tasks/reminders.ts:29`.
  - `due_soon` uses the exact same condition as `isDueSoon()` in `src/lib/tasks/reminders.ts:14`.
  - `unassigned_urgent` uses the exact same condition (`priority in (urgent, high)` + no assignee + backlog) as the existing `backlogNeedsAttention` check in `src/app/api/tasks/route.ts:240`.
- `qc_needed` covers both **Done** and **Cancel** tasks awaiting review (QC applies to both — cancel needs QC same as done, per existing notification types `qc_needed`/`qc_stale`).
- Final flag set (8, in the order they should render, most urgent first): `overdue`, `due_soon`, `previously_overdue`, `unassigned_urgent`, `todo_stuck`, `waiting_stuck`, `stale`, `qc_needed`.

---

### Task 1: Update risk-flag types and reminder-settings shape

**Files:**
- Modify: `src/lib/tasks/overview-types.ts`

**Interfaces:**
- Produces: the final 8-value `OverviewRiskFlag` union — every later task depends on this exact set and order.

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
  "due_soon",
  "previously_overdue",
  "unassigned_urgent",
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
git commit -m "feat(tasks): redefine attention risk flags (8 categories, drop unknown_effort)"
```

---

### Task 2: Fix the per-open-task flag derivation — TDD

**Files:**
- Modify: `src/lib/tasks/overview.ts`
- Modify: `src/lib/tasks/overview.test.ts`

**Interfaces:**
- Consumes: `OVERVIEW_RISK_FLAGS` from Task 1; `isStale`, `isDueSoon` from `@/lib/tasks/reminders` (both already exist and are already used by the cron/notification system — do not reimplement their logic).
- Produces: `deriveOpenTask`'s corrected `riskFlags` output, now covering `overdue` (unchanged), `due_soon` (new), `previously_overdue` (new, replaces the buggy half of `unknown_effort`), `todo_stuck`/`waiting_stuck` (unchanged), `stale` (new). `unassigned_urgent`/`qc_needed` are NOT part of this task — see Task 3.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/tasks/overview.test.ts` (this file already has `account`/`task` helpers and an `aggregateOverview`-calling pattern from earlier tests — match their exact shape rather than redefining):

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
          waiting_started_at: "2026-07-20T00:00:00.000Z",
          waiting_seconds: 3600,
          overdue_count: 0,
        }),
      ],
      assigneesByTask: new Map([["t1", ["cs@x.com"]]]),
      rules: [],
      reminderSettings: { todoHours: 24, waitingHours: 24, staleHours: 48, dueSoonMinutes: 15 },
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
          overdue_count: 1,
        }),
      ],
      assigneesByTask: new Map([["t1", ["cs@x.com"]]]),
      rules: [],
      reminderSettings: { todoHours: 24, waitingHours: 24, staleHours: 48, dueSoonMinutes: 15 },
      rotationByEmail: new Map(),
    });
    const row = snapshot.csRows.find((r) => r.email === "cs@x.com")!;
    expect(row.riskFlags).toContain("previously_overdue");
    expect(row.riskFlags).not.toContain("overdue");
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
      reminderSettings: { todoHours: 999, waitingHours: 999, staleHours: 48, dueSoonMinutes: 15 },
      rotationByEmail: new Map(),
    });
    const row = snapshot.csRows.find((r) => r.email === "cs@x.com")!;
    expect(row.riskFlags).toContain("stale");
  });

  it("flags due_soon for an active in-progress task close to its SLA deadline but not yet over it", () => {
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
          priority: "urgent", // urgent SLA is short (60 min default) — easy to get "close to deadline"
          assignee_email: "cs@x.com",
          in_progress_at: new Date(now.getTime() - 50 * 60_000).toISOString(), // 50 min ago, 60 min SLA -> 10 min left
          overdue_count: 0,
        }),
      ],
      assigneesByTask: new Map([["t1", ["cs@x.com"]]]),
      rules: [],
      reminderSettings: { todoHours: 24, waitingHours: 24, staleHours: 48, dueSoonMinutes: 15 },
      rotationByEmail: new Map(),
    });
    const row = snapshot.csRows.find((r) => r.email === "cs@x.com")!;
    expect(row.riskFlags).toContain("due_soon");
    expect(row.riskFlags).not.toContain("overdue");
  });
});
```

Check the existing `account(...)`/`task(...)` test helpers already defined at the top of `overview.test.ts` for their exact field defaults before reusing them here.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/tasks/overview.test.ts`
Expected: FAIL — none of the 4 new flags exist yet; the healthy-Waiting-task test currently fails because `unknown_effort` still fires.

- [ ] **Step 3: Extend `OverviewInput.reminderSettings`**

Find:

```typescript
  reminderSettings: { todoHours: number; waitingHours: number };
```

Replace with:

```typescript
  reminderSettings: {
    todoHours: number;
    waitingHours: number;
    staleHours: number;
    dueSoonMinutes: number;
  };
```

- [ ] **Step 4: Fix `deriveOpenTask`**

Add the import at the top of `src/lib/tasks/overview.ts`:

```typescript
import { isStale, isDueSoon } from "./reminders";
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
    if (isTaskOverdue(task, rules, now)) {
      addFlag(flags, "overdue");
    } else if (isDueSoon(task, rules, reminderSettings.dueSoonMinutes, now)) {
      addFlag(flags, "due_soon");
    }
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

(`unknownEffort`/`OverviewTaskSummary.unknownEffort` stay as-is — that field is a separate "can't compute a load number" display concern, distinct from whether it's attention-worthy. Only flag-adding changed.)

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
  due_soon: "Due soon",
  previously_overdue: "Previously overdue",
  unassigned_urgent: "Unassigned (urgent/high)",
  todo_stuck: "Todo stuck",
  waiting_stuck: "Waiting stuck",
  stale: "Stale (no activity)",
  qc_needed: "QC needed",
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/tasks/overview.test.ts`
Expected: PASS (all tests). `qc_needed`/`unassigned_urgent` aren't wired up yet (Task 3) — no test above exercises them, so this compiles fine even though they can't fire yet.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors — surfaces every call site constructing an `OverviewInput`-shaped `reminderSettings` without `staleHours`/`dueSoonMinutes` (Task 4 fixes the real caller in `overview-data.ts`; fix any other test file constructing this shape).

- [ ] **Step 8: Commit**

```bash
git add src/lib/tasks/overview.ts src/lib/tasks/overview.test.ts
git commit -m "fix(tasks): stop flagging healthy waited-once tasks; add previously_overdue/stale/due_soon"
```

---

### Task 3: Cross-cutting flags — `qc_needed` and `unassigned_urgent` — TDD

**Files:**
- Modify: `src/lib/tasks/overview.ts`
- Modify: `src/lib/tasks/overview.test.ts`

**Interfaces:**
- Consumes: `done_reviewed_at` from Task 1's `OverviewTaskInput` extension.
- Produces: `qc_needed` entries in `CsOverviewRow.riskFlags` + its own `OverviewAttentionBar`; `unassigned_urgent` as its own `OverviewAttentionBar` (no per-CS attribution possible — these tasks have no assignee by definition).

Both flags cover populations `deriveOpenTask` never sees: `qc_needed` is about **closed** (done/cancel) tasks; `unassigned_urgent` is about **backlog** tasks with no assignee. Both need their own small pass inside `aggregateOverview`, reading the same `input.tasks` loop it already iterates.

- [ ] **Step 1: Write the failing tests**

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
          closed_at: "2026-06-01T00:00:00.000Z",
          done_reviewed_at: null,
        }),
      ],
      assigneesByTask: new Map([["t1", ["cs@x.com"]]]),
      rules: [],
      reminderSettings: { todoHours: 24, waitingHours: 24, staleHours: 48, dueSoonMinutes: 15 },
      rotationByEmail: new Map(),
    });
    const row = snapshot.csRows.find((r) => r.email === "cs@x.com")!;
    expect(row.riskFlags).toContain("qc_needed");
    const bar = snapshot.attention.find((a) => a.key === "qc_needed")!;
    expect(bar.taskCount).toBe(1);
    expect(bar.affectedCsCount).toBe(1);
  });

  it("does NOT flag a done task that's already been reviewed", () => {
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
      reminderSettings: { todoHours: 24, waitingHours: 24, staleHours: 48, dueSoonMinutes: 15 },
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
      reminderSettings: { todoHours: 24, waitingHours: 24, staleHours: 48, dueSoonMinutes: 15 },
      rotationByEmail: new Map(),
    });
    const row = snapshot.csRows.find((r) => r.email === "cs@x.com")!;
    expect(row.riskFlags).toContain("qc_needed");
  });
});

describe("unassigned_urgent", () => {
  it("flags an unassigned backlog task with urgent priority", () => {
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
          status: "backlog",
          priority: "urgent",
          assignee_email: null,
        }),
      ],
      assigneesByTask: new Map(),
      rules: [],
      reminderSettings: { todoHours: 24, waitingHours: 24, staleHours: 48, dueSoonMinutes: 15 },
      rotationByEmail: new Map(),
    });
    const bar = snapshot.attention.find((a) => a.key === "unassigned_urgent")!;
    expect(bar.taskCount).toBe(1);
  });

  it("does NOT flag an unassigned backlog task with medium/low priority", () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    const snapshot = aggregateOverview({
      now,
      accounts: [account("cs@x.com")],
      categories: [],
      taskAgents: [],
      assistantEmails: [],
      tasks: [
        task({ id: "t1", status: "backlog", priority: "medium", assignee_email: null }),
      ],
      assigneesByTask: new Map(),
      rules: [],
      reminderSettings: { todoHours: 24, waitingHours: 24, staleHours: 48, dueSoonMinutes: 15 },
      rotationByEmail: new Map(),
    });
    const bar = snapshot.attention.find((a) => a.key === "unassigned_urgent")!;
    expect(bar.taskCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/tasks/overview.test.ts`
Expected: FAIL — neither flag is computed yet.

- [ ] **Step 3: Add the QC-needed pass inside `aggregateOverview`**

In `src/lib/tasks/overview.ts`, inside the main `for (const task of input.tasks)` loop, current control flow (abbreviated):

```typescript
    const derived = deriveOpenTask(/* ... */);
    if (derived) {
      openDerived.push(derived);
      /* ... addOpenTask ... */
      continue;
    }

    if (task.status !== "done") continue;
    const closedAt = timestamp(task.closed_at);
    if (closedAt === null || closedAt < sevenDaysAgo) continue;
    /* ... pulse block ... */
  }
```

Insert a QC-needed check **before** the `if (task.status !== "done") continue;` line (so it runs for done AND cancel, independent of the 7-day pulse window):

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
    /* ... pulse block unchanged ... */
```

Declare `qcNeededByEmail` alongside the other per-loop accumulator maps near the top of `aggregateOverview` (next to `const doneByEmail = new Map<string, { done24h: number; done7d: number }>();`):

```typescript
  const qcNeededByEmail = new Map<string, Set<string>>();
```

After the loop (where `doneByEmail` currently gets folded into accumulators), add:

```typescript
  for (const [email, ids] of qcNeededByEmail) {
    const accumulator = accumulators.get(email);
    if (accumulator && ids.size > 0) accumulator.riskFlags.add("qc_needed");
  }
```

- [ ] **Step 4: Add the unassigned_urgent pass**

Find the existing backlog-handling branch (near the start of the same loop):

```typescript
    if (task.status === "backlog" && assignees.length === 0) {
      const category = task.category_id ? categoryById.get(task.category_id) ?? null : null;
      unassigned.push({
        id: task.id,
        title: task.title,
        agentEmail: task.agent_email,
        categoryId: task.category_id,
        categoryName: category?.name ?? null,
        categoryColor: category?.color ?? null,
        priority: task.priority,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        ageSeconds: ageSeconds(task.created_at, input.now) ?? 0,
        effectiveSlaMinutes: effectiveSlaMinutes(task, input.rules),
      });
      continue;
    }
```

Add the urgency check right after the `unassigned.push(...)` call, still inside the same `if` block, before `continue`:

```typescript
      if (task.priority === "urgent" || task.priority === "high") {
        unassignedUrgentTaskIds.add(task.id);
      }
      continue;
```

Declare `unassignedUrgentTaskIds` alongside `qcNeededByEmail`:

```typescript
  const unassignedUrgentTaskIds = new Set<string>();
```

- [ ] **Step 5: Build the two new attention bars**

Find where `buildAttention(openDerived, poolEmails)` is called and its result is assigned to the snapshot's `attention` field. Replace that assignment with:

```typescript
  const qcNeededTaskIds = new Set<string>();
  for (const ids of qcNeededByEmail.values()) for (const id of ids) qcNeededTaskIds.add(id);

  const attention = [
    ...buildAttention(openDerived, poolEmails),
    {
      key: "unassigned_urgent" as const,
      label: ATTENTION_LABELS.unassigned_urgent,
      taskCount: unassignedUrgentTaskIds.size,
      affectedCsCount: 0, // unassigned by definition — no CS to attribute to
    },
    {
      key: "qc_needed" as const,
      label: ATTENTION_LABELS.qc_needed,
      taskCount: qcNeededTaskIds.size,
      affectedCsCount: qcNeededByEmail.size,
    },
  ];
```

Use this `attention` local wherever the returned `OverviewSnapshot` object is constructed.

- [ ] **Step 6: Include both in the `needsAttentionTaskCount` KPI**

Find where `attentionTaskIds` is built (`if (derived.riskFlags.length > 0) attentionTaskIds.add(derived.task.id);`) and, after that loop, union in both new sets before `needsAttentionTaskCount: attentionTaskIds.size` is read:

```typescript
  for (const id of qcNeededTaskIds) attentionTaskIds.add(id);
  for (const id of unassignedUrgentTaskIds) attentionTaskIds.add(id);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/lib/tasks/overview.test.ts`
Expected: PASS (all tests)

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add src/lib/tasks/overview.ts src/lib/tasks/overview.test.ts
git commit -m "feat(tasks): surface QC-needed and unassigned-urgent in Attention areas"
```

---

### Task 4: Data layer — fetch what the new flags need

**Files:**
- Modify: `src/lib/tasks/overview-data.ts`

**Interfaces:**
- Consumes: nothing new structurally — extends existing queries.
- Produces: `done_reviewed_at` on fetched task rows; cancel-status + all-time-unreviewed done/cancel tasks included in `input.tasks`; `staleHours`/`dueSoonMinutes` passed into `reminderSettings`.

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

(The pulse-metric loop in `aggregateOverview` already independently re-checks `closedAt < sevenDaysAgo` and `task.status !== "done"`, so cancel tasks and old-but-unreviewed done tasks pulled in by this broader fetch correctly fall through the pulse logic untouched and only feed the new QC-needed pass from Task 3.)

- [ ] **Step 3: Pass `staleHours`/`dueSoonMinutes` into `reminderSettings`**

Find where `reminderSettings` is built for the `aggregateOverview(...)` call. `resolveReminderSettings` (from `src/lib/tasks/reminder-settings.ts`) already returns both `staleHours` and `dueSoonMinutes` on its result — if `reminderSettings` is passed through directly (not destructured into a smaller inline object), no change is needed here. Verify with `npx tsc --noEmit` after Task 2/3's type changes — a missing field will surface as a type error at this exact call site if the file constructs a narrower object instead of passing the resolved settings through as-is.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/overview-data.ts
git commit -m "feat(tasks): fetch what qc_needed/due_soon/stale need"
```

---

### Task 5: UI — update help text and colors

**Files:**
- Modify: `src/app/(authed)/tasks/_components/CSWorkloadOverview.tsx`

**Interfaces:**
- Consumes: the new 8-value `OverviewRiskFlag` set. No new components — `RISK_HELP`/`RISK_COLOR` are existing lookup tables already rendered via a tooltip (`title`/`aria-label` on a "!" badge next to each bar) and a colored bar in the existing `AttentionChart` component. This task only updates their entries.

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
  due_soon: "In Progress task is approaching its SLA deadline — not overdue yet.",
  previously_overdue: "In Progress task went overdue at least once before — not currently breaching, but worth a check.",
  unassigned_urgent: "Urgent or High priority task sitting in Backlog with nobody assigned.",
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
  due_soon: "#f59e0b",
  previously_overdue: "#f97316",
  unassigned_urgent: "#be123c",
  todo_stuck: "#ea580c",
  waiting_stuck: "#d97706",
  stale: "#6b7280",
  qc_needed: "#7c3aed",
};
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint "src/app/(authed)/tasks/_components/CSWorkloadOverview.tsx"`
Expected: no errors (a missing key in either `Record<OverviewRiskFlag, string>` is a type error, confirming nothing was missed)

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open Task Overview, confirm:
- Attention areas shows 8 bars with the new labels; hovering the "!" badge shows the new explanation text.
- A task that only ever used Waiting once does not appear under any bar and does not count toward "Needs attention".
- A Done task with no QC yet shows under "QC needed".
- An unassigned urgent/high Backlog task shows under "Unassigned (urgent/high)".
- An In Progress task close to its SLA deadline (but not past it) shows under "Due soon", not "Overdue".

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authed)/tasks/_components/CSWorkloadOverview.tsx"
git commit -m "feat(tasks): update Attention area labels/colors for all 8 risk flags"
```

---

## Self-Review Notes

- **Spec coverage:** false-positive fix ✓, "Overdue in progress" kept exactly as given ✓, clear category + explanation for all 8 ✓, `stale`/`due_soon`/`unassigned_urgent` each reuse an existing, already-shipped definition rather than inventing a new threshold ✓, `qc_needed` added per earlier agreement ✓, "recently reopened" and "stuck despite activity" explicitly considered and dropped (documented in the Goal section, not silently omitted) ✓.
- **Placeholder scan:** Task 4 Step 3 is conditionally worded because this plan's author confirmed `resolveReminderSettings` already returns both needed fields but did not have the exact current call-site destructuring pattern in `overview-data.ts` memorized with full certainty — flagged explicitly with a concrete fallback, not glossed over.
- **Type consistency:** `OverviewRiskFlag`'s 8 values are used identically across `ATTENTION_LABELS`, `RISK_HELP`, `RISK_COLOR`, and every test — a missing entry in any `Record<OverviewRiskFlag, ...>` fails `tsc`, making Task 5 Step 3's typecheck a real completeness gate.
- **Known follow-up, not blocking:** `unassigned_urgent`'s `affectedCsCount: 0` is a deliberate, documented choice (no CS is assigned, so none can be "affected" in the same sense as the other 7 bars) — not a bug, but worth a glance if this field's meaning ever gets generalized elsewhere in the UI.
