# Enrollment Signal Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the signal badges already shipped on Health CS to Enrollment (ACA + Medicare), and
close the one behavioural gap that stops a tagged person from staying informed.

**Architecture:** Reuse `src/lib/tasks/signal-badges.ts` unchanged — the badge model is
product-agnostic. `enrollment_notifications` already carries `assigned`, `mentioned`, and
`commented`, and already sends them to the right people, so most of this is exposing data that
exists. The one real gap is that Enrollment has no participant concept: a person who was tagged
stops being notified once the conversation moves on. That is closed by deriving watchers from past
`mentioned` notifications rather than by adding a table.

**Tech Stack:** Next.js 16.2.4 App Router route handlers, React 19, TypeScript, Supabase,
Vitest (node environment), Tailwind, lucide-react.

**Prior art:** `docs/superpowers/plans/2026-08-10-assignee-task-signal-badges.md` (the CS version,
shipped in commits `8d4843b`..`51f9cf1`). Read it before starting — this plan deliberately mirrors
it and only documents the differences in depth.

---

## 1. What already works, and what does not

Verified against `HEAD 51f9cf1` while writing this plan.

| Behaviour | Health CS | Enrollment |
|---|---|---|
| `assigned` / `mentioned` / `commented` notification types exist | ✅ | ✅ `schema.sql:4165-4169` |
| Notifications actually written on comment | ✅ | ✅ `enrollment/[id]/comments/route.ts:154-170` |
| `assigned` sent to the right people | ✅ | ✅ `enrollment/[id]/route.ts:531-538` → `[caller_email, responsible_enroll_email]` |
| A tagged **outsider** is notified | ✅ | ✅ mentions resolve against all active `portal_account` |
| A tagged outsider keeps getting later comments | ✅ via `task_participants` | ❌ **gap — see §2** |
| Badge rendered in the list | ✅ | ❌ `EnrollmentClient` has zero badge components |
| Unread ids exposed per record | ✅ `signalBadges` | ❌ only a total unread **count** |
| Badged rows pinned to the top | ✅ band in `rankTuple` | ❌ Enrollment has no ranking at all |

**Ownership model differs and that is fine.** CS has `task_assignees`; Enrollment has
`caller_email` and `responsible_enroll_email` (`agent_email` is deliberately *not* an owner for this
purpose — it is the customer-relationship owner, and the existing notification code already excludes
it). No role check is needed anywhere in this plan: the badge is simply "you have an unread
notification on this record", and the recipient resolver already encodes who cares. That is exactly
how CS works today.

---

## 2. The gap: a tagged person stops hearing about the thread

`enrollment/[id]/comments/route.ts:127-140` builds watchers from comment authors:

```ts
    loaded.supabase
      .from("enrollment_comments")
      .select("author_email")
      .eq("record_id", id)
      .is("deleted_at", null),
...
  const threadWatchers = ((authorsRes.data ?? []) as { author_email: string }[]).map(
    (row) => row.author_email
  );
```

So you become a watcher by **writing** a comment. Being tagged does not make you one. Tag someone
who is neither caller nor responsible, and:

1. They get one `mentioned` notification. Good.
2. The next comment notifies `caller + responsible + authors`. They are in none of those.
3. They hear nothing more, on a thread they were explicitly pulled into.

CS does not have this problem because a mention inserts a `task_participants` row
(`schema.sql:2028`) and `resolveCommentRecipients:67` includes participants in `commentTargets`.

### Fix: derive watchers from past mentions, not a new table

```sql
select distinct recipient_email
  from enrollment_notifications
 where record_id = $1 and type = 'mentioned'
```

Anyone ever tagged on this record is a watcher from then on. This needs no schema change, no
backfill, and no new write path — the rows already exist, written by the code that sends the
mention.

**Alternative considered and rejected:** an `enrollment_participants` table mirroring
`task_participants`. It is the more symmetrical design, but it needs a table, a write inside the
comment path, and a backfill for every mention already sent. The derived query gets the same
behaviour from data that is already there, including retroactively.

**Consequence to accept:** a watcher can never un-follow, because the `mentioned` notification is
permanent. CS has the same property — `task_participants` rows are never removed on un-mention
either — so this at least keeps the two products consistent. If un-following is wanted later it is a
product decision for both, not a difference between them.

---

## 3. Ranking: badge-first, nothing else

CS inserted a band into an existing four-band ranking. **Enrollment has no ranking** — the list is
sorted purely by whichever column the user picked (`EnrollmentClient` `sort.key` / `sort.dir`).

