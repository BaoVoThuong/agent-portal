# Live-Sync Review Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three defects found reviewing the uncommitted live-sync work: a write amplification loop where a single field edit fires four HTTP requests, a notification fallback that only repairs one task per batch, and a piece of dead code.

**Architecture:** All three are client-side. No schema change, no API change, no new module. The pattern for the first fix already exists in this codebase — `TaskDetailDrawer` filters its own invalidations by `sourceId`; `TaskBoardClient` simply never adopted it.

**Tech Stack:** Next.js 16.2.4 App Router, React client components, vitest 2.1.9.

## Status of the code under review

Uncommitted at the time of writing: 29 modified files, 5 new, ~983 insertions, on top of `2e12060`. It typechecks clean, passes 689 tests, and adds no new lint errors. The defects below are behavioural, not mechanical — no tool catches them.

## Global Constraints

- **UI copy is English only.** Code comments may stay Vietnamese; anything a user reads may not.
- **Test harness cannot render components.** `vitest.config.ts` is `environment: "node"`, `include: ["src/**/*.test.ts"]` — no jsdom, `.tsx` not collected. Task 2's logic is extractable and testable; Tasks 1 and 3 are not, and are verified by hand.
- **`changelog.md` records logic changes.** Tasks 1 and 2 earn an entry; Task 3 is dead-code removal and does not.
- **Do not commit or push without being asked.** Each is a separate request and the remote must be named: `origin` is BaoVoThuong/agent-portal, `vercel` is the separate repo eps-portal.vercel.app deploys from.

---

## Bug 1 — one field edit fires four HTTP requests

**Severity: high.** This lands in a change whose own commit is titled *"perf(tasks): reduce task detail latency"*.

`beginTaskMutation`'s finisher publishes on every committed mutation — `TaskBoardClient.tsx:1174`:

```ts
      if (committed) publishTaskDataInvalidation({ taskId: id });
```

and the board subscribes to its own publications — `TaskBoardClient.tsx:629`:

```ts
    return subscribeTaskDataInvalidation(scheduleTaskReconcile);
```

`scheduleTaskReconcile` takes no argument. It discards the `TaskDataInvalidation` entirely, including `sourceId` — the field added for exactly this filtering, and used only by the drawer (`TaskDetailDrawer.tsx:243-250`).

Drawer edits route through the board: `onPatch={(patch) => patchTask(openTask.id, patch)}` at `TaskBoardClient.tsx:2001`. So blurring one field in the drawer produces:

| # | Request | Justified? |
|---|---|---|
| 1 | `PATCH /api/tasks/{id}` | yes — the write |
| 2 | `GET /api/tasks/{id}/detail` | yes — the patch writes a `task_activity` row the Activity tab should show |
| 3 | `GET /api/tasks` | **no** — the board already applied the confirmed row from the PATCH response |
| 4 | `GET /api/tasks/categories` | **no** — categories are config; a task edit cannot change them |

Requests 3 and 4 come from `reconcileTaskData` (`TaskBoardClient.tsx:581-600`), which unconditionally bundles `refetchTasks()` **and** `reloadCategories()`, plus the overview query when a manager is on that view.

Both wasted requests must keep firing for **other** tabs — a sibling tab that knows nothing about the edit does need the refetch. The cross-tab path carries `origin: "storage"` and never has a `sourceId`, so filtering on `sourceId` fixes the local waste without touching cross-tab behaviour.

### Task 1: Skip the board's own invalidations, and stop reloading config on task edits

**Files:**
- Modify: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx` — import line 4, `reconcileTaskData` 581, `scheduleTaskReconcile` 609, subscriber 629, publishes at 1174, 1537, 1577

- [ ] **Step 1: Give the board a stable source id**

`useId` is not currently imported in this file. Add it to the existing React import on line 4:

```ts
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
```

and declare it beside the other board-level state (near `taskLiveStatus`, around line 197):

```ts
  // Identifies invalidations this board published, so its own writes do not
  // trigger a full-list refetch it already has the answer to. Sibling tabs
  // receive the same event through localStorage with origin "storage" and no
  // sourceId, so they still reconcile.
  const boardInvalidationSourceId = useId();
```

- [ ] **Step 2: Tag every board publish**

Three call sites. Each gains `sourceId: boardInvalidationSourceId`:

`:1174`
```ts
      if (committed) {
        publishTaskDataInvalidation({
          taskId: id,
          sourceId: boardInvalidationSourceId,
        });
      }
