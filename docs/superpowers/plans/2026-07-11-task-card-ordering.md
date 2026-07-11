# Task Card Auto-Ordering — Implementation Plan

> **For a human implementer:** hand-coding plan. Pure ranking logic is TDD'd
> first; wiring is verified with `npm run typecheck && npm run lint && npm run build`.

**Goal:** Order cards inside each Kanban column (and the List view) automatically by attention-need — overdue first, then whatever was most recently acted on, then the steady backlog by priority — recomputed live so the board reads like an "attention feed". Manual within-column drag is allowed but session-only; a reload/login/refetch reverts to the automatic order. Cross-column drag (status change) is unchanged.

**Architecture:** A single pure comparator `compareTaskRank` in `src/lib/tasks/sorting.ts` defines the order; the Kanban column renderer and the List view both sort with it by default. The comparator uses `isTaskOverdue`/`slaRemainingSeconds` from `sla.ts` and the `tasks.last_activity_at` column (added by the notifications plan). Manual within-column order is held in component-local state and dropped on the next task refetch.

**Tech Stack:** Next.js App Router, `@dnd-kit` (already used), Vitest, TypeScript.

## Global Constraints

- Ranking is PURE and unit-tested in `src/lib/tasks/sorting.ts`; components only call it.
- No schema change here. **Depends on `tasks.last_activity_at`** from `2026-07-11-task-notifications.md` Task 1 — that column must exist and be populated first (the comparator treats a missing value as "no recent activity", so it degrades gracefully but the "recent" tier won't work until it's live).
- New UI text in English. Do NOT push to the `vercel` remote. Commit after each task.

## The ordering rule (top = needs attention most)

Three tiers; within a tier, a secondary then tertiary key. Applied per column, so a column that has no overdue tasks simply starts at tier 1.

1. **Overdue** (only ever true for In Progress; `isTaskOverdue`) → most-overdue first (`slaRemainingSeconds` ascending = most negative first).
2. **Recently active** — `last_activity_at` within the last `RECENT_ACTIVITY_WINDOW_MS` (default 24h) → most recent first. This is where a just-assigned / just-commented / just-reopened / just-moved task surfaces.
3. **Steady backlog** — everything else → priority first (urgent → high → medium → low), then oldest `created_at` first.

Ties broken by `id` for a stable order.

> Decision captured: recency beats priority — a low-priority task acted on 5 min ago (tier 2) ranks above an untouched urgent task (tier 3). Urgent-untouched still sits at the top of tier 3, so it stays visible.

## File Structure

- `src/lib/tasks/sorting.ts` — add `compareTaskRank` + `RECENT_ACTIVITY_WINDOW_MS`; keep the existing `sortTasks`/`taskKey`.
- `src/lib/tasks/sorting.test.ts` — add ranking tests.
- `src/app/(authed)/tasks/_components/KanbanBoard.tsx` — sort each column by rank; hold manual drag order in session state.
- `src/app/(authed)/tasks/_components/TaskListView.tsx` — default the list to rank order (existing column-header sort still overrides, session-only).

---

## Task 1: `compareTaskRank` (pure, tested)

**Files:** modify `src/lib/tasks/sorting.ts`; modify `src/lib/tasks/sorting.test.ts`.

**Interfaces:**
- Consumes: `isTaskOverdue`, `slaRemainingSeconds` from `sla.ts`; `TaskRow`, `TaskSlaRule` from `types.ts`; `TASK_PRIORITIES`.
- Produces:
  - `RECENT_ACTIVITY_WINDOW_MS: number` (= `24 * 3600_000`).
  - `compareTaskRank(a: TaskRow, b: TaskRow, rules: TaskSlaRule[], now: Date): number` — negative if `a` sorts above `b`.
  - `rankTasks(tasks: TaskRow[], rules: TaskSlaRule[], now: Date): TaskRow[]` — convenience: `[...tasks].sort(compareTaskRank-bound)`.

- [ ] **Step 1: Write failing tests.** Add to `sorting.test.ts` (reuse the existing `task(partial)` factory in that file; it already builds a full `TaskRow`). If the factory predates `last_activity_at`, add `last_activity_at: null` to its defaults first.

