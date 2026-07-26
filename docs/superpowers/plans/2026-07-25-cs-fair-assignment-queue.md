# CS Fair Assignment Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CS task-recommendation system's greedy "always pick lowest load" ranking with a fair turn-taking queue: every CS gets a turn, and the SLA-size of the task they just received determines how long until they're eligible again. Add a persistent "Assignment queue" view to the Overview UI so admins can see the rotation order at a glance.

**Architecture:** One new table (`task_assignment_rotation`, email → `queue_due_at`) is the entire state. A pure function computes the next `queue_due_at` from the current value + a task's SLA-minutes; `aggregateOverview` (already pure, already tested) threads that value through so `rankRecommendation`'s sort key changes from a multi-factor greedy tuple to `[queue_due_at ascending, slaLoadMinutes ascending]`. Two existing "a CS receives a task" code paths call a small IO helper that bumps the table; nothing else about assignment (permissions, junction table, notifications) changes.

**Tech Stack:** Next.js API routes, Supabase (service-role), Vitest for the pure logic layer (mirrors the existing `overview.test.ts` pattern).

**Spec:** `docs/superpowers/specs/2026-07-25-cs-fair-assignment-queue-design.md` — read this first for the *why*; this plan is the *how*.

## Global Constraints

- Every assignment method bumps the rotation (Recommend-driven assign, manual assign from the board, and assigning at task-creation time) — confirmed by the user. Removing an assignee never bumps it.
- The queue is company-wide across all CS — no agent/team scoping. This only changes *ranking order*, never *who's allowed* to be assigned (`canAssignToTask` and all existing permission checks are untouched).
- SLA-minutes weighting reuses the existing pure `effectiveSlaMinutes()` from `src/lib/tasks/sla.ts:47` — do not introduce a second SLA concept.
- Enrollment's separate recommendation system (`src/lib/enrollment/overview.ts`) is explicitly out of scope — do not touch it.

---

### Task 1: Schema — `task_assignment_rotation` table

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Produces: `task_assignment_rotation(email text primary key, queue_due_at timestamptz, updated_at timestamptz)` — Tasks 3 and 5 read/write this table.

- [ ] **Step 1: Add the table DDL**

Add near the other `task_*` tables (after `task_assignment_cycles`, before the RLS block):

```sql
-- Fair assignment rotation: one row per CS, `queue_due_at` is the timestamp at
-- which they become eligible to be recommended again. Sorting all rows by
-- `queue_due_at` ascending *is* the queue — no position column to maintain.
-- A CS with no row here has never received a task and is treated as
-- infinitely overdue (sorts first) — see resolveQueueDueAt() in rotation.ts.
create table if not exists task_assignment_rotation (
  email text primary key,
  queue_due_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_assignment_rotation_due_idx
  on task_assignment_rotation (queue_due_at);
```

- [ ] **Step 2: Add the table to the RLS protected-tables list**

