# Manager-oriented Task Ordering (Board + List)

> **For a human implementer:** hand-coding plan. The pure comparator is TDD'd first; wiring is verified with `npm run typecheck && npm run lint && npm run test:run && npm run build`.

**Goal:** Give agent/admin (manager) views an ordering built for **oversight/triage** — "what needs my action" — instead of the CS "what do I work on next" order. Applies to both the **List** (flat) and the **Board** (within each column). CS keeps today's `rankTasks`.

**Architecture:** Add one pure comparator `compareManagerRank` / `rankTasksForManager` in `sorting.ts` (band model). The board and list pick the comparator by role via a single `managerView` flag (`isManager || isAgentOrAssistant`) threaded from `TaskBoardClient`. No schema, no new deps.

**Tech Stack:** Next.js App Router, TypeScript, Vitest. (See `agent-portal/AGENTS.md`.)

## Global Constraints
- `sorting.ts` stays pure + unit-tested; no DB/settings access inside it (thresholds are avoided — staleness is surfaced by within-band sort, not a magic cutoff).
- English UI copy. Don't push to `vercel`. Commit after each task.
- Reuse existing helpers: `isTaskOverdue`, `slaRemainingSeconds`, `RECENT_ACTIVITY_WINDOW_MS`, `ATTENTION_PRIORITY_RANK`, `timestamp`, `taskKey`.

## The manager rank — band model (top = needs attention most)

`open` = status ∈ {backlog, todo, in_progress, waiting}. Lower band number sorts higher. Within a band, the listed sort applies; final tie-break is `task.id` (stable, no flicker).

| Band | Name | Predicate (first match wins) | Sort within band |
|---|---|---|---|
| 0 | 🔴 Overdue | `isTaskOverdue(task)` | most overdue first (`slaRemainingSeconds` asc) |
| 1 | 🟠 Unassigned | `open` & no assignee | oldest first (`created_at` asc) |
| 2 | 🟡 Stalled | `status==="waiting"` (any priority) **OR** (`status==="todo"` & priority ∈ {urgent,high}) | priority desc (urgent first), then **longest-in-state first** |
| 3 | 🔵 Done → QC | `status==="done"` & not `done_reviewed_by_email` | oldest done first (`closed_at` asc) |
| 4 | ⚪ Recently active | `last_activity_at` within 24h | newest first |
| 5 | ⚫ Rest (open) | any other `open` (med/low todo, in-progress not-overdue/not-recent) | priority desc, then oldest created |
| 6 | ✔️ Closed | done-reviewed / cancel | newest first (sinks to bottom) |

**Why this fits a manager, and why it works on the Board too:** the board's columns already split by status, so this same comparator, applied *within each column*, yields exactly the right per-column order — Backlog: oldest-unassigned on top; To Do: urgent/high-stalled on top; In Progress: most-overdue on top; Waiting: longest-waiting on top; Done: awaiting-QC on top. Flat (List), the bands stack into the triage order above.

## File Structure
- `src/lib/tasks/sorting.ts` — add `OPEN_STATUSES`, `timeInStateMs`, `managerRankTuple`, `compareManagerRank`, `rankTasksForManager`. (Keep `rankTasks`/`compareTaskRank` untouched = CS order.)
- `src/lib/tasks/sorting.test.ts` — new tests (create if absent).
- `src/app/(authed)/tasks/_components/TaskListView.tsx` — pick rank by `managerView` prop.
- `src/app/(authed)/tasks/_components/KanbanBoard.tsx` — pick base rank by `managerView` prop.
- `src/app/(authed)/tasks/_components/TaskBoardClient.tsx` — compute `managerView` and pass to both.

---

## Task 1: Pure manager comparator (TDD)

**Files:** modify `src/lib/tasks/sorting.ts`; create/extend `src/lib/tasks/sorting.test.ts`.

**Interfaces — Produces:**
- `rankTasksForManager(tasks: TaskRow[], rules: TaskSlaRule[], now: Date): TaskRow[]`
- `compareManagerRank(a: TaskRow, b: TaskRow, rules: TaskSlaRule[], now: Date): number`

