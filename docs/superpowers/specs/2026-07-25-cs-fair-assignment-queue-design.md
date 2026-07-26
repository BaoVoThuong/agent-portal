# CS Fair Assignment Queue — Design Spec

**Status:** Approved (design), pending spec review
**Date:** 2026-07-25
**Author:** Bao Vo + Claude
**Module:** Task Management (CS), `src/lib/tasks/overview.ts` + `POST /api/tasks/[id]/assignees` + `POST /api/tasks`
**Not in scope:** Health Enrollment's Overview/Recommend — that system stays count-based (`src/lib/enrollment/overview.ts`), unrelated to this change.

---

## 1. Problem

The current CS assignment recommendation (`rankRecommendation` in `src/lib/tasks/overview.ts`) is **greedy**: every time it runs, it ranks candidates by (projected status → priority-pressure → SLA-load-minutes → open count) and always points at whoever looks least loaded *right now*. It has no memory of who was assigned last.

This under-serves fairness in a specific way the user flagged: a CS who works fast and clears their queue looks "Free" sooner than a slower CS with the same total workload, so the greedy ranking keeps steering *new* work back to the fast worker — punishing speed with more work, rather than rotating turns. There's no guarantee "everyone gets a task" over time; it's possible for one person to be skipped repeatedly if their SLA-load never dips below others'.

## 2. Goal

Replace the primary ranking signal with a **fair turn-taking queue**: every CS must get a turn in rotation, and the *size* (SLA-minutes) of the task they just received determines how long until they're eligible again — a big task pushes someone further back than a small one. SLA-load stops being the primary driver and becomes a secondary tie-breaker only ("SLA là tiêu chí thêm", per the user).