```

`:1537` (inside `assignOverviewTask`)
```ts
      publishTaskDataInvalidation({
        taskId,
        sourceId: boardInvalidationSourceId,
      });
```

`:1577` (inside `createTask`)
```ts
    publishTaskDataInvalidation({
      taskId: created.id,
      sourceId: boardInvalidationSourceId,
    });
```

**Note on `beginTaskMutation`:** it is a plain function, not a hook, but it closes over component scope, so `boardInvalidationSourceId` is in scope. Confirm that when editing — if it has been hoisted out of the component by the time you get there, thread the id through instead of reaching for a module-level variable.

- [ ] **Step 3: Filter in the subscriber, and scope what a task invalidation reconciles**

Replace the subscriber at `:629`:

```ts
  useEffect(() => {
    return subscribeTaskDataInvalidation(scheduleTaskReconcile);
  }, [scheduleTaskReconcile]);
```

with:

```ts
  useEffect(() => {
    return subscribeTaskDataInvalidation((invalidation) => {
      // Our own write: the PATCH response already produced the canonical row.
      if (
        invalidation.origin === "document" &&
        invalidation.sourceId === boardInvalidationSourceId
      ) {
        return;
      }
      // A task-scoped invalidation means task rows changed. Categories are
      // config and cannot change because someone edited a task, so only a
      // broad invalidation — or reconnect/focus/interval — reloads them.
      scheduleTaskReconcile({ tasksOnly: Boolean(invalidation.taskId) });
    });
  }, [boardInvalidationSourceId, scheduleTaskReconcile]);
