# Task Board — Jira-fidelity UI Pass — Design Spec

- **Date:** 2026-06-24
- **Status:** Approved (brainstorming) — pending implementation plan
- **Scope:** UI/UX overhaul of the existing task board to match Jira as closely as
  possible. UI/views fidelity ONLY — no sprints/epics/story-points/workflow. Builds
  on the existing model + API; branch `feat/task-board`.

## Context — why

The task board works but the UX is not Jira-grade: filters feel rough, the backlog
is a thin flat list, and there is no List/table view. This pass raises UI fidelity:
a smoother board, a unified Jira-style filter toolbar, a new sortable **List view**
with inline editing, and a redesigned **Backlog** (drag-to-order + inline create).
No data-model or API changes beyond reusing the existing endpoints.

## Goals

- Three Jira-style views switchable in one toolbar: **Board · List · Backlog**.
- Unified, clean filter toolbar shared by Board + List.
- New **List view**: flat sortable table with inline edit; row opens the drawer.
- Redesigned **Backlog**: rich rows, drag-to-reorder priority, inline quick-create.
- Keep the recently-upgraded smooth Kanban dnd (DragOverlay + live cross-column move).

## Non-goals (unchanged stance)

Sprints/cycles, epics, real story points, issue types, workflow rules,
timeline/calendar, realtime, column resize/pin, saved views, server/API changes.

## Roles

Unchanged. Server scope (`fetchTasksForActor`) already limits CS to their own
assigned tasks; Manager sees all. CS sees **Board + List**; Manager sees **Board +
List + Backlog** (backlog = unassigned, manager-only). Inline edits remain gated by
`canMutateTask` server-side; the UI disables controls when `!canEdit`.

## Architecture & view switching

`TaskBoardClient` replaces `tab: "board" | "backlog"` with
`view: "board" | "list" | "backlog"`. A Jira-style segmented control (Board / List /
Backlog) lives in the toolbar; Backlog is rendered in the switcher only for managers.
`visibleTasks` (existing memo: search + agent filter + quick filters) feeds **both**
Board and List. Backlog reads `status === "backlog"` tasks. No data-model or API
change; inline edits reuse the existing optimistic `patchTask`, creates reuse
`createTask`, reorder reuses `midpoint` + `PATCH`.

## Components

### `TaskToolbar.tsx` (new, shared by Board + List)
One seamless bar: **Search** · **agent avatar group** (existing overlapping avatars)
· **facet dropdowns** Priority ▾ / Category ▾ (and **Status ▾** only in List) ·
**Quick Filters** (existing menu) · **Clear all** · **"X of Y" count** · **view
switcher** (right). Facet dropdowns reuse `TaskSelect` (single-select with an "Any"
option). Filter state lifts into `TaskBoardClient`: add `priorityFilter`,
`categoryFilter`, `statusFilter` (status applied in List only) into the `visibleTasks`
memo. "Clear all" resets search + agent + quick filters + facets.

### `TaskListView.tsx` (new, custom lightweight table)
Flat table over `visibleTasks`. Columns: **Type/Status icon · Key (TASK-xxx) ·
Title · Status · Priority · Agent · Assignee · Category · Due · Updated**.
- **Sort:** clicking a header toggles asc/desc via a pure `sortTasks(tasks, key, dir)`
  helper; an arrow shows the active column/direction. Default sort: position asc.
- **Inline edit:** Status, Priority, Assignee, Category are edited in-row via
  `TaskSelect`/`TaskPrioritySelect`, calling `patchTask` (optimistic). Controls are
  disabled when `!canEdit` for that task (Manager: all; CS: own only). Assignee
  changes follow the same backlog/assign invariant the API enforces.
- Click the title cell (or a non-control area of the row) opens the existing
  `TaskDetailDrawer`.
- Styling: sticky header, subtle row hover, Jira palette (`#172b4d`/`#0c66e4`/…).

### `BacklogBoard.tsx` (replaces `BacklogList.tsx`)
Manager-only view of `status === "backlog"` tasks.
- **Rich rows:** priority icon · key · title · category/agent chips · due · an
  unassigned avatar · **Assign** control (`TaskSelect`) that sets `assignee_email` +
  status `todo`.
- **Drag-to-reorder** (dnd-kit vertical `SortableContext`): on drop, compute the new
  `position` via `midpoint` of the neighbouring backlog rows and `patchTask` it.
- **Inline quick-create:** a persistent "+ Create task" row at the bottom; typing a
  title + Enter calls `createTask` (status backlog, unassigned). Manager-only.
- Empty state preserved.

### Board (polish only)
Keep the upgraded dnd (DragOverlay + live cross-column move + drop animation, all
already shipped). Minor: consistent column header/WIP count styling. Card unchanged.

## New pure logic

`src/lib/tasks/sorting.ts` — `sortTasks(tasks, key, dir)` where `key` ∈
`title | status | priority | agent | assignee | category | due | updated | key` and
`dir ∈ "asc" | "desc"`. Stable, pure, unit-tested (priority orders low<medium<high<urgent;
nullable fields sort last; `key` sorts by the derived TASK-xxx). The facet-filter
predicate may also be extracted as a small pure helper for testing.

## Files

- Modify: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx` (view state, lifted
  filter/sort state, render the three views, mount `TaskToolbar`).
- Create: `TaskToolbar.tsx`, `TaskListView.tsx`, `BacklogBoard.tsx`.
- Create: `src/lib/tasks/sorting.ts` (+ `sorting.test.ts`).
- Remove: `BacklogList.tsx` (superseded by `BacklogBoard.tsx`).
- Reuse: `TaskSelect`, `TaskPrioritySelect`, `board-ui`, `KanbanBoard`,
  `TaskDetailDrawer`, `midpoint`, and the existing `patchTask`/`createTask`/`archiveTask`.

## Verification

- `npx vitest run` — `sortTasks` (+ facet predicate) unit tests; existing suite stays green.
- `npx tsc --noEmit` + `npx next build` clean.
- Manual: switch Board/List/Backlog; sort each List column both directions; inline-edit
  status/priority/assignee/category (Manager any, CS only own → others disabled);
  drag to reorder backlog; inline-create a backlog task; confirm filters (search, agent,
  priority, category, status) apply consistently across Board + List.

## Open questions

None — all decisions resolved during brainstorming (3 tabs; flat sortable List with
inline edit; rich Backlog with drag-reorder + inline create; custom lightweight table).