Confirmed scope (from the user):
1. **Every assignment method** bumps the queue — Recommend-driven, manual pick from the board, and assigning at task-creation time. Not just Recommend-initiated assignments.
2. The queue is **company-wide across all CS** — not scoped per agent/team. (Existing `canAssignToTask` permission checks are unchanged; this only affects *ranking*, not who's *allowed* to be assigned.)

## 3. Mechanism — cooldown-scored virtual queue

Each CS has one value: `queue_due_at` — "the timestamp at which they become eligible to be recommended again." The queue itself is never a stored, hand-maintained position list; it's *computed* by sorting all CS ascending by `queue_due_at` (earliest/most-overdue first). This avoids position-integer bookkeeping (insert/reindex bugs) entirely — sorting a timestamp column *is* the queue.

**Bump formula**, applied every time a CS receives an assignment for task T:

```
base = max(current_queue_due_at, now)   // don't let an expired cooldown erase pending stacked load
new_queue_due_at = base + effectiveSlaMinutes(T)
```

- If their existing cooldown has already expired (`current_queue_due_at <= now`), the new cooldown starts counting from **now**.
- If they're still mid-cooldown from a prior assignment (received two tasks back-to-back before their turn came around again), the new task's cooldown **stacks** on top of the existing one — reflecting that their total committed load just grew, not that the clock restarts from zero.
- `effectiveSlaMinutes(T)` reuses the existing pure function (`src/lib/tasks/sla.ts:47`) already used everywhere else SLA weight is computed — no new SLA concept is introduced.

**Who's "next"**: sort all eligible CS by `queue_due_at` ascending. Whoever's value is furthest in the past (or has never been assigned — see below) ranks first. Tie-break (exact-equal `queue_due_at`, e.g. two people who've never had a turn) falls back to current SLA-load-minutes ascending — the *only* place SLA-load still matters, and only as a tie-breaker, not the primary key.

**New CS / never assigned**: no row yet in the rotation table → treated as `queue_due_at = epoch` (effectively "infinitely overdue"), so a brand-new CS is recommended first, guaranteeing they don't wait behind everyone else's history before getting their first task.

**Self-regulating by construction**: because the push-back is proportional to task size, a CS who receives a huge task is automatically ineligible for a long stretch — no separate "is this person overloaded, skip them" rule is needed. The mechanism *is* the load-balancing; there's no second layer to keep in sync with it.

## 4. Data model

New table, `task_assignment_rotation`:

| Column | Type | Notes |
|---|---|---|
| `email` | text primary key | normalized lowercase, matches convention elsewhere (`agent_members.cs_email`) |
| `queue_due_at` | timestamptz not null default now() | sort key; the "virtual queue" |
| `updated_at` | timestamptz not null default now() | audit |

No foreign key to `portal_account` (mirrors the existing pattern for `task_assignees`/`agent_members` — people can be referenced by email without a hard FK, matching how this codebase already treats CS assignment plumbing). RLS enabled like every other task table (service-role only, per the existing blanket RLS block in `schema.sql`).

## 5. Where the bump happens

Both existing "a CS receives a task" code paths get the same one-line hook — a new pure-plus-IO helper, not duplicated logic:

- `src/lib/tasks/rotation.ts` (new): `bumpAssignmentRotation(supabase, email, task, rules, now)` — reads the current row (if any), computes the new `queue_due_at` via the pure formula, upserts.
- `POST /api/tasks/[id]/assignees/route.ts` — call it once the assignee is confirmed added (inside the `!alreadyAssigned` branch, so re-adding an existing assignee doesn't double-bump).
- `POST /api/tasks/route.ts` (task creation with an initial assignee) — call it once, after the task + junction insert succeeds, only when `requestedAssignees` is non-empty.

Removing an assignee (`DELETE /api/tasks/[id]/assignees/[email]`) does **not** touch the rotation — only *receiving* work affects turn order, consistent with "ai cũng phải có task" being about who gets picked next, not a reward/penalty ledger for every board action.

## 6. Ranking change

`rankRecommendation` (`src/lib/tasks/overview.ts:504`) changes its primary sort key. Current:

```
urgent/high: [status, inProgressCount, priorityPressure, slaLoad, openCount]
medium/low:  [status, slaLoad, priorityPressure, openCount]
```

New:

```
all priorities: [queue_due_at ascending, slaLoad ascending (tie-break only)]
```

`status` (Free/OK/Busy/Overloaded) and `priorityPressure` stop being sort keys but **stay visible** in the recommendation panel (already-existing fields on `RecommendationCandidate`) so the admin can see "this person is next up, and happens to be Overloaded" and manually pick someone else — the mechanism recommends by turn, the admin still has final say (unchanged: assignment always goes through the same `/assignees` POST regardless of who initiates it).

`OverviewSnapshot`/`CsOverviewRow` gains a `queueDueAt: string | null` field so the UI can show it (e.g. "next up in ~2h" or literal rank order) — read from the new table in `fetchTaskOverview` (`src/lib/tasks/overview-data.ts`), joined by email alongside the existing accounts/roles fetch.

## 7. What does NOT change

- Permission/scoping rules for *who is allowed* to be assigned to a task (`canAssignToTask`, agent-owner/assistant checks) — unaffected. The queue only changes *ranking order among eligible candidates*, never eligibility.
- Enrollment's separate recommendation system (`src/lib/enrollment/overview.ts`) — explicitly out of scope; it has no SLA-minutes concept and the user confirmed it's already done.
- The Unassigned-queue / Recommend UI shape in `CSWorkloadOverview.tsx` — same panel, same "Assign" button; only the ranking underneath changes, plus the new `queue_due_at` display.

## 8. Open questions for plan phase (have defaults, flag if wrong)

- Should `queue_due_at` display in the UI as a raw timestamp, a relative "next up in Xh", or just rank position (#1, #2...)? Default: relative label, matching the codebase's existing `formatAge`/relative-time helpers in `CSWorkloadOverview.tsx`.
- Backfill for existing CS with no rotation history when this ships: default `queue_due_at = now()` for everyone (via `on conflict do nothing` upsert per active CS, or simply let rows get created lazily on first bump — the "never assigned" epoch-first behavior already handles this correctly with **zero backfill needed**, so default to no backfill).
