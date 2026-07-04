# Task Board — Priority/Category SLA Timers, Overdue Column, Remove "Waiting"

Date: 2026-07-05
Branch: `main`
Status: Approved (delegated — user asked for design + implementation, no review round)

## Ask (as given)

Each priority gets a time budget; the budget can be overridden per category
(admin-configurable, UI like the existing Agent Groups screen). When an agent
moves a task To Do → In Progress, a countdown starts. When it hits zero the
task jumps into a new **Overdue** section and counts up instead. To get out
of Overdue, the agent must type a reason; that unlocks the task back into In
Progress. Delete the **Waiting** status entirely. Overdue cards get a red
border, visually distinct from normal cards.

## Key architectural decision: Overdue is computed, not stored

There is no cron/background worker in this app (no pg_cron, no queue). Two
ways to get a task into an "overdue" bucket:

1. Store `status = 'overdue'` in the DB and have *something* flip it the
   moment the deadline passes.
2. Never store it — derive "is this task overdue" from
   `tasks.in_progress_at + sla_minutes(priority, category) < now()`, computed
   wherever it's needed (client render, list queries), and treat "Overdue" as
   a **display bucket** of `in_progress`, not a real status.

Going with **(2)**. It needs no scheduled job, no risk of the flip lagging
behind or double-firing, and "unlocking" becomes a one-column write
(`in_progress_at = now()`, i.e. restart the clock) instead of a status
transition. The tradeoff: the task only *visibly* moves to the Overdue column
next time a client renders/polls it (already happens every 10–20s via the
existing poll/realtime broadcast — no perceptible lag in practice).

Consequence for the Kanban board: `KanbanBoard.tsx` today assumes one column
= one `TaskStatus` (`columnTasks = items.filter(t => t.status === status)`,
drag sets `status` to the destination column). Overdue doesn't fit that
1:1 mapping, so the board's column model is refactored from `TaskStatus` to
a new `BoardColumn` type (`"todo" | "in_progress" | "overdue" | "done" |
"cancel"`), where the `"overdue"` bucket filters `in_progress` tasks past
deadline and the `"in_progress"` bucket filters those not past it. The
Overdue column is **drag-locked**: cards inside can't be picked up (the only
way out is the reason flow), and it isn't a valid drop target for cards
dragged from elsewhere.

## Schema (`supabase/schema.sql`)

```sql
alter table tasks add column if not exists in_progress_at timestamptz;

-- One-time backfill before dropping 'waiting': existing waiting tasks become
-- in_progress with a fresh clock (must run before the check constraint swap).
update tasks set status = 'in_progress', in_progress_at = now()
where status = 'waiting';

alter table tasks drop column if exists waiting_reason;

-- (drop + re-add tasks_status_check without 'waiting', same pattern already
-- used for the existing status-check migration)

create table if not exists task_sla_rules (
  id uuid primary key default gen_random_uuid(),
  priority text not null check (priority in ('low','medium','high','urgent')),
  category_id uuid references task_categories(id) on delete cascade,
  duration_minutes integer not null check (duration_minutes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- category_id = null means "default for this priority, any/no category".
-- Primary key can't have a nullable column, so enforce one-row-per-(priority,
-- category) with a functional unique index over a sentinel for null.
create unique index if not exists task_sla_rules_priority_category_key
  on task_sla_rules (priority,
    coalesce(category_id, '00000000-0000-0000-0000-000000000000'));

-- Seed a default per priority if missing (idempotent).
-- low=1440min(24h), medium=480min(8h), high=240min(4h), urgent=60min(1h)
```

Add `task_sla_rules` to the `protected_tables` RLS array.

## Resolution + timer (pure, unit-tested — `src/lib/tasks/sla.ts`, new)