Building a full band system for Enrollment would change how every user's list behaves and is out of
scope. This plan does the minimum that satisfies "a badged record jumps to the top":

> Records carrying any unread signal are moved to the front, in badge-weight order
> (`@` → `💬` → `NEW`). Everything else keeps its current relative order under the active column
> sort.

That is a stable partition, not a new sort: within each group the existing comparator still decides.
Clicking a column header still sorts normally; the badged group simply floats.

---

## 4. Global Constraints

- **Next.js 16.2.4 is not the Next.js in your training data.** Before editing anything under
  `src/app/`, read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`.
- **Vitest collects `src/**/*.test.ts` only, in `environment: "node"`.** `.tsx` is not collected and
  there is no DOM harness, so anything to be tested must live in a pure `.ts` module.
- Tests import explicitly: `import { describe, expect, it } from "vitest";` (`globals: false`).
- **Reuse `src/lib/tasks/signal-badges.ts` as-is.** `TaskSignalBadges`, `hasAnySignal`,
  `signalRankWeight`, and `emptySignalBadges` are product-agnostic. Do not fork a second copy for
  Enrollment; if the name grates, that is a rename, not a duplicate.
- **Do not add a role check anywhere.** The badge is "you have an unread notification on this
  record". Who receives notifications is already decided by the recipient resolvers and is not this
  plan's business.
- **`agent_email` is not an owner for badge purposes.** The existing `assigned` notification path
  already excludes it; do not add it.
- Every logic change gets a `changelog.md` entry (repo root) in the same commit.
- Commit per task. Do not `git push` unless asked.

---

## 5. File Structure

| Path | Change | Responsibility |
|---|---|---|
| `src/lib/enrollment/signal-order.ts` | Create | Pure badge-first partition helper |
| `src/lib/enrollment/signal-order.test.ts` | Create | Tests for the above |
| `src/app/api/enrollment/[id]/comments/route.ts` | Modify | Add mention-derived watchers |
| `src/app/api/tasks/notifications/route.ts` | Modify | Return `enrollmentSignalBadges` per record |
| `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Modify | Load, render, clear, order |

---

## Task 1: Tagged people keep hearing about the thread

Closes §2. Independent of the badges, and worth shipping on its own: it fixes a real notification
gap that exists today whether or not badges ever land.

**Files:**
- Modify: `src/app/api/enrollment/[id]/comments/route.ts:120-150`

- [ ] **Step 1: Add the mention-derived watcher query**

The route already runs a `Promise.all` fetching active accounts and comment authors. Add a third:

```ts
    loaded.supabase
      .from("enrollment_notifications")
      .select("recipient_email")
      .eq("record_id", id)
      .eq("type", "mentioned"),
```

- [ ] **Step 2: Fold it into the watcher list**

```ts
  const threadWatchers = ((authorsRes.data ?? []) as { author_email: string }[]).map(
    (row) => row.author_email
  );
  // Being tagged makes you a watcher from then on. Without this, someone pulled
  // into a thread by name hears about it exactly once and then goes silent,
  // because the recipient list is caller + responsible + comment AUTHORS.
  // CS gets this from task_participants; Enrollment has no such table, so the
  // mention notifications that were already written serve as the record.
  const mentionWatchers = (
    (mentionedRes.data ?? []) as { recipient_email: string }[]
  ).map((row) => row.recipient_email);

  const baseRecipients = uniqueEnrollmentNotificationRecipients(
    [
      loaded.record.caller_email,
      loaded.record.responsible_enroll_email,
      ...threadWatchers,
      ...mentionWatchers,
    ],
    [loaded.actor.email, ...mentions]
  );
```

`uniqueEnrollmentNotificationRecipients` already dedupes and already excludes the actor and the
people being freshly mentioned, so no other guard is needed.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run`

Manual, three accounts on one ACA record where C is neither caller nor responsible:
1. A tags C → C gets one `mentioned` notification.
2. B comments (no tag) → **C gets a `commented` notification.** This is the fix; before it, C got
   nothing.
3. C comments → still one notification each, no duplicates (C is excluded as the actor).
4. A tags C again → C gets `mentioned`, not a doubled `commented`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/enrollment/[id]/comments/route.ts" changelog.md
git commit -m "fix(enrollment): keep tagged people subscribed to the thread"
```

---

## Task 2: Badge-first ordering helper

A pure `.ts` module so the ordering rule is testable; `EnrollmentClient` is `.tsx` and Vitest cannot
reach it.

**Files:**
- Create: `src/lib/enrollment/signal-order.ts`
- Create: `src/lib/enrollment/signal-order.test.ts`