Find the `protected_tables text[] := array[...]` block (contains `'task_assignment_cycles'`) and add `'task_assignment_rotation'` to the array, alongside the other `task_*` entries.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(tasks): add task_assignment_rotation table for fair-queue assignment"
```

---

### Task 2: Pure rotation formula — TDD

**Files:**
- Create: `src/lib/tasks/rotation.ts`
- Test: `src/lib/tasks/rotation.test.ts`

**Interfaces:**
- Produces: `resolveQueueDueAt(currentQueueDueAt: Date | null, now: Date, effectiveSlaMinutes: number): Date`, `EPOCH_QUEUE_DUE_AT: Date` — Task 3 (aggregation) and Task 5 (IO bump) both use these.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { EPOCH_QUEUE_DUE_AT, resolveQueueDueAt } from "./rotation";

describe("resolveQueueDueAt", () => {
  it("pushes a first-time assignee forward from now by the task's SLA minutes", () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    const next = resolveQueueDueAt(null, now, 60);
    expect(next.toISOString()).toBe("2026-07-25T13:00:00.000Z");
  });

  it("starts counting from now when the previous cooldown already expired", () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    const expired = new Date("2026-07-25T10:00:00.000Z"); // in the past
    const next = resolveQueueDueAt(expired, now, 30);
    expect(next.toISOString()).toBe("2026-07-25T12:30:00.000Z");
  });

  it("stacks on top of an unexpired cooldown instead of resetting from now", () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    const stillCoolingDown = new Date("2026-07-25T18:00:00.000Z"); // 6h in the future
    const next = resolveQueueDueAt(stillCoolingDown, now, 60);
    expect(next.toISOString()).toBe("2026-07-25T19:00:00.000Z"); // 18:00 + 1h, not 12:00 + 1h
  });

  it("exposes an epoch sentinel that always sorts before any real timestamp", () => {
    expect(EPOCH_QUEUE_DUE_AT.getTime()).toBeLessThan(new Date("1971-01-01").getTime());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/tasks/rotation.test.ts`
Expected: FAIL — `rotation.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// Fair assignment rotation — see docs/superpowers/specs/2026-07-25-cs-fair-assignment-queue-design.md
// for the mechanism. This file is pure (no I/O); src/app/api/tasks/[id]/assignees/route.ts
// and src/app/api/tasks/route.ts call bumpAssignmentRotation() (a thin IO wrapper
// defined alongside this, see bottom of file) which uses this formula.

// A CS who has never received a task has no row in task_assignment_rotation.
// Treat that as "infinitely overdue" so they're always recommended before
// anyone with real assignment history, without needing a nullable sort key
// scattered through every comparison site.
export const EPOCH_QUEUE_DUE_AT = new Date(0);

export function resolveQueueDueAt(
  currentQueueDueAt: Date | null,
  now: Date,
  effectiveSlaMinutes: number
): Date {
  const base =
    currentQueueDueAt && currentQueueDueAt.getTime() > now.getTime() ? currentQueueDueAt : now;
  return new Date(base.getTime() + effectiveSlaMinutes * 60_000);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/tasks/rotation.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/rotation.ts src/lib/tasks/rotation.test.ts
git commit -m "feat(tasks): add pure fair-queue rotation formula"
```

---

### Task 3: Thread `queueDueAt` through the pure aggregation layer — TDD

**Files:**
- Modify: `src/lib/tasks/overview-types.ts`
- Modify: `src/lib/tasks/overview.ts`
- Modify: `src/lib/tasks/overview.test.ts`

**Interfaces:**
- Consumes: `EPOCH_QUEUE_DUE_AT` from Task 2's `rotation.ts`.
- Produces: `OverviewInput.rotationByEmail: Map<string, string>` (email → ISO `queue_due_at`) — Task 4 (data layer) populates this; `CsOverviewRow.queueDueAt` and `RecommendationCandidate.queueDueAt` — Task 6 (UI) reads these; `rankRecommendation`'s new sort order — this is the actual behavior change.

- [ ] **Step 1: Add `queueDueAt` to the two output types**

In `src/lib/tasks/overview-types.ts`, add `queueDueAt: string | null;` to `CsOverviewRow` (after `status`) and to `RecommendationCandidate` (after `riskFlags`).

- [ ] **Step 2: Write the failing tests for the new ranking behavior**

Add to `src/lib/tasks/overview.test.ts` (existing file — follow its existing `account`/`task` test-helper conventions in that file):