- [ ] **Step 1: Failing tests** — `src/lib/tasks/sorting.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rankTasksForManager } from "@/lib/tasks/sorting";
import type { TaskRow, TaskSlaRule } from "@/lib/tasks/types";

const NOW = new Date("2026-07-13T12:00:00Z");
const rules: TaskSlaRule[] = [{ priority: "urgent", category_id: null, duration_minutes: 60 } as TaskSlaRule];

// Minimal task factory — only fields the comparator reads.
function t(over: Partial<TaskRow>): TaskRow {
  return {
    id: over.id ?? "id",
    status: "todo",
    priority: "medium",
    category_id: null,
    agent_email: "a@x.com",
    assignee_email: "cs@x.com",
    assignees: ["cs@x.com"],
    created_at: "2026-07-13T11:00:00Z",
    updated_at: "2026-07-13T11:00:00Z",
    last_activity_at: null,
    closed_at: null,
    done_reviewed_by_email: null,
    todo_started_at: null,
    waiting_started_at: null,
    in_progress_at: null,
    overdue_count: 0,
    sla_minutes: null,
    in_progress_seconds: 0,
    waiting_seconds: 0,
    todo_seconds: 0,
  } as unknown as TaskRow;
}

function ids(list: TaskRow[]) {
  return list.map((task) => task.id);
}

describe("rankTasksForManager", () => {
  it("overdue on top, then unassigned, then stalled", () => {
    const overdue = t({
      id: "overdue", status: "in_progress", priority: "urgent",
      in_progress_at: "2026-07-13T09:00:00Z", sla_minutes: 60, overdue_count: 0,
    });
    const unassigned = t({ id: "unassigned", status: "backlog", assignee_email: null, assignees: [] });
    const waiting = t({ id: "waiting", status: "waiting", waiting_started_at: "2026-07-13T08:00:00Z" });
    expect(ids(rankTasksForManager([waiting, unassigned, overdue], rules, NOW)))
      .toEqual(["overdue", "unassigned", "waiting"]);
  });

  it("waiting: longest-waiting first", () => {
    const short = t({ id: "short", status: "waiting", waiting_started_at: "2026-07-13T11:30:00Z" });
    const long = t({ id: "long", status: "waiting", waiting_started_at: "2026-07-13T06:00:00Z" });
    expect(ids(rankTasksForManager([short, long], rules, NOW))).toEqual(["long", "short"]);
  });

  it("stalled todo: urgent before high; low/medium todo drop to rest", () => {
    const urgent = t({ id: "urgent", status: "todo", priority: "urgent", todo_started_at: "2026-07-13T10:00:00Z" });
    const high = t({ id: "high", status: "todo", priority: "high", todo_started_at: "2026-07-13T10:00:00Z" });
    const low = t({ id: "low", status: "todo", priority: "low", todo_started_at: "2026-07-13T10:00:00Z" });
    expect(ids(rankTasksForManager([low, high, urgent], rules, NOW))).toEqual(["urgent", "high", "low"]);
  });

  it("done-awaiting-QC ranks above recently-active, and reviewed/cancel sink to bottom", () => {
    const qc = t({ id: "qc", status: "done", done_reviewed_by_email: null, closed_at: "2026-07-13T10:00:00Z" });
    const recent = t({ id: "recent", status: "in_progress", last_activity_at: "2026-07-13T11:59:00Z", in_progress_at: "2026-07-13T11:00:00Z", sla_minutes: 600 });
    const closed = t({ id: "closed", status: "done", done_reviewed_by_email: "a@x.com", closed_at: "2026-07-13T09:00:00Z" });
    expect(ids(rankTasksForManager([closed, recent, qc], rules, NOW))).toEqual(["qc", "recent", "closed"]);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/tasks/sorting.test.ts` → FAIL (`rankTasksForManager` not exported).

- [ ] **Step 3: Implement** in `sorting.ts` (append; do not touch `rankTasks`):

