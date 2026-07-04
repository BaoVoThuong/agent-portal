# Plan — Priority/category SLA timers, Overdue column, remove Waiting

Spec: `docs/superpowers/specs/2026-07-05-task-sla-overdue-design.md`
Depends on: the permission-split plan landing first (touches the same
`resolveTaskPatch` signature).

## 1. Schema (`supabase/schema.sql`)
- `alter table tasks add column if not exists in_progress_at timestamptz;`
- Backfill: `update tasks set status='in_progress', in_progress_at=now()
  where status='waiting';` (before touching the check constraint).
- Drop `waiting_reason` column + its check (folded into the same constraint
  edit as `waiting`).
- Swap `tasks_status_check` to drop `'waiting'` (same drop/recreate pattern
  as the existing migration at the `tasks_status_check` block).
- New `task_sla_rules` table + unique index (coalesce-null-sentinel, see
  spec) + idempotent seed block (4 priorities × default minutes:
  low=1440, medium=480, high=240, urgent=60).
- Add `task_sla_rules` to `protected_tables`.

## 2. Types (`src/lib/tasks/types.ts`)
- `TASK_STATUSES`, `KANBAN_STATUSES`: drop `'waiting'`.
- Remove `WAITING_REASONS`/`WaitingReason` export.
- `TaskRow`: add `in_progress_at: string | null`; remove `waiting_reason`.
- New `BoardColumn = "todo" | "in_progress" | "overdue" | "done" | "cancel"`,
  `KANBAN_COLUMNS: BoardColumn[]`.
- New `TaskSlaRule = { id: string; priority: TaskPriority; category_id:
  string | null; duration_minutes: number }`.

## 3. `src/lib/tasks/sla.ts` (new)
- `DEFAULT_SLA_MINUTES: Record<TaskPriority, number>` (fallback constants,
  mirrors the DB seed).
- `resolveSlaMinutes(priority, categoryId, rules)`.
- `slaDeadline(inProgressAt: string, minutes: number): Date`.
- `isTaskOverdue(task: Pick<TaskRow,"status"|"in_progress_at"|"priority"|
  "category_id">, rules, now = new Date()): boolean`.
- `formatSlaRemaining(deadline: Date, now = new Date()): string`.
- `sla.test.ts` covering resolution precedence, boundary equality, both
  format-string signs.

## 4. `transitions.ts`
- Merge with the permission-split change (already landed): add
  `in_progress_at` stamping — if next status is `in_progress` and current
  status wasn't, set `patch.in_progress_at = opts.nowIso ?? new
  Date().toISOString()`.
- Delete all `waiting_reason`/`WAITING_REASONS` handling in this file.
- `transitions.test.ts`: add stamping cases; remove waiting-reason cases.

## 5. API
- `src/app/api/tasks/[id]/overdue-unlock/route.ts` (new, `POST`):
  load actor+task, resolve `isAssignee`/`canChangeTaskStatus`, fetch SLA
  rules, recompute `isTaskOverdue` server-side, validate `reason`, update
  `in_progress_at`, insert `task_activity` row, broadcast, return task.
- `src/app/api/admin/task-sla-rules/route.ts` (new):
  `GET` — any `canAccessBoard` actor, returns all rules.
  `POST` — manager-only (`task.manage`), upserts one
  `{priority, category_id, duration_minutes}` row (on-conflict the unique
  index), returns the row.
- `src/app/api/tasks/[id]/route.ts`: no logic change beyond what the
  permission-split plan already wires (isAssignee → canChangeTaskStatus);
  confirm `waiting_reason` references are gone after `resolveTaskPatch`
  cleanup.

## 6. Kanban / board UI
- `KanbanBoard.tsx`: iterate `KANBAN_COLUMNS`; `columnTasks(column)` special-
  cases `"in_progress"`/`"overdue"` via `isTaskOverdue`; `findContainer`
  treats `col:overdue` as non-droppable (drag-over into it is ignored, same
  as an invalid target); per-card `canMove` ANDs with `!isTaskOverdue(task)`.
  Needs `rules` + `now` threaded in as props (from `TaskBoardClient`).
- `TaskCard.tsx`: `isOverdue` + `slaLabel` props; red 2px border + tinted
  background when overdue (replace the neutral border classes, not just the
  left accent); `SlaTimer` label; remove `WaitingTag`; new "Enter reason to
  unlock" button (overdue-only) opening a small reason modal.
- `board-ui.tsx`: delete `WaitingTag` + its reason-label map.
- `TaskToolbar.tsx`: swap the `waiting` stat prop for `overdue` (computed
  count passed down); status/quick-filter option "Waiting" → "Overdue".
- `TaskRowItem.tsx`: same status-chip swap for list view (needs `isOverdue`
  passed per-row).
- `filtering.ts`: `QuickFilter` add `"overdue"`; `matchesQuick` computes it
  via `isTaskOverdue` (needs rules+now threaded into `FilterCriteria` or
  computed upstream and passed as a precomputed set of overdue ids —
  simpler: precompute `overdueIds: Set<string>` once per render in
  `TaskBoardClient` and pass through).
- `sorting.ts`: `STATUS_RANK` drop `waiting`, renumber.
- `TaskBoardClient.tsx`:
  - Fetch `task_sla_rules` on mount (alongside categories).
  - `setInterval` 30s tick (state bump) to keep countdown labels live.
  - Remove `waiting` stat bookkeeping; add computed overdue count/ids.
  - New `SlaRulesModal` wiring (open/close state, manager-only entry button
    next to "Agent Groups").
  - New unlock-reason modal + `overdueUnlock(id, reason)` handler → `POST
    /api/tasks/[id]/overdue-unlock`, optimistic `in_progress_at` bump.

## 7. `SlaRulesModal.tsx` (new)
- Master/detail modeled on `AgentGroupsModal.tsx`: left = 4 fixed priorities;
  right = categories + pinned "Default" row, minutes input, save on blur via
  the upsert endpoint, per-row saving/error state matching
  `AgentGroupsModal`'s `savingEmail`/`error` pattern.

## 8. Tests
- `sla.test.ts` (new, see §3).
- `transitions.test.ts`, `sorting.test.ts`, `filtering.test.ts`: updated per
  above.
- `assignees-set.test.ts`: check for any case exercising `'waiting'`
  specifically; repoint to `in_progress` or drop.

## 9. Verification
- `npm run test:run`, `npm run typecheck`, `npm run build`.
- Manual (dev server): set a 1-minute SLA rule, move a task to In Progress,
  watch it count down and jump to Overdue with a red border, submit an
  unlock reason, confirm it's back in In Progress with a fresh countdown and
  the reason shows in the activity feed.
- Note in the final summary: **schema.sql must still be run manually in the
  Supabase SQL editor** (existing project convention — nothing here
  auto-applies).

## 10. Commit
- Likely 2–3 commits: schema+types+sla.ts+transitions, API routes, UI
  (board/card/toolbar/modals) — whatever groups cleanly; each must pass
  typecheck/build before moving on.