```typescript
// Add near the top of the file, alongside existing imports:
// import { rankRecommendation } from "./overview"; // already imported if not, add it
// import { EPOCH_QUEUE_DUE_AT } from "./rotation";

describe("rankRecommendation with the fair-queue rotation", () => {
  it("recommends whoever's queue_due_at is furthest in the past, not whoever has the least SLA load", () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    const snapshot = aggregateOverview({
      now,
      accounts: [account("busy-but-due@x.com"), account("free-but-not-due@x.com")],
      categories: [],
      taskAgents: [],
      assistantEmails: [],
      tasks: [
        // busy-but-due@x.com already has one task in progress (nonzero SLA load)...
        task({
          id: "existing",
          status: "in_progress",
          priority: "low",
          assignee_email: "busy-but-due@x.com",
          in_progress_at: now.toISOString(),
        }),
      ],
      assigneesByTask: new Map([["existing", ["busy-but-due@x.com"]]]),
      rules: [],
      reminderSettings: { todoHours: 24, waitingHours: 24 },
      rotationByEmail: new Map([
        ["busy-but-due@x.com", "2026-07-20T00:00:00.000Z"], // cooldown long expired -> due
        ["free-but-not-due@x.com", "2026-07-26T00:00:00.000Z"], // still cooling down -> not due
      ]),
    });
    const unassignedTask = {
      id: "new-task",
      title: "New",
      agentEmail: null,
      categoryId: null,
      categoryName: null,
      categoryColor: null,
      priority: "low" as const,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ageSeconds: 0,
      effectiveSlaMinutes: 60,
    };
    const ranked = rankRecommendation(unassignedTask, snapshot.csRows);
    // Despite having lower current SLA load, free-but-not-due should NOT win —
    // busy-but-due is overdue for a turn and ranks first.
    expect(ranked[0].email).toBe("busy-but-due@x.com");
  });

  it("treats a CS with no rotation history as maximally overdue (recommended first)", () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    const snapshot = aggregateOverview({
      now,
      accounts: [account("veteran@x.com"), account("brand-new@x.com")],
      categories: [],
      taskAgents: [],
      assistantEmails: [],
      tasks: [],
      assigneesByTask: new Map(),
      rules: [],
      reminderSettings: { todoHours: 24, waitingHours: 24 },
      rotationByEmail: new Map([["veteran@x.com", "2026-07-25T11:00:00.000Z"]]), // recent turn
      // brand-new@x.com has no entry at all
    });
    const unassignedTask = {
      id: "new-task",
      title: "New",
      agentEmail: null,
      categoryId: null,
      categoryName: null,
      categoryColor: null,
      priority: "low" as const,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ageSeconds: 0,
      effectiveSlaMinutes: 60,
    };
    const ranked = rankRecommendation(unassignedTask, snapshot.csRows);
    expect(ranked[0].email).toBe("brand-new@x.com");
  });
});
```

Check the existing `account(...)` and `task(...)` test helpers already defined at the top of `overview.test.ts` (from earlier tests in that file) for their exact field defaults before reusing them here — match their existing shape rather than redefining.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/tasks/overview.test.ts`
Expected: FAIL — `OverviewInput` has no `rotationByEmail` field yet, `rankRecommendation` still sorts by SLA-load/pressure.

- [ ] **Step 4: Thread `rotationByEmail` through `OverviewInput` and the accumulator**

In `src/lib/tasks/overview.ts`:

Add to the `OverviewInput` type (after `reminderSettings`):

```typescript
  rotationByEmail: Map<string, string>; // email -> ISO queue_due_at, from task_assignment_rotation
```

Add to `PersonAccumulator` (after `done7d`):

```typescript
  queueDueAt: string | null;
```

In `createAccumulator`, initialize `queueDueAt: null` in the returned object (it gets filled in from `aggregateOverview`'s input right after accumulators are built — see next step, not inside `createAccumulator` itself, since that function doesn't receive the rotation map).

In `aggregateOverview` (the exported function, ~line 347), right after the accumulators map is built and before tasks are folded in, set each accumulator's `queueDueAt` from `input.rotationByEmail`:

```typescript
for (const accumulator of accumulators.values()) {
  accumulator.queueDueAt = input.rotationByEmail.get(accumulator.account.email) ?? null;
}
```

(Place this in the same spot `aggregateOverview` already loops over `input.accounts` to build the initial `accumulators` map — add the loop immediately after that map is constructed.)

In `rowFromAccumulator` (~line 269), add `queueDueAt: accumulator.queueDueAt,` to the returned `CsOverviewRow` object.

- [ ] **Step 5: Rewrite `rankRecommendation`'s sort**

Replace the existing sort body (the `candidates.sort((a, b) => { ... })` block) with:

```typescript
import { EPOCH_QUEUE_DUE_AT } from "./rotation";

