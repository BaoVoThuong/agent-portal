# Bug — two quick assignee changes in a row produce a false conflict

**Found:** 2026-08-21 · **Reported by:** Bao Vo · **Diagnosed against:** `743855a`
**Status:** fixed
**Severity:** medium — no data is lost or corrupted, but a normal correction is refused and the message blames the wrong thing

---

## What the user sees

In the CS task drawer:

1. Open a task, add a second assignee.
2. About a second later, remove that same person.
3. A red banner appears: **"Task was updated by someone else. Refresh and try again."**
4. The list still shows both people — the removal did not take.
5. Close the assignee dropdown, reopen it, remove again. **Now it works.**

The message is misleading in two ways: nobody else touched the task, and closing the dropdown is not what fixes it.

## Why it matters beyond the annoyance

Adding the wrong person and immediately correcting it is the most natural way to use this control. The banner tells the user another person is editing the task, so the honest reaction is to stop and go ask a colleague who never touched it. The real remedy — wait a moment and try again — is not discoverable from anything on screen.

---

## Root cause

Three separate facts combine. None is a bug on its own.

### 1. The optimistic row keeps the old `updated_at`

`src/app/(authed)/tasks/_components/TaskBoardClient.tsx:1516-1526`

```ts
    const optimistic: TaskRow = {
      ...before,
      assignees: nextAssignees,
      assignee_email: nextAssignees[0] ?? null,
      status: nextStatus,
      todo_started_at:
        before.status === "backlog" && nextStatus === "todo"
          ? nowIso
          : before.todo_started_at,
    };
    updateTasks((cur) => cur.map((task) => (task.id === id ? optimistic : task)));
```

`updated_at` is inherited from `...before` and never touched. That is correct on its own — only the server decides the new timestamp — but it means local state carries a **stale** `updated_at` for as long as the request is in flight.

### 2. The write commits early; the response returns late

`src/app/api/tasks/[id]/assignees/route.ts`

The row is written by `patch_task_atomic` near the top of the handler. Everything below still runs **before** the response is sent:

| Line | Work still to do after the commit |
|---|---|
| 147 | query `task_sla_rules` |
| 154 | `await bumpAssignmentRotation(...)` |
| 169 | `await Promise.allSettled([ insertNotifications(...) ])` |
| 195 | `await Promise.allSettled([ broadcastTasksChanged, broadcastTaskRoom ])` |
| 210 | `attachAssigneesToTasks(...)` |
| 220 | `return NextResponse.json({ task, warnings })` |

The broadcasts at line 195 are the slow part. From `src/lib/tasks/realtime.ts`:

```
BROADCAST_MAX_ATTEMPTS      = 2
BROADCAST_RETRY_DELAY_MS    = 150
BROADCAST_ATTEMPT_TIMEOUT_MS = 1_500
```

Two broadcasts, each up to two attempts of 1.5 s plus a 150 ms pause. If Supabase Realtime is slow or unreachable, the response can take **over three seconds** even though the database finished in milliseconds.

So there is a window — potentially seconds long — where the database already holds the new `updated_at` and the browser does not.

### 3. Nothing serialises consecutive assignee changes

`changeAssignee` (`TaskBoardClient.tsx:1501`) is a plain `async function`. It reads

```ts
    const before = tasks.find((t) => t.id === id) ?? null;
```

and sends `expected_updated_at: before.updated_at` (line 1537).

Compare `patchTask` in the same file, which does have serialisation: a per-task `state.tail` promise chain, a `state.confirmed` row, and `rebasePendingTaskPatches` to rebase queued edits. `changeAssignee` has none of it. `beginTaskMutation` only **counts** in-flight mutations so background refetches can be deferred — it does not queue anything, so a second click fires immediately against stale state.

### The sequence