```ts
const OPEN_STATUSES = new Set<TaskStatus>(["backlog", "todo", "in_progress", "waiting"]);

function timeInStateMs(task: TaskRow, now: Date): number {
  const started =
    task.status === "waiting" ? task.waiting_started_at
    : task.status === "todo" ? task.todo_started_at
    : task.status === "in_progress" ? task.in_progress_at
    : null;
  return started ? Math.max(0, now.getTime() - timestamp(started)) : 0;
}

function hasAssignee(task: TaskRow): boolean {
  return task.assignees.length > 0 || Boolean(task.assignee_email);
}

// Manager/oversight rank: surface work that needs a manager's action first.
// Bands (0 = top): overdue → unassigned → stalled(waiting|urgent/high todo) →
// done-awaiting-QC → recently active → rest → closed. See the plan for the
// full table. Returns [band, primary, secondary]; compared left-to-right.
function managerRankTuple(task: TaskRow, rules: TaskSlaRule[], now: Date): [number, number, number] {
  if (isTaskOverdue(task, rules, now)) {
    return [0, slaRemainingSeconds(task, rules, now), 0];
  }
  const open = OPEN_STATUSES.has(task.status);
  if (open && !hasAssignee(task)) {
    return [1, timestamp(task.created_at), 0];
  }
  const stalled =
    task.status === "waiting" ||
    (task.status === "todo" && (task.priority === "urgent" || task.priority === "high"));
  if (stalled) {
    return [2, ATTENTION_PRIORITY_RANK[task.priority], -timeInStateMs(task, now)];
  }
  if (task.status === "done" && !task.done_reviewed_by_email) {
    return [3, timestamp(task.closed_at), 0];
  }
  const lastActivityMs = timestamp(task.last_activity_at);
  if (lastActivityMs > 0 && now.getTime() - lastActivityMs <= RECENT_ACTIVITY_WINDOW_MS) {
    return [4, -lastActivityMs, 0];
  }
  if (open) {
    return [5, ATTENTION_PRIORITY_RANK[task.priority], timestamp(task.created_at)];
  }
  return [6, -timestamp(task.closed_at), 0];
}

export function compareManagerRank(a: TaskRow, b: TaskRow, rules: TaskSlaRule[], now: Date): number {
  const at = managerRankTuple(a, rules, now);
  const bt = managerRankTuple(b, rules, now);
  for (let i = 0; i < at.length; i += 1) {
    if (at[i] !== bt[i]) return at[i] - bt[i];
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function rankTasksForManager(tasks: TaskRow[], rules: TaskSlaRule[], now: Date): TaskRow[] {
  return [...tasks].sort((a, b) => compareManagerRank(a, b, rules, now));
}
```

- [ ] **Step 4:** Run the test file → PASS. Also run the full suite (`npm run test:run`) to confirm CS `rankTasks` tests are untouched.
- [ ] **Step 5:** Commit (`feat(tasks): manager oversight ranking comparator`).

---

## Task 2: List view picks rank by role (standalone)

Self-contained: threads its own flag, verifies green, and commits on its own — no
dependency on the Board task.

**Files:** modify `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`,
`src/app/(authed)/tasks/_components/TaskListView.tsx`.

**Interfaces — Consumes:** `rankTasksForManager` (Task 1).

- [ ] **Step 1 — compute + pass the flag:** In `TaskBoardClient.tsx`, near the other
  role derivations (`isAgentOrAssistant`, `shouldLimitPlainCsTasks`, ~line 400), add:

```ts
// Agent/admin get the oversight order; plain CS keep the "what do I work on" order.
const managerView = isManager || isAgentOrAssistant;
```

  Then on the `<TaskListView ... />` element (the `view === "list"` render, ~line 936),
  add the prop: `managerView={managerView}`.

- [ ] **Step 2 — accept the prop:** In `TaskListView.tsx`, add `managerView: boolean`
  to BOTH the destructured params and the props type (the block that already lists
  `isManager`, `myAssistantAgents`, …).

- [ ] **Step 3 — swap the auto order:** Import `rankTasksForManager` alongside the
  existing `rankTasks` import. At the default-order line (currently
  `sortKey === null ? rankTasks(tasks, rules, now) : sortTasks(...)`, ~line 80):