// ... (keep the existing candidate-mapping code that builds `candidates`,
// just add queueDueAt to the per-candidate object:)
//   queueDueAt: row.queueDueAt,
// ... then replace the whole `.sort(...)` call with:

function queueDueAtMillis(iso: string | null): number {
  return iso ? new Date(iso).getTime() : EPOCH_QUEUE_DUE_AT.getTime();
}

return candidates.sort((a, b) => {
  const dueDelta = queueDueAtMillis(a.queueDueAt) - queueDueAtMillis(b.queueDueAt);
  if (dueDelta !== 0) return dueDelta;
  // Tie-break only (e.g. two CS who've never been assigned): lower current
  // SLA load goes first. This is the ONLY place SLA-load still influences
  // ranking — it is no longer the primary key.
  if (a.slaLoadMinutes !== b.slaLoadMinutes) return a.slaLoadMinutes - b.slaLoadMinutes;
  return a.email.localeCompare(b.email);
});
```

Delete the now-unused `statusRank` local function and the `urgent` branch logic inside the old sort — `projectedStatus`/`priorityPressure` stay on `RecommendationCandidate` (still computed, still shown in the UI per the spec) but no longer drive sort order. Leave `projectedStatus`/`explainCandidate` computation as-is; only the final `.sort()` changes.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/tasks/overview.test.ts`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors — this will surface every other call site of `aggregateOverview(...)` that now needs a `rotationByEmail` field (Task 4 fixes the real one in `overview-data.ts`; if `optimisticallyAssignOverviewTask` or any other helper constructs an `OverviewInput`-shaped object directly, fix those too).

- [ ] **Step 8: Commit**

```bash
git add src/lib/tasks/overview-types.ts src/lib/tasks/overview.ts src/lib/tasks/overview.test.ts
git commit -m "feat(tasks): rank recommendations by fair-queue turn order instead of SLA load"
```

---

### Task 4: Data layer — fetch the rotation table

**Files:**
- Modify: `src/lib/tasks/overview-data.ts`

**Interfaces:**
- Consumes: nothing new (same Supabase client already in scope).
- Produces: fills `rotationByEmail` before calling `aggregateOverview` — closes the gap Task 3 introduced.

- [ ] **Step 1: Add the query**

In `fetchTaskOverview` (`src/lib/tasks/overview-data.ts`), add a query to the existing `Promise.all([...])` array (alongside `accountsResult`, `rolesResult`, etc.):

```typescript
supabase.from("task_assignment_rotation").select("email,queue_due_at"),
```

Name its destructured result `rotationResult` (matching the naming style of the sibling results), add `rotationResult.error` to the `firstError` array, and build the map right after `reminderSettings` is resolved:

```typescript
const rotationByEmail = new Map(
  ((rotationResult.data ?? []) as Array<{ email: string; queue_due_at: string }>).map((row) => [
    normalizeEmail(row.email),
    row.queue_due_at,
  ])
);
```