```
t = 0 ms      Add B  → optimistic [A, B], updated_at = T0
t = ~20 ms    Database commits, updated_at = T1     ← browser does not know yet
              (response still blocked on notifications + 2 broadcasts)

t = 1000 ms   Remove B → reads `before` from state
                       → updated_at is still T0
                       → DELETE sends expected_updated_at = T0

t = ~1010 ms  Server: T0 ≠ T1 → TASK_CONFLICT → HTTP 409
                       → client rolls back to [A, B]   ← "still shows 2 people"

t = ~2000 ms  The ADD response finally arrives
                       → replaceTask(T1) — state is correct from here on
```

**The dropdown is a red herring.** Closing and reopening it changes nothing about the data; it simply takes long enough that the add's response lands in the meantime. Clicking remove a second time without touching the dropdown should work equally well.

### Confirming it in one step

Add an assignee, **wait three or four seconds**, then remove them. If that never fails while the fast version reliably does, the diagnosis is confirmed and no further investigation is needed.

---

## What this is *not*

Ruled out while diagnosing, recorded so nobody re-treads it:

- **Not the realtime/live-sync work.** The reconcile path guards correctly: `taskRefetchDisposition` defers while a mutation is pending and retries when the write version moved.
- **Not `replaceTask`.** It spreads `...updated`, so the server's `updated_at` is applied in full (`:1248-1260`).
- **Not the routes failing to return the row.** Both `POST /assignees` and `DELETE /assignees/[email]` return `{ task, warnings }` (`:220` and `:184`), and the client applies it (`:1568`).
- **Not the assignee picker.** `TaskAssigneePicker` holds no selection state — `selectedEmails` is a prop and `selected` is derived from it. Only the search `query` is local.
- **Not the drawer writing back a stale timestamp.** `onParentUpdatedAt` does write `updated_at` unconditionally (`:2039-2043`), but it is only ever called after a comment is posted, edited or deleted (`CommentThread.tsx:1005` and `:1234`) — not in this scenario. `onMetadataUpdated` never touches `updated_at`.
- **Not a second server-side write.** Nothing after `patch_task_atomic` in either route writes to `tasks`; `bumpAssignmentRotation` touches the assignment queue and notifications go to `task_notifications`.
- **Not timestamp precision.** `patch_task_atomic` sets `updated_at = p_now` and returns the post-update row (`to_jsonb(next_task)`), so what the client receives is exactly what was stored.

---

## Proposed fix

Two changes. The first closes the race; the second makes it far less likely to be hit at all. **Doing only the second leaves the bug reachable.**

### A. Serialise assignee mutations and read the confirmed timestamp

Give `changeAssignee` the same treatment `patchTask` already has: a per-task queue so a second change waits for the first, and `expected_updated_at` taken from the **last confirmed server row** rather than from React state.

This is the actual fix. It also covers the neighbouring cases — adding two people quickly, or removing two — which fail the same way today.

### B. Stop awaiting broadcasts before responding

The database has already committed by the time line 195 runs. Broadcasting is a side effect: `settleSideEffects` exists precisely to report those as warnings rather than block. Returning the response first and letting the broadcast settle afterwards cuts the response from seconds to milliseconds.

Trade-off worth naming: the client would no longer learn about a broadcast failure in the same response. That is acceptable — reconnect, focus and the periodic reconcile all repair a missed broadcast — but it is a deliberate change, not a free one.

Implemented: assignee writes now share the task mutation queue, and both assignee routes schedule broadcasts with Next's `after()` hook after the committed response is ready.

### Rejected

**Disabling the control while a request is in flight.** It hides the symptom, does not fix the race, and makes the dropdown feel unresponsive for exactly as long as the slow response takes — which is the thing that is already wrong.

---

## Related

The same shape exists anywhere a mutation sends `expected_updated_at` read from React state without queueing. `patchTask` is safe. Worth checking `reopenTask`, `unlockOverdueTask` and `reviewDoneTask` in the same file before closing this out — they follow `changeAssignee`'s structure, not `patchTask`'s.