- `resolveSlaMinutes(priority, categoryId, rules): number` — exact
  (priority, categoryId) match, else (priority, null) default, else a
  hardcoded fallback matching the seed values (belt-and-suspenders if rules
  haven't loaded yet).
- `slaDeadline(inProgressAt, minutes): Date`
- `isTaskOverdue(task, rules, now): boolean` — false unless
  `status === 'in_progress' && in_progress_at` set and `now >= deadline`.
- `formatSlaRemaining(deadline, now): string` — `"2h 15m left"` while running,
  `"Overdue by 45m"` once past (same function drives both, sign flips).

## `in_progress_at` stamping

`resolveTaskPatch` (`transitions.ts`): whenever the resolved next status is
`in_progress` and the *current* status isn't already `in_progress`, add
`in_progress_at = nowIso` to the patch (re-entering In Progress — including
from Done/Cancel reopen — always restarts the SLA clock).

## Overdue unlock

`POST /api/tasks/[id]/overdue-unlock { reason: string }`
- Permission: `canChangeTaskStatus` (manager, agent owner, or assignee — see
  the permission-split spec).
- 400 if task isn't currently `in_progress`, or isn't actually past deadline
  (recomputed server-side from `in_progress_at` + resolved SLA minutes — the
  reason box is a UI action gated by the same displayed state, but the server
  re-checks so a stale client can't unlock early).
- 400 if `reason.trim()` is empty.
- Sets `in_progress_at = now()` (restarts the clock — task is not overdue the
  instant it's unlocked). Inserts a `task_activity` row
  `{ type: "overdue_resolved", meta: { reason } }` directly (same
  direct-insert style already used for the "assigned" notification in this
  route) — no new persisted reason column on `tasks`; history lives in the
  activity feed already rendered in the task detail view.
- Broadcasts task room + tasks-changed, same as any other patch.

## SLA rules admin screen

New `SlaRulesModal.tsx`, modeled on `AgentGroupsModal.tsx`'s two-pane
master/detail layout:
- Left pane: the 4 priorities (fixed list, not addable/removable — just
  selectable, unlike agents).
- Right pane: one row per task category **plus a pinned "Default (no
  category)" row at the top**, each with a minutes input (helper text shows
  the human-readable form, e.g. "480 min = 8h"). Save per-row on blur.
- Entry point: a "SLA Times" button next to the existing "Agent Groups"
  button (manager-only, gated the same way).
- API: `GET /api/admin/task-sla-rules` — any board actor (workers need the
  rules to render their own countdowns), `POST /api/admin/task-sla-rules
  { priority, category_id, duration_minutes }` upsert-one-row — manager-only.

## Kanban / list UI changes

- `types.ts`: `TASK_STATUSES`/`KANBAN_STATUSES` drop `'waiting'`. New
  `BoardColumn` type + `KANBAN_COLUMNS = ["todo","in_progress","overdue",
  "done","cancel"]`. `TaskRow` gains `in_progress_at: string | null`, loses
  `waiting_reason`.
- `KanbanBoard.tsx`: iterate `KANBAN_COLUMNS` instead of `KANBAN_STATUSES`;
  `columnTasks("in_progress")` excludes computed-overdue,
  `columnTasks("overdue")` includes only those; `findContainer`/drag handlers
  treat `col:overdue` as a non-droppable target (drop is a no-op, same as
  today's cancel-drag path); per-card `canMove` is `false` whenever
  computed-overdue regardless of edit permission.
- `TaskCard.tsx`: red 2px border + light red background when
  computed-overdue (replacing the neutral border, not just the left accent
  strip); new `SlaTimer` inline label (countdown while running, red
  "Overdue by …" once past); drop `WaitingTag`/`waiting_reason` usage. An
  "Enter reason to unlock" button appears only on overdue cards (opens a
  small modal → `POST .../overdue-unlock`).
- `board-ui.tsx`: remove `WaitingTag` and its reason-label map.
- `TaskToolbar.tsx` / `TaskRowItem.tsx`: swap the "waiting" stat/status-chip
  for a computed "overdue" one (count derived client-side from the same
  helper, not a DB column).
- `TaskBoardClient.tsx`: fetch `task_sla_rules` once alongside categories;
  30s `setInterval` tick so countdown labels stay fresh without extra network
  calls; remove `waiting` stat bookkeeping; wire the unlock modal + handler.
- `filtering.ts`: add `"overdue"` to `QuickFilter` (computed, not a
  `matchesStatus` value) alongside the existing `highPriority`/`triage`
  quick filters.
- `sorting.ts`: `STATUS_RANK` drops `waiting`, ranks renumbered.

## Tests
- New `sla.test.ts`: rule resolution (exact > priority-default > fallback),
  deadline math, overdue boundary (exact equality counts as overdue),
  remaining-time formatting both signs.
- `transitions.test.ts`: entering `in_progress` from `todo`/`done`/`cancel`
  stamps `in_progress_at`; staying in `in_progress` (e.g. position-only
  patch) doesn't restamp it.
- `sorting.test.ts`, `filtering.test.ts`: remove waiting cases, add
  `overdue` quick-filter case.
- Existing `assignees-set.test.ts` waiting-adjacent case: adjust to whatever
  status it was exercising `waiting` for (re-point at `in_progress` or drop
  if it was only testing the removed status).

## Risks / decisions
- **Data loss on `waiting_reason` drop**: the column and its 4-value enum
  are deleted outright — acceptable since the whole "Waiting" concept is
  being removed and its history isn't needed going forward; the backfill
  above at least preserves the *tasks* (moved to in_progress) even though the
  specific reason text is discarded.
- **No push the instant SLA breaches** — overdue is only visible once someone
  has the board open (poll/realtime already covers that in practice, but
  there's no guarantee within seconds if nobody's looking). Revisit only if
  the "must page someone at T+0" requirement shows up later.
- **Deleting a category** cascades to its SLA override rows (falls back to
  the priority default automatically) rather than blocking the delete.
- **Reopening Done/Cancel back to In Progress always restarts the SLA
  clock** — consistent with "the timer measures active work," not elapsed
  wall-clock since creation.
