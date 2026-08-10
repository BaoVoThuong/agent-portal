# Assignee Task Signal Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an assignee two more personal signals on their task list — unread comments and
mentions — alongside the `NEW` badge that already exists, and pin any badged task directly below the
overdue band.

**Architecture:** No new tables and no new read-state store. `task_notifications` already records
per-recipient read state for `assigned`, `commented`, and `mentioned`, and the `NEW` badge already
rides on it end to end. This work extends that one path: return unread ids split by type, render two
more flags in the strip beside the title, clear all three types when the drawer opens, and insert a
ranking band.

**Tech Stack:** Next.js 16.2.4 App Router route handlers, React 19, TypeScript, Supabase,
Vitest (node environment), Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-08-10-assignee-task-signal-badges-design.md`

---

## Global Constraints

- **Next.js 16.2.4 is not the Next.js in your training data.** Before editing anything under
  `src/app/`, read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`.
- **Vitest collects `src/**/*.test.ts` only, in `environment: "node"`.** `.tsx` is not collected and
  there is no DOM harness, so anything to be tested must live in a pure `.ts` module. Component
  behaviour is verified in the browser, not by a test.
- Tests import explicitly: `import { describe, expect, it } from "vitest";` (`globals: false`), and
  import app code through the `@/` alias.
- **Keep `unreadAssignedTaskIds` in the API response.** Old browser tabs stay open across a deploy;
  removing the field breaks the `NEW` badge for anyone who has not reloaded.
- **Do not touch `NewAssignedBadge`.** `NEW` already works, including re-firing on reassignment.
  This plan adds two badges beside it; it does not reimplement it.
- **Do not add badges for `stage_changed`, `field_changed`, `priority_changed`,
  `attachment_added`, or `overdue`.** The first four fire constantly and would light every row;
  `overdue` already owns the band above and the `danger` tone.
- Every logic change gets a `changelog.md` entry (repo root) in the same commit.
- Commit per task. Stage only files owned by that task — this worktree has unrelated dirty files.
  Do not `git push` unless asked.

---

## File Structure

| Path | Change | Responsibility |
|---|---|---|
| `src/lib/tasks/signal-badges.ts` | Create | Pure badge model: shape, rank weight, count merge |
| `src/lib/tasks/signal-badges.test.ts` | Create | Tests for the above |
| `src/app/api/tasks/notifications/route.ts` | Modify | Return unread ids split by type |
| `src/app/(authed)/tasks/_components/TaskRowItem.tsx` | Modify | `RowFlagIcon` count prop; render two flags |
| `src/app/(authed)/tasks/_components/TaskBoardClient.tsx` | Modify | Load per-type ids; clear all three on open |
| `src/app/(authed)/tasks/_components/TaskCard.tsx` | Modify | Same two flags on the Kanban card |
| `src/lib/tasks/sorting.ts` | Modify | Insert the badge band in both rank tuples |
| `src/lib/tasks/sorting.test.ts` | Modify | Band ordering tests |

---

## Task 1: Pure badge model

Everything downstream needs one shared shape for "what is unread on this task for me". Defining it
first — in a `.ts` module, the only place Vitest can reach — keeps the ranking and the rendering
honest about the same data.

**Files:**
- Create: `src/lib/tasks/signal-badges.ts`
- Create: `src/lib/tasks/signal-badges.test.ts`

**Interfaces:**
- Produces: `type TaskSignalBadges = { assigned: boolean; comments: number; mentioned: boolean }`,
  `hasAnySignal(b)`, `signalRankWeight(b)`, `emptySignalBadges()`. Tasks 2–5 all consume these.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/signal-badges.test.ts
import { describe, expect, it } from "vitest";
import {
  emptySignalBadges,
  hasAnySignal,
  signalRankWeight,
  type TaskSignalBadges,
} from "@/lib/tasks/signal-badges";

const badges = (partial: Partial<TaskSignalBadges>): TaskSignalBadges => ({
  ...emptySignalBadges(),
  ...partial,
});

describe("hasAnySignal", () => {
  it("is false when nothing is unread", () => {
    expect(hasAnySignal(emptySignalBadges())).toBe(false);
  });

  it("is true for any single signal", () => {
    expect(hasAnySignal(badges({ assigned: true }))).toBe(true);
    expect(hasAnySignal(badges({ comments: 1 }))).toBe(true);
    expect(hasAnySignal(badges({ mentioned: true }))).toBe(true);
  });

  it("treats a zero comment count as no signal", () => {
    expect(hasAnySignal(badges({ comments: 0 }))).toBe(false);
  });
});