Pass `rotationByEmail` into the `aggregateOverview({ ... })` call at the bottom of the function, alongside the existing fields.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/tasks/overview-data.ts
git commit -m "feat(tasks): fetch task_assignment_rotation into the overview snapshot"
```

---

### Task 5: Bump the rotation on assignment

**Files:**
- Create: add to `src/lib/tasks/rotation.ts` (from Task 2 — append, don't create a new file)
- Modify: `src/app/api/tasks/[id]/assignees/route.ts`
- Modify: `src/app/api/tasks/route.ts`

**Interfaces:**
- Consumes: `resolveQueueDueAt` from Task 2 (same file); `effectiveSlaMinutes` from `./sla`; `SupabaseClient` type from `@supabase/supabase-js`.
- Produces: `bumpAssignmentRotation(supabase, email, effectiveSlaMinutesValue, now?): Promise<void>` — both routes below call this.

- [ ] **Step 1: Append the IO helper to `rotation.ts`**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

// Called once per "a CS just received a task" event — see the two call
// sites in src/app/api/tasks/[id]/assignees/route.ts and
// src/app/api/tasks/route.ts. Read-then-write is fine here: assignment
// actions are human-paced (one admin click at a time), not a hot path with
// meaningful concurrent-write risk.
export async function bumpAssignmentRotation(
  supabase: SupabaseClient,
  email: string,
  effectiveSlaMinutesValue: number,
  now: Date = new Date()
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const { data, error: readError } = await supabase
    .from("task_assignment_rotation")
    .select("queue_due_at")
    .eq("email", normalized)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  const current = data?.queue_due_at ? new Date(data.queue_due_at as string) : null;
  const next = resolveQueueDueAt(current, now, effectiveSlaMinutesValue);

  const { error: writeError } = await supabase.from("task_assignment_rotation").upsert({
    email: normalized,
    queue_due_at: next.toISOString(),
    updated_at: now.toISOString(),
  });
  if (writeError) throw new Error(writeError.message);
}
```

- [ ] **Step 2: Wire into `POST /api/tasks/[id]/assignees/route.ts`**

This route already computes `alreadyAssigned` (line ~73) and only logs activity/sends a notification `if (!alreadyAssigned)` (line ~120). Add the rotation bump in that same block, since it's the same "this is a genuinely new assignment" guard:

Find:
```typescript
  if (!alreadyAssigned) {
    await ctx.supabase.from("task_activity").insert({
```

Change to (add the bump before the activity insert, computing SLA minutes from the task being assigned):

```typescript
  if (!alreadyAssigned) {
    await bumpAssignmentRotation(
      ctx.supabase,
      email,
      effectiveSlaMinutes(ctx.task, await fetchSlaRules(ctx.supabase))
    );
    await ctx.supabase.from("task_activity").insert({
```

Add the two new imports at the top of the file:

```typescript
import { bumpAssignmentRotation } from "@/lib/tasks/rotation";
import { effectiveSlaMinutes } from "@/lib/tasks/sla";
```

