# CS Workload Overview — Implementation Plan

> The dashboard is the primary product. Recommendation is a secondary inline action derived
> from the dashboard metrics. Implement and verify without committing.

## Goal

Deliver an admin-only Overview tab in the task board that makes the current workload of every
plain-CS worker legible through KPI totals, workload/risk charts, a drillable CS table, and an
unassigned queue. Add recommendation-assisted assignment only as an explainable extension of
that dashboard.

## Design decisions locked by the spec

- Three independent workload signals: open count, SLA-load minutes, and priority pressure.
- Status is `max(risk, SLA load, pressure)`. Count is visible and ranked, but has no hidden badge cap.
- SLA load is explicitly a proxy, never an ETA. Post-active in-progress tasks use a visible
  full-SLA unknown-effort fallback.
- Dashboard-first layout: KPI strip, attention bars, work-mix matrix, full CS
  table, then unassigned queue/recommendation.
- Pool is active `task.work` accounts minus admin, task-agent, and any assistant accounts.
- Existing assignments outside the pool appear in an exception section.
- Recommendation ranks projected metrics after adding the selected task as todo.
- Assignment uses an atomic Postgres RPC and returns `409 Conflict` for stale/no-longer-backlog work.

## Phase 1 — Domain model and pure aggregation

### 1.1 Add overview types and tunables

**Files:** `src/lib/tasks/overview-types.ts`, `src/lib/tasks/overview.ts`.

- Define API payloads for KPI totals, workload points, attention bars, work mix, CS rows, task
  summaries, unassigned rows, exceptions, thresholds, and generatedAt.
- Define `OverviewThresholds` with the initial 8h/16h SLA thresholds and 6/10 pressure thresholds.
- Define status/risk enums and display metadata in one place.
- Keep the client DTO free of raw full task data except task summaries needed for drill-down.

### 1.2 Implement pure aggregation

**File:** `src/lib/tasks/overview.ts`.

- Normalize junction + legacy assignee data.
- Build the pinned plain-CS pool from the server-provided account/membership sets.
- Aggregate global totals and per-CS rows, including zero-load CS.
- Implement active SLA, over-budget, post-active unknown-effort, todo, and waiting contributions.
- Compute flags, absolute status, pulse, stage/priority totals, attention bars, and out-of-pool
  exceptions.
- Implement projected candidate metrics, deterministic ranking, and reason generation.

### 1.3 Unit tests

**File:** `src/lib/tasks/overview.test.ts`.

Cover multi-assignee/global totals, zero-load rows, archived rows, null SLA fallback, waiting one
third, unknown-effort fallback, overdue/stuck flags, done-only pulse, threshold boundaries, chart
totals, candidate projection, stable tie ordering, and explainable recommendation reasons.

## Phase 2 — Server data and secure APIs

### 2.1 Add server overview loader

**File:** `src/lib/tasks/overview-data.ts`.

Fetch in parallel:

- active accounts and names;
- account roles/role permissions;
- task agents and assistant memberships;
- all non-archived open tasks;
- tasks closed as `done` in the last seven days;
- task assignees for the selected task ids;
- SLA rules and reminder settings.

Pass normalized rows into the pure aggregator. Return a single authoritative snapshot.

### 2.2 Add admin overview route

**File:** `src/app/api/tasks/overview/route.ts`.

- Require an authenticated task-view admin, not merely `task.manage`.
- Return `401/403` consistently with existing task routes.
- Set dynamic/no-store behavior.
- Serialize a stable `generatedAt` and threshold version.

### 2.3 Add atomic assignment migration and route

**Files:** `supabase/schema.sql`, `src/app/api/tasks/[id]/assign/route.ts`.

- Add an idempotent `assign_unassigned_task` Postgres function.
- Lock the task row, validate expected updatedAt, backlog status, no legacy/junction assignee,
  and valid active plain-CS pool membership.
- In the same transaction update tasks, task_assignees, task_assignment_cycles, task_stage_cycles,
  task_activity, and assignment timestamps.
- Return a typed domain error that the route maps to `409 Conflict`.
- After commit, notify the assignee and broadcast the existing global task-change ping.
- Do not change the existing add-assignee endpoint semantics.