```ts
import { rankTasks, RECENT_ACTIVITY_WINDOW_MS } from "@/lib/tasks/sorting";

describe("rankTasks", () => {
  const now = new Date("2026-07-05T12:00:00.000Z");
  const rules = [{ id: "r", priority: "urgent" as const, category_id: null, duration_minutes: 60 }];

  it("overdue tasks come first, most-overdue on top", () => {
    const mild = task({
      id: "mild", status: "in_progress", priority: "low",
      in_progress_at: "2026-07-05T10:30:00.000Z", sla_minutes: 60, in_progress_seconds: 0, overdue_count: 0,
    }); // 90 min in, 30 over
    const severe = task({
      id: "severe", status: "in_progress", priority: "low",
      in_progress_at: "2026-07-05T09:00:00.000Z", sla_minutes: 60, in_progress_seconds: 0, overdue_count: 0,
    }); // 180 min in, 120 over
    const fresh = task({ id: "fresh", status: "in_progress", priority: "urgent",
      in_progress_at: "2026-07-05T11:55:00.000Z", sla_minutes: 60, in_progress_seconds: 0, overdue_count: 0,
      last_activity_at: "2026-07-05T11:55:00.000Z" });
    expect(rankTasks([fresh, mild, severe], rules, now).map((t) => t.id)).toEqual([
      "severe", "mild", "fresh",
    ]);
  });

  it("recently-active beats an untouched higher priority (recency wins)", () => {
    const urgentOld = task({ id: "urgentOld", status: "todo", priority: "urgent",
      last_activity_at: "2026-07-01T00:00:00.000Z", created_at: "2026-07-01T00:00:00.000Z" });
    const lowRecent = task({ id: "lowRecent", status: "todo", priority: "low",
      last_activity_at: "2026-07-05T11:50:00.000Z", created_at: "2026-07-04T00:00:00.000Z" });
    expect(rankTasks([urgentOld, lowRecent], rules, now).map((t) => t.id)).toEqual([
      "lowRecent", "urgentOld",
    ]);
  });

  it("outside the recent window, priority orders the backlog; older first within a priority", () => {
    const old = new Date(now.getTime() - RECENT_ACTIVITY_WINDOW_MS - 1000).toISOString();
    const high = task({ id: "high", status: "todo", priority: "high", last_activity_at: old });
    const lowA = task({ id: "lowA", status: "todo", priority: "low", last_activity_at: old, created_at: "2026-07-01T00:00:00.000Z" });
    const lowB = task({ id: "lowB", status: "todo", priority: "low", last_activity_at: old, created_at: "2026-07-02T00:00:00.000Z" });
    expect(rankTasks([lowB, lowA, high], rules, now).map((t) => t.id)).toEqual([
      "high", "lowA", "lowB",
    ]);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/tasks/sorting.test.ts` → FAIL.

- [ ] **Step 3: Implement** in `sorting.ts`:

```ts
import { isTaskOverdue, slaRemainingSeconds } from "./sla";
import { TASK_PRIORITIES, type TaskRow, type TaskSlaRule } from "./types";

export const RECENT_ACTIVITY_WINDOW_MS = 24 * 3600_000;

// Smaller = higher priority (urgent on top).
const PRIORITY_RANK: Record<TaskRow["priority"], number> =
  Object.fromEntries(TASK_PRIORITIES.map((p, i) => [p, TASK_PRIORITIES.length - 1 - i])) as Record<TaskRow["priority"], number>;
// TASK_PRIORITIES is ["low","medium","high","urgent"], so urgent -> 0 ... low -> 3.

function ms(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// [tier, key1, key2] — lexicographic, smaller sorts first.
function rankTuple(task: TaskRow, rules: TaskSlaRule[], now: Date): [number, number, number] {
  if (isTaskOverdue(task, rules, now)) {
    return [0, slaRemainingSeconds(task, rules, now), 0]; // most negative (most overdue) first
  }
  const lastMs = ms(task.last_activity_at);
  if (lastMs > 0 && now.getTime() - lastMs <= RECENT_ACTIVITY_WINDOW_MS) {
    return [1, -lastMs, 0]; // most recent first
  }
  return [2, PRIORITY_RANK[task.priority], ms(task.created_at)]; // priority, then oldest first
}

export function compareTaskRank(
  a: TaskRow,
  b: TaskRow,
  rules: TaskSlaRule[],
  now: Date
): number {
  const ta = rankTuple(a, rules, now);
  const tb = rankTuple(b, rules, now);
  for (let i = 0; i < 3; i++) {
    if (ta[i] !== tb[i]) return ta[i] - tb[i];
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function rankTasks(tasks: TaskRow[], rules: TaskSlaRule[], now: Date): TaskRow[] {
  return [...tasks].sort((a, b) => compareTaskRank(a, b, rules, now));
}
```

- [ ] **Step 4:** Test PASS. **Step 5:** Commit (`feat(tasks): attention-based card ranking (overdue → recent → priority)`).

---

## Task 2: Kanban — rank each column, manual drag held for the session only

**Files:** modify `src/app/(authed)/tasks/_components/KanbanBoard.tsx`.