describe("signalRankWeight", () => {
  it("ranks mention above comments above assignment", () => {
    // Lower is higher in the list, matching the rank tuples in sorting.ts.
    const mention = signalRankWeight(badges({ mentioned: true }));
    const comment = signalRankWeight(badges({ comments: 3 }));
    const assigned = signalRankWeight(badges({ assigned: true }));

    expect(mention).toBeLessThan(comment);
    expect(comment).toBeLessThan(assigned);
  });

  it("ranks by the strongest signal present, not the sum", () => {
    // A mention plus comments is still a mention -- it must not outrank a
    // lone mention by accumulating weight.
    expect(signalRankWeight(badges({ mentioned: true, comments: 5 }))).toBe(
      signalRankWeight(badges({ mentioned: true }))
    );
  });

  it("sorts an unbadged task after every badged one", () => {
    expect(signalRankWeight(emptySignalBadges())).toBeGreaterThan(
      signalRankWeight(badges({ assigned: true }))
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/tasks/signal-badges.test.ts`
Expected: FAIL with "Cannot find module '@/lib/tasks/signal-badges'".

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/tasks/signal-badges.ts
// Per-viewer unread signals for one task, derived from task_notifications.
// There is no separate read-state store: a notification row IS the signal, and
// marking it read is what clears the badge.

export type TaskSignalBadges = {
  /** An unread `assigned` notification -- work arrived and has not been opened. */
  assigned: boolean;
  /** How many unread `commented` notifications. Zero means no badge. */
  comments: number;
  /** An unread `mentioned` notification -- someone asked for this person by name. */
  mentioned: boolean;
};

export function emptySignalBadges(): TaskSignalBadges {
  return { assigned: false, comments: 0, mentioned: false };
}

export function hasAnySignal(badges: TaskSignalBadges): boolean {
  return badges.assigned || badges.comments > 0 || badges.mentioned;
}

/**
 * Rank weight inside the badge band. Lower sorts higher, matching the rank
 * tuples in sorting.ts. Only the strongest signal counts: a mention plus five
 * comments is still a mention, and must not outrank a lone mention by
 * accumulating weight.
 */
export function signalRankWeight(badges: TaskSignalBadges): number {
  if (badges.mentioned) return 0;
  if (badges.comments > 0) return 1;
  if (badges.assigned) return 2;
  return 3;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/tasks/signal-badges.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/signal-badges.ts src/lib/tasks/signal-badges.test.ts changelog.md
git commit -m "feat(tasks): add per-viewer signal badge model"
```

---

## Task 2: Return unread ids split by type

`GET /api/tasks/notifications` runs five queries in one `Promise.all`. The fifth already fetches
unread assigned rows:

```ts
    supabase
      .from("task_notifications")
      .select("task_id")
      .eq("recipient_email", email)
      .eq("type", "assigned")
      .eq("is_read", false),
```

Widen it to all three types in the same round trip, and group in memory.

**Files:**
- Modify: `src/app/api/tasks/notifications/route.ts:43-48` (the query) and `:187-196` (the response)

**Interfaces:**
- Consumes: `TaskSignalBadges` (Task 1).
- Produces: response gains `signalBadges: Record<string, TaskSignalBadges>` keyed by task id.
  `unreadAssignedTaskIds` is retained unchanged. Task 3 consumes both.

- [ ] **Step 1: Widen the query**

```ts
    supabase
      .from("task_notifications")
      // All three badge types in one round trip. `type` is now selected because
      // the response groups by it; `assigned` alone is no longer enough.
      .select("task_id,type")
      .eq("recipient_email", email)
      .in("type", ["assigned", "commented", "mentioned"])
      .eq("is_read", false),
```

- [ ] **Step 2: Group into badges and keep the legacy field**

Replace the `unreadAssignedTaskIds` construction:

```ts
  const unreadSignalRows = (unreadAssignedRes.data ?? []) as {
    task_id: string;
    type: string;
  }[];

  const signalBadges: Record<string, TaskSignalBadges> = {};
  for (const row of unreadSignalRows) {
    const badges = (signalBadges[row.task_id] ??= emptySignalBadges());
    if (row.type === "assigned") badges.assigned = true;
    else if (row.type === "mentioned") badges.mentioned = true;
    else if (row.type === "commented") badges.comments += 1;
  }

  // Retained for browser tabs opened before this deploy: they read this field
  // and nothing else, so removing it would blank their NEW badges until reload.
  const unreadAssignedTaskIds = [
    ...new Set(
      unreadSignalRows.filter((n) => n.type === "assigned").map((n) => n.task_id)
    ),
  ];
```

and add `signalBadges` to the returned object beside `unreadAssignedTaskIds`.

Import at the top: `import { emptySignalBadges, type TaskSignalBadges } from "@/lib/tasks/signal-badges";`

- [ ] **Step 3: Verify**

Run: `npm run typecheck`

Manual: sign in, `curl` (or open) `/api/tasks/notifications`. Expected: `signalBadges` is an object
keyed by task id; a task with two unread comments and a mention reads
`{ assigned: false, comments: 2, mentioned: true }`. A viewer with nothing unread gets `{}`, not an
error. `unreadAssignedTaskIds` still lists the same ids it did before this change.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/tasks/notifications/route.ts" changelog.md
git commit -m "feat(tasks): return unread signal badges per type"
```

---

## Task 3: Render the two new flags

`RowFlagIcon` (`TaskRowItem.tsx:1143`) draws a fixed 20 px circular icon. `💬 n` needs a number, so
it gains an optional count. `TaskRowFlags` (`:1106`) gains the two flags; `NewAssignedBadge` beside
it is untouched.

**Files:**
- Modify: `src/app/(authed)/tasks/_components/TaskRowItem.tsx:1106-1167` and call sites `:343`, `:436`
- Modify: `src/app/(authed)/tasks/_components/TaskCard.tsx:105`

**Interfaces:**
- Consumes: `TaskSignalBadges`, `hasAnySignal` (Task 1).
- Produces: `TaskRowFlags` accepts `badges?: TaskSignalBadges`.

- [ ] **Step 1: Give `RowFlagIcon` an optional count**

```tsx
function RowFlagIcon({
  icon,
  title,
  tone,
  count,
}: {
  icon: ReactNode;
  title: string;
  tone: "danger" | "warning" | "info";
  /** When present the pill widens and shows the number after the icon. */
  count?: number;
}) {
  const className = {
    danger: "border-[#ffbdad] bg-[#ffebe6] text-[#bf2600]",
    warning: "border-[#f8e6a0] bg-[#fff7d6] text-[#7f5f01]",
    info: "border-[#b3d4ff] bg-[#deebff] text-[#0055cc]",
  }[tone];

  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center justify-center gap-0.5 rounded-full border ${
        count === undefined ? "w-5" : "min-w-5 px-1.5"
      } ${className}`}
      title={title}
      aria-label={title}
    >
      {icon}
      {count === undefined ? null : (
        <span className="text-[10px] font-bold leading-none">{count}</span>
      )}
    </span>
  );
}
```

Existing callers pass no `count`, so overdue, was-overdue, and reopened render byte-identically.

- [ ] **Step 2: Add the two flags to `TaskRowFlags`**

```tsx
function TaskRowFlags({
  task,
  isOverdue,
  badges,
}: {
  task: TaskRow;
  isOverdue: boolean;
  badges?: TaskSignalBadges;
}) {
  const wasOverdue = !isOverdue && task.overdue_count > 0;
  const mentioned = badges?.mentioned ?? false;
  const commentCount = badges?.comments ?? 0;
  if (
    !isOverdue &&
    !wasOverdue &&
    !task.reopened_at &&
    !mentioned &&
    commentCount === 0
  ) {
    return null;
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1" aria-label="Task flags">
      {/* Mention first: being named is the strongest call for this person. */}
      {mentioned ? (
        <RowFlagIcon
          title="You were mentioned in a comment."
          tone="warning"
          icon={<AtSign className="h-3 w-3" />}
        />
      ) : null}
      {commentCount > 0 ? (
        <RowFlagIcon
          title={`${commentCount} new comment${commentCount === 1 ? "" : "s"} since you last opened this.`}
          tone="info"
          icon={<MessageSquare className="h-3 w-3" />}
          count={commentCount}
        />
      ) : null}
      {isOverdue ? (
        <RowFlagIcon
          title="Overdue: this task is over its SLA."
          tone="danger"
          icon={<AlertTriangle className="h-3 w-3" />}
        />
      ) : null}
      {wasOverdue ? (
        <RowFlagIcon
          title={`Was overdue: this task went over its SLA ${task.overdue_count}x.`}
          tone="warning"
          icon={<AlertTriangle className="h-3 w-3" />}
        />
      ) : null}
      {task.reopened_at ? (
        <RowFlagIcon
          title="Reopened: this task was reopened."
          tone="info"
          icon={<RotateCcw className="h-3 w-3" />}
        />
      ) : null}
    </span>
  );
}
```

Import `AtSign` and `MessageSquare` from `lucide-react` alongside the existing icons.

- [ ] **Step 3: Thread `badges` through both row call sites and the Kanban card**

`TaskRowItem` gains a `badges?: TaskSignalBadges` prop and passes it to both `<TaskRowFlags>` usages
(`:344` and `:437`). `TaskCard` does the same beside its `NewAssignedBadge` at `:105`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint`

Browser: a task with no unread signals shows exactly the flags it showed before — `TaskRowFlags`
still returns `null` when there is nothing. A task with three unread comments shows a widened blue
pill reading `3`. Overdue and reopened flags are visually unchanged.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authed)/tasks/_components/TaskRowItem.tsx" \
  "src/app/(authed)/tasks/_components/TaskCard.tsx" changelog.md
git commit -m "feat(tasks): render mention and unread-comment flags"
```

---

## Task 4: Load per-type badges and clear all three on open

`TaskBoardClient` loads only assigned ids and, on drawer open, marks only `assigned` read
(`:363-372`). Both halves widen.

**Files:**
- Modify: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx:340-383`, `:742`

- [ ] **Step 1: Load the badge map**

Replace the `newAssignedTaskIds` state with a badge map, keeping the derived set for the existing
`NewAssignedBadge` prop:

```tsx
  const [signalBadges, setSignalBadges] = useState<Record<string, TaskSignalBadges>>(
    () => ({})
  );
  const newAssignedTaskIds = useMemo(
    () =>
      new Set(
        Object.entries(signalBadges)
          .filter(([, badges]) => badges.assigned)
          .map(([taskId]) => taskId)
      ),
    [signalBadges]
  );
```

and in the loader:

```tsx
      const data = (await res.json()) as {
        signalBadges?: Record<string, TaskSignalBadges>;
      };
      setSignalBadges(data.signalBadges ?? {});
```

- [ ] **Step 2: Clear all three types when the drawer opens**

```tsx
  const markTaskSignalsSeen = useCallback(
    (taskId: string) => {
      const badges = signalBadges[taskId];
      if (!badges || !hasAnySignal(badges)) return;

      setSignalBadges((current) => {
        if (!current[taskId]) return current;
        const next = { ...current };
        delete next[taskId];
        return next;
      });

      // Opening the task acknowledges every signal on it, not just the
      // assignment -- otherwise the comment badge would survive the read that
      // cleared NEW and the row would stay pinned.
      for (const type of ["assigned", "commented", "mentioned"] as const) {
        void fetch("/api/tasks/notifications/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, type }),
        }).catch(() => {});
      }
    },
    [signalBadges]
  );
```

Point the existing open-drawer effect (`:379-383`) at `markTaskSignalsSeen`, and pass
`badges={signalBadges[task.id]}` where `isNewAssigned` is currently passed (`:742` and the Kanban
call sites).

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run`

Browser, two accounts: A comments on B's task → B sees `💬 1`; a second comment → `💬 2`; B opens
the drawer → both the badge and `NEW` clear, and stay cleared after a reload. A mentions B → `@`
appears next to `💬`. B comments on B's own task → **no badge** (the recipient resolver already
excludes the actor).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(authed)/tasks/_components/TaskBoardClient.tsx" changelog.md
git commit -m "feat(tasks): load signal badges and clear all types on open"
```

---

## Task 5: Pin badged tasks below overdue

**Files:**
- Modify: `src/lib/tasks/sorting.ts:200-248` and the manager tuple
- Modify: `src/lib/tasks/sorting.test.ts`

**Interfaces:**
- Consumes: `hasAnySignal`, `signalRankWeight` (Task 1).
- Produces: `rankTasks` and `rankTasksForManager` accept an optional
  `badgesByTask?: Record<string, TaskSignalBadges>`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to src/lib/tasks/sorting.test.ts
import { rankTasks } from "@/lib/tasks/sorting";
import { emptySignalBadges } from "@/lib/tasks/signal-badges";

describe("signal badge band", () => {
  it("places a badged task above a recently active one and below an overdue one", () => {
    const ranked = rankTasks([recentlyActive, badgedTask, overdueTask], rules, now, {
      [badgedTask.id]: { ...emptySignalBadges(), comments: 1 },
    });
    expect(ranked.map((t) => t.id)).toEqual([
      overdueTask.id,
      badgedTask.id,
      recentlyActive.id,
    ]);
  });

  it("orders mention above comments above assignment inside the band", () => {
    const ranked = rankTasks([assignedOnly, commented, mentioned], rules, now, {
      [assignedOnly.id]: { ...emptySignalBadges(), assigned: true },
      [commented.id]: { ...emptySignalBadges(), comments: 2 },
      [mentioned.id]: { ...emptySignalBadges(), mentioned: true },
    });
    expect(ranked.map((t) => t.id)).toEqual([
      mentioned.id,
      commented.id,
      assignedOnly.id,
    ]);
  });

  it("does not pin a closed task even when it carries a badge", () => {
    // A late comment on finished work must not outrank live work.
    const ranked = rankTasks([closedBadged, plainOpen], rules, now, {
      [closedBadged.id]: { ...emptySignalBadges(), comments: 1 },
    });
    expect(ranked[0].id).toBe(plainOpen.id);
  });

  it("is inert when no badges are supplied", () => {
    const withArg = rankTasks([recentlyActive, plainOpen], rules, now, {});
    const without = rankTasks([recentlyActive, plainOpen], rules, now);
    expect(withArg.map((t) => t.id)).toEqual(without.map((t) => t.id));
  });
});
```

Build the fixtures from the factory the existing tests in this file already use.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/tasks/sorting.test.ts`
Expected: FAIL — `rankTasks` takes three arguments today.

- [ ] **Step 3: Insert the band**

Thread an optional `badgesByTask` through `rankTasks`, `compareTaskRank`, and `rankTuple`, defaulting
to `{}`. In `rankTuple`, after the overdue branch:

```ts
  const badges = badgesByTask[task.id];
  // Pin only OPEN work. A closed task with a late comment still shows its
  // badge, but must not outrank live work.
  if (badges && hasAnySignal(badges) && OPEN_STATUSES.has(task.status)) {
    // Oldest unread first within a weight: a task ignored for three days
    // outranks one commented on five minutes ago.
    return [1, signalRankWeight(badges), timestamp(task.last_activity_at)];
  }
```

and renumber the two branches below it from `1, 2` to `2, 3`. Apply the same insertion to
`managerRankTuple` directly after its overdue band, shifting its remaining bands down by one.

`OPEN_STATUSES` already exists at `sorting.ts:250`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/tasks/sorting.test.ts`
Expected: PASS, including the 13 tests that predate this task.

- [ ] **Step 5: Pass badges from the list**

`TaskListView` and `KanbanBoard` call `rankTasks` / `rankTasksForManager`; hand them the
`signalBadges` map from Task 4.

- [ ] **Step 6: Verify**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run build`

Browser: a task with an unread comment sits directly below the overdue block and above everything
else; opening it drops the task back into its normal position on the next load. Explicit column
sorting still overrides the ranking entirely — clicking a header must behave exactly as before.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tasks/sorting.ts src/lib/tasks/sorting.test.ts \
  "src/app/(authed)/tasks/_components/TaskListView.tsx" \
  "src/app/(authed)/tasks/_components/KanbanBoard.tsx" changelog.md
git commit -m "feat(tasks): pin tasks carrying unread signals below overdue"
```

---

## Acceptance criteria

- A task with no unread signals renders exactly as it does today, and `TaskRowFlags` still returns
  `null` when nothing applies.
- `NEW` behaves exactly as before, including re-firing when a task is reassigned to someone who had
  already opened it.
- Unread comments show a count; a second comment increments it.
- A mention renders beside the comment flag and ranks above it.
- Commenting on your own task produces no badge for you.
- Opening the drawer clears all three signals for that task, and they stay cleared after a reload.
- A badged **open** task sorts directly below the overdue band; a badged **closed** task does not.
- Explicit column sorting is unaffected.
- `unreadAssignedTaskIds` is still returned, so a tab opened before the deploy keeps working.
- `npx vitest run && npm run typecheck && npm run lint && npm run build` all pass.

## Execution Log

| Task | Status | Commit | Verification | Notes |
|---|---|---|---|---|
| 1. Badge model | Pending | — | — | Pure `.ts` — the only layer Vitest can reach |
| 2. API per type | Pending | — | — | Must keep `unreadAssignedTaskIds` |
| 3. Render flags | Pending | — | — | Do not touch `NewAssignedBadge` |
| 4. Load + clear | Pending | — | — | Clear all three types, not just `assigned` |
| 5. Ranking band | Pending | — | — | Open statuses only |