**Interfaces:**
- Consumes: `TaskSignalBadges`, `hasAnySignal`, `signalRankWeight` from `@/lib/tasks/signal-badges`.
- Produces: `partitionBySignal<T extends { id: string }>(rows, badgesByRecord): T[]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/enrollment/signal-order.test.ts
import { describe, expect, it } from "vitest";
import { partitionBySignal } from "@/lib/enrollment/signal-order";
import { emptySignalBadges, type TaskSignalBadges } from "@/lib/tasks/signal-badges";

const row = (id: string) => ({ id });
const badged = (partial: Partial<TaskSignalBadges>): TaskSignalBadges => ({
  ...emptySignalBadges(),
  ...partial,
});

describe("partitionBySignal", () => {
  it("floats badged records to the front", () => {
    const rows = [row("a"), row("b"), row("c")];
    const out = partitionBySignal(rows, { b: badged({ comments: 1 }) });
    expect(out.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("orders the badged group mention, comments, assignment", () => {
    const rows = [row("assigned"), row("commented"), row("mentioned")];
    const out = partitionBySignal(rows, {
      assigned: badged({ assigned: true }),
      commented: badged({ comments: 2 }),
      mentioned: badged({ mentioned: true }),
    });
    expect(out.map((r) => r.id)).toEqual(["mentioned", "commented", "assigned"]);
  });

  it("preserves the incoming order inside each group", () => {
    // The active column sort already ordered these; the partition must not
    // reshuffle within a group or the header sort stops meaning anything.
    const rows = [row("a"), row("b"), row("c"), row("d")];
    const out = partitionBySignal(rows, {
      c: badged({ comments: 1 }),
      a: badged({ comments: 1 }),
    });
    expect(out.map((r) => r.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("returns the input order unchanged when nothing is badged", () => {
    const rows = [row("a"), row("b")];
    expect(partitionBySignal(rows, {}).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/enrollment/signal-order.test.ts`
Expected: FAIL with "Cannot find module '@/lib/enrollment/signal-order'".

- [ ] **Step 3: Implement**

```ts
// src/lib/enrollment/signal-order.ts
import {
  hasAnySignal,
  signalRankWeight,
  type TaskSignalBadges,
} from "@/lib/tasks/signal-badges";

/**
 * Floats records carrying an unread signal to the front, in badge-weight order.
 *
 * This is a stable partition, not a sort: Enrollment has no default ranking, so
 * the caller's active column sort still decides the order inside each group. A
 * full band system like the CS list has would change how every user's list
 * behaves and is deliberately out of scope.
 */
export function partitionBySignal<T extends { id: string }>(
  rows: readonly T[],
  badgesByRecord: Record<string, TaskSignalBadges>
): T[] {
  const badged: { row: T; weight: number }[] = [];
  const rest: T[] = [];

  for (const row of rows) {
    const badges = badgesByRecord[row.id];
    if (badges && hasAnySignal(badges)) {
      badged.push({ row, weight: signalRankWeight(badges) });
    } else {
      rest.push(row);
    }
  }

  // Array.prototype.sort is stable in every runtime this ships to, so equal
  // weights keep the order the column sort produced.
  badged.sort((a, b) => a.weight - b.weight);
  return [...badged.map((entry) => entry.row), ...rest];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/enrollment/signal-order.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrollment/signal-order.ts src/lib/enrollment/signal-order.test.ts changelog.md
git commit -m "feat(enrollment): add badge-first ordering helper"
```

---

## Task 3: Return unread signal badges per record

The notifications route already queries `enrollment_notifications` for a total unread **count**. Add
a per-record breakdown beside the Task one, using the identical grouping.

**Files:**
- Modify: `src/app/api/tasks/notifications/route.ts`

**Interfaces:**
- Produces: response gains `enrollmentSignalBadges: Record<string, TaskSignalBadges>` keyed by
  record id, mirroring the existing `signalBadges` for tasks.

- [ ] **Step 1: Add the query to the existing `Promise.all`**

```ts
    supabase
      .from("enrollment_notifications")
      .select("record_id,type")
      .eq("recipient_email", email)
      .in("type", ["assigned", "commented", "mentioned"])
      .eq("is_read", false),
```

Guard its error with `isMissingEnrollmentTableError`, exactly as the sibling enrollment queries in
this route already do — the table is optional in some environments.

- [ ] **Step 2: Group it the same way tasks are grouped**