Current behavior: `sortedTasks = byPosition(tasks)`; `columnTasks(col)` filters `items` (which is `dragItems ?? sortedTasks`); `handleDragEnd` computes a midpoint `position` and calls `onMove(id, { status, position })` for BOTH cross-column and within-column moves.

Target behavior: the canonical per-column order is `rankTasks`; within-column drag reorders a local session map that overrides rank until the task list is refetched; cross-column drag still changes status.

- [ ] **Step 1:** Replace the base order. Where `sortedTasks` is computed, sort by rank instead of position:

```ts
const rankedTasks = useMemo(
  () => rankTasks(tasks, rules, now),
  [tasks, rules, now]
);
```

Use `rankedTasks` everywhere `sortedTasks` was used (base for `items`, `handleDragStart`, etc.). Remove the `byPosition` import/use if now unused.

- [ ] **Step 2:** Add a session manual-order override. Add local state:

```ts
// Task ids the user has manually reordered this session, per column, in the
// chosen order. Cleared whenever the task list changes (refetch/realtime), so
// a reload/login reverts to the automatic order (per the agreed design).
const [manualOrder, setManualOrder] = useState<Record<string, string[]>>({});
useEffect(() => { setManualOrder({}); }, [tasks]);
```

Apply it in `columnTasks`: within a column, tasks whose id is in `manualOrder[col]` render first in that stored order; the rest keep rank order.

```ts
const columnTasks = (column: BoardColumn) => {
  const inColumn = items.filter((t) => columnOf(t) === column);
  const manual = manualOrder[column];
  if (!manual?.length) return inColumn;
  const pos = new Map(manual.map((id, i) => [id, i]));
  return [...inColumn].sort((a, b) => {
    const pa = pos.has(a.id) ? pos.get(a.id)! : Number.MAX_SAFE_INTEGER;
    const pb = pos.has(b.id) ? pos.get(b.id)! : Number.MAX_SAFE_INTEGER;
    return pa - pb; // manual-ordered first (stable for the rest, already rank-ordered)
  });
};
```

- [ ] **Step 3:** In `handleDragEnd`, split the two cases:
  - **Cross-column** (status changed): keep calling `onMove(id, { status, position })` as today (position is now only used as a stable tiebreaker on the server; it no longer drives display).
  - **Within-column reorder** (same status): do NOT call `onMove`; instead record the new id order into `manualOrder[column]` from the current on-screen order after the drag. This keeps it session-local (Step 2's `useEffect` drops it on the next refetch).

- [ ] **Step 4:** `npm run typecheck && npm run lint && npm run build` → green. Manually verify: cards load in rank order; dragging a card up within a column holds until you change something elsewhere (which triggers a refetch) then reverts to rank. Commit (`feat(tasks): auto-rank kanban columns with session-only manual drag`).

---

## Task 3: List view default order = rank

**Files:** modify `src/app/(authed)/tasks/_components/TaskListView.tsx` (and check how it currently sorts — it uses `sortTasks(tasks, sortKey, dir)` driven by clickable column headers).

- [ ] **Step 1:** When no explicit column sort is active (the default state), order rows with `rankTasks(tasks, rules, now)` instead of the current default. When the user clicks a column header to sort (name/date/priority), keep that behavior (session-only, as today). Concretely: introduce a `sortKey === null`/"auto" default that maps to `rankTasks`; the existing header handlers set a real key and override.

- [ ] **Step 2:** Ensure the List view has `rules` and a ticking `now` available (the board already passes `now`/`slaRules` down; thread them into `TaskListView` if not already present — it needs them for `rankTasks`).

- [ ] **Step 3:** Verify build. Commit (`feat(tasks): default list order to attention rank`).

---

## Self-Review

- **Coverage:** overdue-first / recent-bubbles-up / priority-backlog → Task 1 (tested); reload→auto with session manual drag → Task 2; same rule for List → Task 3. The four example behaviors the user gave (new overdue, overdue-reopen, new assigned, new comment) all land in tier 1/2 because each bumps `last_activity_at` (guaranteed by the notifications plan's Task 4) or flips overdue. ✓
- **Dependency:** requires `tasks.last_activity_at` (notifications plan Task 1). Without it, tier 2 never triggers and everything falls to the priority backlog — degrades safely, but do that column first.
- **Placeholders:** the comparator is complete code with tests; the wiring task names the exact functions (`sortedTasks`, `columnTasks`, `handleDragEnd`) to change.
- **Type consistency:** `compareTaskRank(a, b, rules, now)` / `rankTasks(tasks, rules, now)` signatures are used identically in Kanban and List. `PRIORITY_RANK` is derived from `TASK_PRIORITIES` so it can't drift from the enum.