```

- [ ] **Step 4: Teach the reconcile pair to accept that scope**

`scheduleTaskReconcile` (`:609`) currently takes no argument and always calls `reconcileTaskData()`. Give both an options object, defaulting to the current full behaviour so reconnect, focus, `online` and the interval are unchanged:

```ts
  const reconcileTaskData = useCallback(
    ({ tasksOnly = false }: { tasksOnly?: boolean } = {}): Promise<void> => {
```

and inside its loop, replace the unconditional pair:

```ts
        const refreshes: Promise<unknown>[] = [refetchTasks()];
        if (!tasksOnly) refreshes.push(reloadCategories());
        if (isManager && viewRef.current === "overview") {
```

then thread the same option through `scheduleTaskReconcile`:

```ts
  const scheduleTaskReconcile = useCallback(
    (options: { tasksOnly?: boolean } = {}) => {
      if (taskReconcileTimerRef.current) {
        clearTimeout(taskReconcileTimerRef.current);
      }
      taskReconcileTimerRef.current = setTimeout(() => {
        taskReconcileTimerRef.current = null;
        void reconcileTaskData(options);
      }, TASK_LIVE_EVENT_DEBOUNCE_MS);
    },
    [reconcileTaskData],
  );
```

**Read the coalescing carefully before finishing.** `reconcileTaskData` de-duplicates concurrent calls by returning `taskReconcileInFlightRef.current`, and `scheduleTaskReconcile` keeps only the last timer. So a `tasksOnly: true` call arriving while a full reconcile is in flight is dropped — which is fine — but a full reconcile arriving while a `tasksOnly` one is in flight is **also** dropped, and categories would not reload. Decide deliberately: either let the queued flag remember that a full pass is owed, or accept it because reconnect/focus/interval will do a full pass within 60 seconds anyway. The simpler second option is acceptable; write it down in a comment either way rather than leaving it implicit.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit && npx eslint "src/app/(authed)/tasks/_components/TaskBoardClient.tsx"
```
Expected: both clean.

- [ ] **Step 6: Verify by hand — this is the only real proof**

`npm run dev`, open DevTools → Network, filter XHR, then:

1. Open a task, edit Description, click away. **Expect exactly two requests:** `PATCH /api/tasks/{id}` and `GET /api/tasks/{id}/detail`. Before this fix there were four.
2. Drag a card between columns. **Expect one:** the `PATCH`. No `GET /api/tasks`, no `GET /api/tasks/categories`.
3. Open the same board in a second tab. Edit a task in tab A. **Tab B must still refetch** — that is the cross-tab path this fix must not break, and the step most likely to be skipped.
4. In the config screen, change a category, and confirm the board still picks it up.

---

## Bug 2 — only the first task in a notification batch gets repaired

**Severity: medium.** `NotificationBell.tsx:253-258`:

```ts
      const unseenTask = unseen.find(
        (notification) => entityKind(notification) === "task",
      );
      if (unseenTask) {
        publishTaskDataInvalidation({ taskId: entityId(unseenTask) });
      }
```

`find` returns one. The drawer filters `if (invalidation.taskId && invalidation.taskId !== task.id) return` (`TaskDetailDrawer.tsx:249`).

So: an agent has TASK-10 open; a poll brings notifications for TASK-7 and TASK-10; `find` returns TASK-7; the drawer sees a foreign id and does nothing. The open task stays stale.

The board is unaffected — it ignores `taskId` — so only the drawer suffers. The task-room subscription usually masks this. But the comment directly above this code states its purpose is to repair *"even when the separate global tasks-stream ping was missed"* — that is, when realtime is unreliable, which is exactly when the room ping is also missing.

### Task 2: Invalidate every task named in the batch

**Files:**
- Create: `src/lib/tasks/notification-invalidation.ts`
- Test: `src/lib/tasks/notification-invalidation.test.ts`
- Modify: `src/app/(authed)/_components/NotificationBell.tsx:253-258`

The decision is pure and therefore testable, unlike the component it lives in. Extracting it is what makes this fixable under a node-only test harness.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/notification-invalidation.test.ts
import { describe, expect, it } from "vitest";
import { resolveNotificationInvalidation } from "./notification-invalidation";

describe("resolveNotificationInvalidation", () => {
  it("returns nothing when no task notification is unseen", () => {
    expect(
      resolveNotificationInvalidation([{ kind: "enrollment", id: "e1" }])
    ).toBeNull();
  });

  it("returns nothing for an empty batch", () => {
    expect(resolveNotificationInvalidation([])).toBeNull();
  });

  it("scopes to the single task when the batch names only one", () => {
    expect(
      resolveNotificationInvalidation([
        { kind: "task", id: "t1" },
        { kind: "enrollment", id: "e1" },
      ])
    ).toEqual({ taskId: "t1" });
  });

  it("scopes to that one task even when it appears twice", () => {
    expect(
      resolveNotificationInvalidation([
        { kind: "task", id: "t1" },
        { kind: "task", id: "t1" },
      ])
    ).toEqual({ taskId: "t1" });
  });

  it("drops the scope when the batch names several tasks", () => {
    // A taskId-scoped invalidation is ignored by any drawer showing a
    // different task, so a multi-task batch must invalidate broadly or the
    // open drawer silently misses its own update.
    expect(
      resolveNotificationInvalidation([
        { kind: "task", id: "t1" },
        { kind: "task", id: "t2" },
      ])
    ).toEqual({});
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/tasks/notification-invalidation.test.ts`
Expected: FAIL — `Failed to resolve import "./notification-invalidation"`.

- [ ] **Step 3: Implement**

```ts
// src/lib/tasks/notification-invalidation.ts

export type NotificationEntity = { kind: "task" | "enrollment"; id: string };

/**
 * Decides what a batch of newly-seen notifications should invalidate.
 *
 * `null` means publish nothing. `{ taskId }` scopes the invalidation so an open
 * drawer for that task reloads. `{}` invalidates broadly, which is required
 * once more than one task is involved: a drawer ignores any invalidation whose
 * taskId is not its own, so scoping to one of several would leave the others
 * stale — including, possibly, the one the user is looking at.
 */
export function resolveNotificationInvalidation(
  entities: readonly NotificationEntity[],
): { taskId?: string } | null {
  const taskIds = new Set(
    entities.filter((entity) => entity.kind === "task").map((entity) => entity.id),
  );
  if (taskIds.size === 0) return null;
  if (taskIds.size === 1) return { taskId: [...taskIds][0] };
  return {};
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run src/lib/tasks/notification-invalidation.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Use it in the bell**

Replace `NotificationBell.tsx:253-258` with:

```ts
      const invalidation = resolveNotificationInvalidation(
        unseen.map((notification) => ({
          kind: entityKind(notification),
          id: entityId(notification),
        })),
      );
      if (invalidation) publishTaskDataInvalidation(invalidation);
```

and import it:

```ts
import { resolveNotificationInvalidation } from "@/lib/tasks/notification-invalidation";
```

`entityKind` and `entityId` are already defined in that file — `entityKind` maps anything that is not `"enrollment"` to `"task"`, and `entityId` falls back to `task_id`.

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit && npx vitest run && npm run build
```
Expected: all clean; the suite goes from 689 to 694.

By hand: open TASK-A in the drawer, then from another account comment on TASK-A **and** on TASK-B so both notifications arrive in one poll. TASK-A's drawer must pick up the new comment. Before the fix it does so only if TASK-A happens to be first in the list.

---

## Bug 3 — dead reset in the drawer

**Severity: trivial, but it carries a comment that asserts something false.**

`TaskDetailDrawer.tsx:411-412` resets `descriptionExpanded` when `task.id` changes, with a comment claiming *"the drawer is reused across tasks rather than remounted"*. It is not: `TaskBoardClient.tsx:1943` renders `<TaskDetailDrawer key={openTask.id} …>`, so React remounts on every task change and `useState(false)` already re-initialises. The comment is wrong and the next reader will believe it.

(This was mine, added on 2026-08-19. The key was pre-existing — I did not check for it.)

### Task 3: Remove it

**Files:**
- Modify: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`

- [ ] **Step 1: Delete the block**

```tsx
  // Collapse again when a different task is opened: the drawer is reused across
  // tasks rather than remounted, so this would otherwise carry over. Adjusted
  // during render rather than in an effect — that is React's documented pattern
  // for resetting state on a prop change, and react-hooks flags the effect form.
  const [collapseSyncedTaskId, setCollapseSyncedTaskId] = useState(task.id);
  if (collapseSyncedTaskId !== task.id) {
    setCollapseSyncedTaskId(task.id);
    setDescriptionExpanded(false);
  }
```

- [ ] **Step 2: Verify the assumption before trusting this plan**

```bash
grep -n "key={openTask.id}" "src/app/(authed)/tasks/_components/TaskBoardClient.tsx"
```
Expected: one hit, on the `<TaskDetailDrawer>` element. **If that key is gone, do not delete the block** — restore or re-add the key, or keep the reset.

- [ ] **Step 3: Verify by hand**

`npm run dev`: open a task with a long description, press **Show more**, close, open a *different* long-description task. Its description must start collapsed.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit && npx eslint "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx"
```

---

## Not fixed — watch instead

**The removed recent-write guard.** `mergeRefetchedTasks` and `recentTaskWritesRef` are gone, replaced by `authoritativeTaskSnapshot`, which returns the server list verbatim. The deleted code carried a comment stating the version/pending guards *"don't fully rule out"* a refetch response reflecting a slightly-behind snapshot, and that the cooldown was *"what stops a just-moved card from flashing back to its old column for ~1s"*.

The stated reason for removing it — a time-based cooldown can permanently swallow another agent's update — is sound, and the replacement is more correct in that respect. But nothing now addresses the race the old comment described.

Traced end to end, the sequence is safe: the reconcile fires 300ms *after* the PATCH commits, and Supabase PostgREST reads the primary, so the refetch cannot return a pre-PATCH snapshot. Task 1 shrinks the exposure further by removing that refetch entirely for local writes.

**What to watch for:** a card visibly snapping back to its previous column or status for about a second after a drag, under load or on a slow connection. If that reappears, the fix is a narrow one — re-apply the local row only for tasks with an in-flight or just-settled mutation — not a return to the blanket 3-second cooldown.

---

## Changelog

Add at the top of `changelog.md`, under the header block, once Tasks 1 and 2 are done:

```markdown
## 2026-08-20 — Sửa khuếch đại request và lỗ hổng repair của notification
- **Loại**: fix, performance, reliability
- **Cái gì**: Board không còn tự reconcile cho chính mutation của nó — publish kèm `sourceId` riêng và bỏ qua event `origin: "document"` trùng id, giống cách drawer đã làm. Invalidation có `taskId` chỉ refetch danh sách task, không kéo theo `reloadCategories`. NotificationBell invalidate theo TẤT CẢ task trong đợt thay vì `find` lấy một cái.
- **Vì sao**: Sửa một ô trong drawer đang sinh 4 request — PATCH, `/detail`, `/api/tasks`, `/api/tasks/categories` — trong đó hai cái cuối không mang thông tin gì mới vì response của PATCH đã trả về bản ghi chuẩn, còn category là config không thể đổi vì ai đó sửa task. Với `find`, một đợt noti gồm nhiều task chỉ invalidate task đầu tiên; drawer lọc theo `taskId` nên task đang mở bị bỏ sót đúng lúc realtime hỏng — trường hợp mà đoạn code đó sinh ra để cứu.
- **File**: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`, `src/app/(authed)/_components/NotificationBell.tsx`, `src/lib/tasks/notification-invalidation.ts`
- **Ảnh hưởng**: Cross-tab không đổi — event qua localStorage mang `origin: "storage"` và không có `sourceId` nên tab khác vẫn reconcile đầy đủ. Reconnect, focus, online và chu kỳ nền vẫn chạy reconcile đầy đủ gồm cả categories. Không đổi schema, không đổi contract API.
```