```ts
const rows =
  sortKey === null
    ? (managerView
        ? rankTasksForManager(tasks, rules, now)
        : rankTasks(tasks, rules, now))
    : sortTasks(tasks, sortKey, sortDir, categoryName);
```

  Explicit column sort (clicking a header → `sortTasks`) is unchanged for every role —
  a manager who clicks "Priority" still gets a plain priority sort; the manager rank is
  only the *default* (no column selected).

- [ ] **Step 4 — verify (self-contained):** `npm run typecheck && npm run lint && npm run test:run && npm run build` → all green on their own (the Board still renders with `rankTasks`; it's untouched).
- [ ] **Step 5 — manual check:** As admin/agent open **List** (no column clicked):
  overdue → unassigned → waiting/urgent-stalled → done-awaiting-QC → recently active →
  rest → closed. Click a column header → normal column sort. As plain CS: List order
  unchanged. Commit (`feat(tasks): list uses manager ranking for agent/admin`).

---

## Task 3: Board picks base rank by role (standalone)

**Files:** modify `KanbanBoard.tsx`, `TaskBoardClient.tsx`.

**Interfaces — Consumes:** `rankTasksForManager` (Task 1), `managerView` (already
computed in `TaskBoardClient` by Task 2).

- [ ] **Step 1:** In `TaskBoardClient.tsx`, pass the existing `managerView` flag to the
  `<KanbanBoard ... />` element (`view === "board"` render, ~line 910):
  `managerView={managerView}`. (If Task 2 hasn't run, add the `const managerView = …`
  line from Task 2 Step 1 first.)

- [ ] **Step 2:** In `KanbanBoard.tsx`, add `managerView: boolean` to props (interface + destructure). Import `rankTasksForManager`. At the base-rank memo (currently `() => rankTasks(tasks, rules, now)`):

```ts
const ranked = useMemo(
  () => (managerView ? rankTasksForManager(tasks, rules, now) : rankTasks(tasks, rules, now)),
  [managerView, tasks, rules, now]
);
```

Keep the per-column manual-drag override (`manualOrder`) exactly as-is: managers can still drag within a column during a session; on reload/refetch the base order is the manager rank (auto oversight order). Cross-column drag still changes status unchanged.

- [ ] **Step 3:** `npm run typecheck && npm run lint && npm run test:run && npm run build` → all green.
- [ ] **Step 4:** Manual check on the **Board**:
  - As **admin/agent**: Backlog oldest-unassigned first · To Do urgent/high-stalled first · Waiting longest-waiting first · In Progress most-overdue first · Done awaiting-QC first. Within-column drag still works in-session; a reload restores the manager order.
  - As **plain CS**: Board unchanged (still `rankTasks`).
- [ ] **Step 5:** Commit (`feat(tasks): board columns use manager ranking for agent/admin`).

---

## Task 4 *(OPTIONAL, List-only)*: "Attention" reason badge — triage inbox

Turns the manager List into a real triage inbox: each surfaced row shows **why** it's
high (the band it fell in). Purely additive — skip it and the List still works from
Task 2. Only shown when `managerView` is true.

**Files:** modify `src/lib/tasks/sorting.ts` (+ its test), `TaskListView.tsx`,
and `TaskRowItem.tsx` (render the pill).

**Interfaces — Produces:** `managerAttentionReason(task, rules, now): AttentionReason | null`.

- [ ] **Step 1 (TDD):** add to `sorting.test.ts`:

```ts
import { managerAttentionReason } from "@/lib/tasks/sorting";

it("attention reason mirrors the band", () => {
  const unassigned = t({ id: "u", status: "backlog", assignee_email: null, assignees: [] });
  const waiting = t({ id: "w", status: "waiting", waiting_started_at: "2026-07-13T06:00:00Z" });
  const activeQuiet = t({ id: "q", status: "in_progress", in_progress_at: "2026-07-13T11:00:00Z", sla_minutes: 600, last_activity_at: "2026-07-13T11:59:00Z" });
  expect(managerAttentionReason(unassigned, rules, NOW)?.label).toBe("Unassigned");
  expect(managerAttentionReason(waiting, rules, NOW)?.tone).toBe("purple");
  expect(managerAttentionReason(activeQuiet, rules, NOW)).toBeNull(); // bands 4-6 = no badge
});
```

- [ ] **Step 2:** Implement in `sorting.ts` — reuses the SAME band predicates as
  `managerRankTuple` (bands 0-3 get a badge; 4-6 return `null`). Keep the two in sync,
  or extract a shared `managerBand()` if you prefer one source:

```ts
export type AttentionReason = {
  label: string;
  tone: "red" | "orange" | "purple" | "yellow" | "blue";
};

export function managerAttentionReason(
  task: TaskRow, rules: TaskSlaRule[], now: Date
): AttentionReason | null {
  if (isTaskOverdue(task, rules, now)) {
    return { label: formatSlaRemaining(slaRemainingSeconds(task, rules, now)), tone: "red" };
  }
  const open = OPEN_STATUSES.has(task.status);
  if (open && !hasAssignee(task)) return { label: "Unassigned", tone: "orange" };
  if (task.status === "waiting") {
    return { label: `Waiting ${formatDurationSeconds(timeInStateMs(task, now) / 1000)}`, tone: "purple" };
  }
  if (task.status === "todo" && (task.priority === "urgent" || task.priority === "high")) {
    return { label: "Stalled", tone: "yellow" };
  }
  if (task.status === "done" && !task.done_reviewed_by_email) {
    return { label: "Needs QC", tone: "blue" };
  }
  return null;
}
```

  Import `formatSlaRemaining` + `formatDurationSeconds` from `./sla` at the top of
  `sorting.ts` (already imports `isTaskOverdue`, `slaRemainingSeconds`).

- [ ] **Step 3:** In `TaskListView.tsx`, compute `managerView && managerAttentionReason(task, rules, now)`
  per row and pass it into `TaskRowItem` as an optional `attention?: AttentionReason` prop.
- [ ] **Step 4:** In `TaskRowItem.tsx`, when `attention` is set, render a small pill next
  to the Summary (tone → the existing board color tokens; keep it one line, `truncate`).
  Hidden entirely for CS (prop simply never passed).
- [ ] **Step 5:** `npm run typecheck && npm run lint && npm run test:run && npm run build` → green. Commit (`feat(tasks): attention reason badge on manager list`).

**Decision:** ship this or not — it's the only "new UI" here; Tasks 1-3 are pure
reordering. If you want the List to *read* like a triage queue, do it; if you just want
the order changed, stop after Task 2.

---

## Self-Review
- **Coverage:** manager triage order → Task 1 (comparator, all 7 bands tested for the key transitions); List → Task 2 (standalone, self-verifying); Board within-column → Task 3; optional List triage badge → Task 4; role split (CS unchanged) → `managerView` flag. Tasks 1-3 are pure reordering (no new UI); only Task 4 adds UI. ✓
- **Waiting-lâu:** band 2 includes `status==="waiting"` for ALL priorities, sorted longest-waiting first — matches "waiting lâu cũng lên trên". ✓
- **No thresholds:** "stuck/lâu" is surfaced by within-band sort (longest-in-state first), so there's no magic cutoff to tune and `sorting.ts` needs no settings access. (Future option: gate bands 2/5 on the reminder-settings hours if you later want a hard "only after N hours" cutoff.)
- **Board manual drag:** preserved within session; auto-rank is the reload/refetch base — matches the earlier "kéo tay được, reload thì auto" intent, now with the manager base order.
- **Type consistency:** `compareManagerRank`/`rankTasksForManager` signatures match `compareTaskRank`/`rankTasks` (same `(…, rules, now)` shape) so wiring mirrors the existing calls.
- **Watch-out:** `managerRankTuple` reads `task.assignees` (post-`attachAssigneesToTasks`) — both List and Board receive already-attached tasks, so `assignees` is populated; the `|| task.assignee_email` fallback covers any raw row.