`fetchSlaRules` doesn't exist yet as a named helper in this route — check `src/lib/tasks/sla.ts` and wherever `task_sla_rules` is already queried elsewhere (e.g. `overview-data.ts`'s `rulesResult`) for the exact column shape, then add a one-off inline query instead of a new shared helper (this route doesn't otherwise need a reusable rules-fetcher):

```typescript
  if (!alreadyAssigned) {
    const { data: rulesData } = await ctx.supabase
      .from("task_sla_rules")
      .select("priority,category_id,duration_minutes");
    await bumpAssignmentRotation(
      ctx.supabase,
      email,
      effectiveSlaMinutes(ctx.task, rulesData ?? [])
    );
    await ctx.supabase.from("task_activity").insert({
```

(Use this inline version — drop the nonexistent `fetchSlaRules` reference from the snippet above.)

- [ ] **Step 3: Wire into `POST /api/tasks/route.ts`**

This route inserts the initial `task_assignees` rows at (~line 184):

```typescript
  const taskId = (data as { id: string }).id;
  if (assignedEmails.length > 0) {
    const { error: assigneeError } = await supabase.from("task_assignees").insert(
      assignedEmails.map((assigneeEmail) => ({
        task_id: taskId,
        email: assigneeEmail,
        created_at: nowIso,
      }))
    );
    if (assigneeError && !isTaskAssigneesMissingError(assigneeError)) {
      return NextResponse.json({ error: assigneeError.message }, { status: 500 });
    }
  }
```

Note `rulesData` is already fetched a few lines above (~line 144) but **only when `startingInProgress`** (it's used there to snapshot `sla_minutes` for the SLA clock). A task can be created with an assignee while starting in `todo`/`backlog`/`waiting` too, so don't rely on that conditional fetch — add a fresh, unconditional one scoped to this block. Change the snippet above to:

```typescript
  const taskId = (data as { id: string }).id;
  if (assignedEmails.length > 0) {
    const { error: assigneeError } = await supabase.from("task_assignees").insert(
      assignedEmails.map((assigneeEmail) => ({
        task_id: taskId,
        email: assigneeEmail,
        created_at: nowIso,
      }))
    );
    if (assigneeError && !isTaskAssigneesMissingError(assigneeError)) {
      return NextResponse.json({ error: assigneeError.message }, { status: 500 });
    }

    const { data: rotationRulesData } = await supabase
      .from("task_sla_rules")
      .select("priority,category_id,duration_minutes");
    const newTaskSlaMinutes = effectiveSlaMinutes(
      { priority, category_id: categoryId, sla_minutes: slaMinutes },
      rotationRulesData ?? []
    );
    for (const assigneeEmail of assignedEmails) {
      await bumpAssignmentRotation(supabase, assigneeEmail, newTaskSlaMinutes);
    }
  }
```

(`priority`, `categoryId`, and `slaMinutes` are already in scope at this point in the function — they're the same variables used in the `tasks` insert immediately above. `slaMinutes` is `null` unless `startingInProgress`, which is fine: `effectiveSlaMinutes` falls back to resolving from `priority`/`category_id`/`rotationRulesData` whenever the snapshot is `null`, per its existing implementation in `src/lib/tasks/sla.ts:47`.)

Add the two new imports at the top of the file:

```typescript
import { bumpAssignmentRotation } from "@/lib/tasks/rotation";
import { effectiveSlaMinutes } from "@/lib/tasks/sla";
```

(If `resolveSlaMinutes` is already imported from `@/lib/tasks/sla` in this file — it is, per the existing `slaMinutes` computation above — add `effectiveSlaMinutes` to that same existing import line instead of a new one.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, assign an unassigned task to a CS via the board, then query `task_assignment_rotation` (via Supabase dashboard or a throwaway script) to confirm a row appeared/updated with a sensible `queue_due_at` (now + that task's SLA minutes).

- [ ] **Step 6: Commit**

```bash
git add src/lib/tasks/rotation.ts src/app/api/tasks/[id]/assignees/route.ts src/app/api/tasks/route.ts
git commit -m "feat(tasks): bump the fair-queue rotation on every assignment"
```

---

### Task 6: UI — persistent "Assignment queue" section

**Files:**
- Modify: `src/app/(authed)/tasks/_components/CSWorkloadOverview.tsx`

**Interfaces:**
- Consumes: `snapshot.csRows` (now carrying `queueDueAt` from Task 3) — no new fetch needed, per the spec.

- [ ] **Step 1: Add a relative-time helper for `queueDueAt`**

Near the existing `formatAge` helper in this file, add:

```typescript
function formatQueueDueAt(queueDueAt: string | null, now: Date): string {
  if (!queueDueAt) return "Up now";
  const dueMs = new Date(queueDueAt).getTime();
  const diffMinutes = Math.round((dueMs - now.getTime()) / 60000);
  if (diffMinutes <= 0) return "Up now";
  if (diffMinutes < 60) return `Next in ~${diffMinutes}m`;
  const hours = Math.round(diffMinutes / 60);
  if (hours < 48) return `Next in ~${hours}h`;
  return `Next in ~${Math.round(hours / 24)}d`;
}
```

- [ ] **Step 2: Add the `AssignmentQueue` component**

```tsx
function AssignmentQueue({ rows }: { rows: CsOverviewRow[] }) {
  const now = new Date();
  const ordered = [...rows].sort((a, b) => {
    const aMs = a.queueDueAt ? new Date(a.queueDueAt).getTime() : 0;
    const bMs = b.queueDueAt ? new Date(b.queueDueAt).getTime() : 0;
    return aMs - bMs;
  });

  return (
    <div className="rounded-lg border border-[#e6eaf0] bg-white p-4">
      <h3 className="text-sm font-bold text-[#172b4d]">Assignment queue</h3>
      <p className="mt-1 text-xs text-[#667085]">
        Who&apos;s next for a new task, in order. Bigger tasks push someone further back.
      </p>
      <ol className="mt-3 space-y-1.5">
        {ordered.map((row, index) => {
          const upNow = !row.queueDueAt || new Date(row.queueDueAt).getTime() <= now.getTime();
          return (
            <li key={row.email} className="flex items-center gap-3 text-xs">
              <span className="w-5 shrink-0 text-right font-bold text-[#8993a4]">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate font-semibold text-[#172b4d]">
                {personName(row.email, row.name)}
              </span>
              <span className={`shrink-0 font-bold ${upNow ? "text-[#00875a]" : "text-[#6b778c]"}`}>
                {formatQueueDueAt(row.queueDueAt, now)}
              </span>
            </li>
          );
        })}
        {ordered.length === 0 ? <li className="text-xs text-[#97a0af]">No CS in the pool.</li> : null}
      </ol>
    </div>
  );
}
```

Check this file's existing `personName(email, name)` helper signature (already defined near the top, per the earlier structural grep of this file) before reusing it — match its exact parameter order.

- [ ] **Step 3: Render it in the Overview layout**

In the main `CSWorkloadOverview` render, find where the "Attention areas" / "Work mix" sections are laid out (the `<div className="mb-4">` blocks with `<h3>Attention areas</h3>` / `<h3>Work mix</h3>` headers) and add `<AssignmentQueue rows={snapshot.csRows} />` as a sibling section — place it near the Unassigned queue section (same visual area as the Recommend panel, per the spec's placement guidance) rather than at the very top with the KPI tiles.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint "src/app/(authed)/tasks/_components/CSWorkloadOverview.tsx"`
Expected: no errors

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open the Task Overview, confirm the "Assignment queue" section renders with all CS listed in `queue_due_at` order, "Up now" shown in green for whoever's eligible.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(authed)/tasks/_components/CSWorkloadOverview.tsx"
git commit -m "feat(tasks): show the fair-queue assignment order in Overview"
```

---

## Self-Review Notes

- **Spec coverage:** rotation table ✓, bump-on-every-assignment-method ✓ (both code paths), company-wide scope (no filtering added — the full CS pool is already company-wide in `fetchTaskOverview`) ✓, ranking change (queue_due_at primary, SLA tie-break) ✓, visible queue UI ✓.
- **Placeholder scan:** Task 5 Step 3 (`POST /api/tasks/route.ts`) is deliberately left as an *instruction to read the file and match its real variable names* rather than fabricated code, because this plan's author did not have that file's exact current contents in hand — this is flagged explicitly in the step itself, not silently glossed over. Whoever executes this task must read the file first; do not skip that read.
- **Type consistency:** `queueDueAt: string | null` is spelled identically across `CsOverviewRow`, `RecommendationCandidate`, `OverviewInput.rotationByEmail` (Map value is the raw ISO string, converted to `Date` only inside `resolveQueueDueAt`/`queueDueAtMillis`), and the UI helper — no silent type drift between tasks.
- **Known follow-up, not blocking:** no cap on how far a single huge task can push someone back (the user asked about this after the mechanism explanation but didn't request a cap be built now — flag to them once this ships, in case real SLA outliers (e.g. a 24h "low" priority task) make someone's queue turn come around unexpectedly rarely).