```ts
  const enrollmentSignalBadges: Record<string, TaskSignalBadges> = {};
  for (const row of (unreadEnrollmentSignalRes.data ?? []) as {
    record_id: string;
    type: string;
  }[]) {
    const badges = (enrollmentSignalBadges[row.record_id] ??= emptySignalBadges());
    if (row.type === "assigned") badges.assigned = true;
    else if (row.type === "mentioned") badges.mentioned = true;
    else if (row.type === "commented") badges.comments += 1;
  }
```

Add `enrollmentSignalBadges` to the returned object.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`

Manual: comment on an ACA record as another user, then open `/api/tasks/notifications`. Expected:
`enrollmentSignalBadges` contains that record id with `comments: 1`. Confirm `signalBadges` (tasks)
and `unread` are unchanged.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/tasks/notifications/route.ts" changelog.md
git commit -m "feat(enrollment): return unread signal badges per record"
```

---

## Task 4: Render badges and float badged rows

`EnrollmentClient` has no badge component today, so all three badges are new here — including `NEW`,
which CS already had.

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`

**Interfaces:**
- Consumes: `enrollmentSignalBadges` (Task 3), `partitionBySignal` (Task 2), and
  `hasAnySignal` / `TaskSignalBadges` from `@/lib/tasks/signal-badges`.

- [ ] **Step 1: Load the badge map**

Mirror `TaskBoardClient`: fetch `/api/tasks/notifications` on mount, keep
`Record<string, TaskSignalBadges>` in state, tolerate a missing field with `?? {}`.

- [ ] **Step 2: Render the three badges in the row**

Match the CS visual language so the two products do not diverge:

| Badge | Style | Tooltip |
|---|---|---|
| `NEW` | Reuse `NewAssignedBadge` from `./tasks/_components/board-ui` if importable across modules, otherwise a matching blue text pill | — |
| `@` | 20 px circle, `border-[#f8e6a0] bg-[#fff7d6] text-[#7f5f01]`, `AtSign` icon | "You were mentioned in a comment." |
| `💬 n` | Widened pill, `border-[#b3d4ff] bg-[#deebff] text-[#0055cc]`, `MessageSquare` + count | "n new comments since you last opened this." |

Place them beside the client name, the same relative position CS uses beside the task title.

- [ ] **Step 3: Float badged records**

Wrap the existing sorted list with `partitionBySignal(sortedRecords, enrollmentSignalBadges)`. Apply
it **after** the column sort, so header sorting still governs order within each group.

- [ ] **Step 4: Clear all three types when the drawer opens**

`POST /api/tasks/notifications/read` already accepts `{ recordId, type }` — the route splits
`enrollment:`-prefixed ids and handles enrollment rows. Post once per type, exactly as
`markNewAssignedTaskSeen` does on the CS side, and drop the record from local state immediately so
the row unpins without waiting for a refetch.

- [ ] **Step 5: Verify**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run build`

Browser, on **both ACA and Medicare**, with two accounts:
- B comments on A's record → A sees `💬 1` and the row floats to the top; a second comment → `💬 2`.
- A opens the drawer → both badges clear, the row returns to its sorted position, and it stays clear
  after a reload.
- B tags C, who is neither caller nor responsible → C sees `@`, the row floats for C.
- B comments again without tagging → **C sees `💬`** (this is Task 1's fix, visible here).
- A comments on A's own record → no badge for A.
- Sort by a column → header sorting still works; badged rows stay grouped at the front.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx" changelog.md
git commit -m "feat(enrollment): render signal badges and float badged records"
```

---

## Acceptance criteria

- A person tagged on an Enrollment record receives every subsequent comment notification on that
  record, without having to comment first.
- All three badges render on ACA and Medicare rows, and a record with no unread signal renders
  exactly as it does today.
- A badged record floats to the front; within the badged group order is `@` → `💬` → `NEW`; within
  each group the active column sort still decides.
- Opening the drawer clears all three types and the row unpins, staying clear after a reload.
- Commenting on your own record produces no badge for you.
- `agent_email` never grants a badge on its own.
- Task badges, the notification bell, and the total unread count are all unchanged.
- `npx vitest run && npm run typecheck && npm run lint && npm run build` all pass.

## Execution Log

| Task | Status | Commit | Verification | Notes |
|---|---|---|---|---|
| 1. Tagged people stay subscribed | Pending | — | — | Real notification fix; ships independently |
| 2. Badge-first ordering helper | Pending | — | — | Pure `.ts`; stable partition, not a sort |
| 3. Per-record unread badges | Pending | — | — | Guard with `isMissingEnrollmentTableError` |
| 4. Render and float | Pending | — | — | `NEW` is new here; CS already had it |