### 2.4 API tests

**Files:** route tests alongside the new route; pure RPC error mapping tests if practical.

Cover admin-only access, invalid/inactive/excluded CS, stale updatedAt, no-longer-backlog task,
and response mapping for `409`.

## Phase 3 — Dashboard UI

### 3.1 Add Overview tab to existing task toolbar

**Files:** `TaskToolbar.tsx`, `TaskBoardClient.tsx`.

- Add `overview` to the view type and show it only for `isManager`.
- Keep Board/List/Backlog behavior unchanged.
- Load the overview snapshot on first entry and on refresh/realtime events.
- Preserve the existing task drawer open/deep-link behavior.

### 3.2 Build the dashboard component

**Files:** new `CSWorkloadOverview.tsx` plus focused child components if needed.

Implement in this order:

1. Header/update state and KPI strip.
2. Attention horizontal bars and a stage x priority work-mix matrix with Todo/In-progress overdue rows separated.
3. Searchable/sortable CS table with visual count/SLA bars and readable SLA exposure bands.
4. Expandable CS task summaries and existing task-detail drawer handoff.
5. Unassigned queue and inline recommendation panel.

Use Lucide icons, existing task colors, compact operational spacing, stable chart dimensions,
keyboard focus states, and accessible labels. Avoid decorative gradients, hero copy, or nested cards.

### 3.3 Interaction behavior

- Attention-bar clicks filter and scroll to the CS table.
- Table row expansion shows source tasks and opens existing task detail.
- Unassigned task selection shows recommendations without hiding dashboard context.
- Assignment is optimistic; rollback on network/error; show a conflict message and refetch on 409.
- Loading, stale, empty, and error states are explicit.

## Phase 4 — Realtime and verification

### 4.1 Realtime refresh

**Files:** `CSWorkloadOverview.tsx`, existing realtime integration as needed.

- Subscribe to `TASKS_TOPIC` using the established browser Supabase client.
- Debounce duplicate pings and refetch on reconnect.
- Keep last good snapshot while a refresh is pending.
- Tick display time/SLA labels every 30 seconds without refetching.

### 4.2 Automated verification

Run:

```bash
npm run typecheck
npm run lint
npm run test:run
npm run build
```

Fix all failures introduced by the feature. Re-check `supabase/schema.sql` is idempotent and call
out that the new SQL function must be applied to the live Supabase database.

### 4.3 Browser verification

Start a local dev server on an available port. Inspect the Overview tab at desktop and mobile
widths, including empty state, dense CS pool, selected attention bar, expanded row, unassigned
recommendation, optimistic assign, and stale/error state. Check chart SVGs are nonblank and no
labels or controls overlap.

## File summary

- Updated spec: `docs/superpowers/specs/2026-07-15-cs-capacity-dashboard-design.md`
- New plan: `docs/superpowers/plans/2026-07-15-cs-capacity-dashboard.md`
- Domain: `src/lib/tasks/overview-types.ts`, `src/lib/tasks/overview.ts`, `src/lib/tasks/overview-data.ts`
- API: `src/app/api/tasks/overview/route.ts`, `src/app/api/tasks/[id]/assign/route.ts`
- UI: `TaskToolbar.tsx`, `TaskBoardClient.tsx`, `CSWorkloadOverview.tsx` and focused child files
- Schema: `supabase/schema.sql`
- Tests: overview unit/API coverage

## Implementation Status

- [x] Domain aggregation, thresholds, chart totals, exceptions, and projected recommendation.
- [x] Admin-only overview and atomic assignment APIs.
- [x] Overview tab with attention chart, work-mix matrix, CS table, drill-down, and
  unassigned queue.
- [x] Realtime refresh, optimistic assignment, rollback, conflict handling, and stale snapshot UI.
- [x] `npm run typecheck`, `npm run lint`, `npm run test:run` (`320` tests), `npm run build`, and
  local unauthenticated route smoke check.
- [ ] Authenticated desktop/mobile visual pass requires an admin browser session; the local server
  currently redirects `/tasks` to `/signin`.
