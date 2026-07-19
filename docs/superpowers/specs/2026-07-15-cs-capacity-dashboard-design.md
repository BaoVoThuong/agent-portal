# CS Workload Overview — Design

## Purpose

An admin-only `Overview` tab alongside Board / List / Backlog. The primary job is to
give a task manager a trustworthy, at-a-glance picture of the **current workload and
operational risk of every CS**, so the manager can decide where to intervene, rebalance,
or assign work.

Recommendation-assisted assignment is an append to that dashboard. It must be explainable
from the same visible metrics; it is not the primary product or the primary screen signal.

## Goals

- Understand workload across the whole CS pool, including CS with zero tasks.
- See where work is concentrated by count, task stage, priority, SLA exposure, and risk.
- Identify the few people/tasks that need attention now.
- Drill from a chart or CS row to the underlying task list/detail.
- Surface unassigned work and provide a shortlist when the manager chooses to assign it.
- Keep the dashboard useful when there are no unassigned tasks or when recommendation is not used.

## Non-goals (v1)

- Auto-assignment: the manager always confirms an assignment.
- Historical trends, scorecards, leaderboards, or performance ratings.
- Presence/attendance detection. Task activity is an informational field only.
- Drag-to-rebalance UI. The dashboard may flag a need to rebalance.
- Agent/assistant self-view. v1 is admin-only.

## Admin mental model

The screen answers these questions in order:

1. **How much work exists?** KPI strip: CS pool, open tasks, urgent/high tasks, risk flags,
   and unassigned backlog.
2. **What needs attention?** Attention chart: risk categories and the people affected.
3. **Who is carrying what?** Full CS table with stage mix, priority mix, load bars, flags,
  activity, and drill-down.
4. **What should I do with unassigned work?** Unassigned queue, with recommendation shown
  only after a task is selected.

## Dashboard layout and visualizations

### Header

- Title: `CS Workload Overview`.
- Small `Updated <relative time>` label and an icon refresh button.
- No board date filter is applied. The dashboard is always current and uses `now` supplied by
  the server plus a 30-second clock tick for live SLA display.
- Realtime task-change events trigger a debounced overview refetch. Reconnect also refetches.
- A stale/error state preserves the last good snapshot and clearly labels it.

### 1. KPI strip

Five compact metric tiles, not interactive cards containing other cards:

- `CS pool`: active plain-CS workers included in the dashboard, with zero-load count.
- `Open tasks`: todo + in_progress + waiting, counted once per task at the total level.
- `Urgent / high`: open urgent + high tasks, counted once per task at the total level.
- `Needs attention`: open tasks covered by overdue, todo-stuck, waiting-stuck, or unknown-SLA flags.
- `Unassigned`: backlog tasks with no assignee.

Clicking a KPI filters or scrolls to the relevant dashboard section. The values have accessible
text labels; color is never the only signal.

### 2. Attention chart

A compact horizontal bar chart with one bar per risk category:

- Overdue in_progress.
- Todo-stuck.
- Waiting-stuck.
- In-progress with unknown remaining effort because its active SLA window has ended.

Bars show task count and affected-CS count. Clicking a bar filters the CS table to people with
that flag. A zero-value category remains visible only when it is useful for the legend; the chart
must not create a false sense of risk.

### 3. Work mix summary

A small, always-visible summary band beside the attention chart:

- A compact stage x priority matrix with rows for `todo overdue/stuck`, `todo`, `in_progress overdue`, `in_progress`, and `waiting`.
- Columns for `urgent`, `high`, `medium`, and `low`, with row totals and column totals.
- Cell intensity shows where open work is concentrated while keeping exact counts visible.
- Overdue/stuck `todo` tasks and active-SLA-overdue `in_progress` tasks are removed from their
  normal stage rows and counted only in the dedicated overdue rows.

These are totals across the pool and provide context for the detailed CS table.
No donut chart is used; the manager needs exact cross-counts, not slices.

### 4. CS workload table — the dashboard source of truth

The table is a flat list, one row per CS, including zero-load CS. It is below the charts and is the
most detailed and authoritative view. Columns:

- CS name and email fallback, plus compact metadata for oldest open task and done in the last 24h.
- Plain text status, color-coded without a leading dot or pill wrapper.
- Workload summary: open count plus a compact nested table with `Stage`, `Total`, `OK`, and `Issue`
  columns. It splits normal work from overdue/stuck work: `Todo OK / Todo overdue`,
  `Doing OK / Doing overdue`, and `Waiting OK / Waiting stuck`.
  Urgent/high pressure is shown as a compact secondary line above the stage split.
- SLA summary: human-readable duration, band label, and a normalized bar.
- Row action to expand the underlying open tasks.

All columns sort. Default is status/risk first, then lowest load, then lowest count; a direction
toggle is explicit. Search filters by CS name/email. Attention-bar filters stay in sync with the table.

Expanding a row shows task title, agent, full stage/priority detail, flags, and SLA load contribution.
Clicking the task opens the existing task detail drawer. This is the drill-down that makes every chart
and flag actionable.

### 5. Unassigned queue and optional recommendation panel

The unassigned queue is below the CS table. It is not the dashboard headline. Each row shows title,
agent, category, priority, age, and SLA urgency (the shortest effective SLA first; SLA is not active
until work starts).

Selecting a row opens an inline recommendation panel. The panel shows the top five valid CS and a
`See all` control. Each candidate repeats dashboard-visible facts:

`Status · open count · SLA exposure · urgent/high pressure · in_progress count · risk flags`.

The `why` text must be generated from those facts, for example: `0 in progress, low urgent/high
pressure, no risk flags`. Recommendation never hides the dashboard or replaces its charts.

On assignment, the queue removes the task optimistically and the table updates optimistically,
and the client refetches. A concurrent claim returns `409 Conflict`; the panel explains that the
task was already assigned and refetches the snapshot.

## Metrics and aggregation contract

All calculations are server-authoritative and use all non-archived tasks, independent of the board
date filter. The response includes `generatedAt` and a stable threshold/config version.

### Pool

The plain-CS pool is:

`active portal_account with task.work permission`

minus:

- accounts that are admins (legacy admin role or active Admin/Super Admin system role),
- accounts in `task_agents`,
- accounts with any `agent_members.is_assistant = true` membership.

The pool is deduplicated by normalized email and includes zero-load people. The endpoint returns
an exception count/list for open tasks assigned to accounts outside this pool, because those tasks
must not silently disappear from the manager's view.

### Three independent workload signals

The dashboard never multiplies priority by SLA. It keeps these signals separate:

1. **Open count**: todo + in_progress + waiting. At total-dashboard level, a multi-assignee task
   counts once; in a person's row it counts for every responsible assignee.
2. **SLA load minutes**: a transparent SLA-budget proxy, not effort and not an ETA-to-free.
3. **Priority pressure**: sum of `urgent=4, high=3, medium=2, low=1` over open tasks. This is
   context/urgency pressure, not time.

SLA load contribution:

- Active in_progress: `max(slaRemainingSeconds, 0) / 60`.
- Over-budget active in_progress: full effective SLA minutes plus an `overdue` flag.
- Post-Waiting/post-resolved-overdue in_progress: full effective SLA minutes plus an
  `unknown_effort` flag. This is deliberately conservative and is shown as unknown in the UI;
  it is not called overdue unless the live helper says it is overdue.
- todo: full effective SLA minutes.
- waiting: one third of effective SLA minutes.
- backlog: never assigned and never part of a CS load.

The full-SLA fallback is a visible conservative proxy, not a claim that the person needs that many
minutes. Thresholds are configurable constants and must be displayed in the dashboard legend/help
text when load status is shown.

### Risk and status

Risk flags are absolute:

- `overdue`: active in_progress currently breaching SLA.
- `todo_stuck`: current todo stint older than `todo_hours`.
- `waiting_stuck`: current waiting stint older than `waiting_hours`.
- `unknown_effort`: post-active in_progress fallback as described above.
- `oldest_open_age`: oldest current open task age, informational and sortable.

Badge status uses three inputs: risk level, SLA-load level, and priority-pressure level. Raw count
is displayed and used in ranking but has no hidden magic-count badge threshold.

Initial tunable defaults:

- SLA load: `Busy` at 8h, `Overloaded` at 16h.
- Pressure: `Busy` at 6 points, `Overloaded` at 10 points.
- Any overdue/todo-stuck/waiting-stuck gives at least `Busy`; unknown_effort is a visible warning
  but does not automatically mean overdue.

`status = max(riskLevel, slaLoadLevel, pressureLevel)`. Global-relative values are used only to
   normalize chart/table bars and to break ties, never to assign the badge.

### Pulse

- Done in last 24h / 7d means `status = done` and `closed_at` in the window, credited to current
  assignees. `cancel` is not counted as done; if needed later, expose a separate closed/cancelled
  metric.
- Last task activity is the maximum `tasks.last_activity_at` among the person's current tasks.
  It is task recency, not proof of CS presence. Missing activity is neutral.

### Recommendation ranking

Recommendation is computed from the same aggregate metrics after hypothetically adding the selected
backlog task as a todo task to the candidate. It uses a deterministic lexicographic comparator:

- urgent/high task: candidate risk level, current in_progress count, projected urgent/high pressure,
  projected SLA load, projected open count, stable email.
- medium/low task: candidate risk level, projected SLA load, projected open count, projected
  pressure, stable email.

The candidate's `why` string is generated from the first decisive comparator facts. Fit by category
or agent remains out of v1.

## Data and API

- `GET /api/tasks/overview`: admin-only, `Cache-Control: no-store`; returns generatedAt, thresholds,
  KPI totals, attention bars, work-mix totals, CS rows with task summaries,
  unassigned tasks, and out-of-pool exceptions.
- The route uses server aggregation; it does not ship unrelated board tasks to the client.
- `POST /api/tasks/[id]/assign`: admin-only atomic claim for a backlog task. It accepts task id,
  CS email, expected `updated_at`, and actor email from the session. A Postgres RPC locks the task,
  verifies backlog/no assignee and valid active pool membership, updates the task + assignee junction,
  assignment cycle, stage cycle, activity, and returns `409` on conflict. Notifications and the
  global task-change broadcast happen after commit.
- Realtime listens to the existing global task-change topic and refetches the overview with a short
  debounce. The refresh button is always available.

## Edge cases

- Multi-assignee open task counts once in global totals and once per responsible CS row.
- CS in multiple agent teams has one global row; teams do not restrict capacity or recommendation.
- CS with zero tasks is visible and is a valid candidate.
- Reopened task clears its done pulse and returns to open load.
- Done-awaiting-QC is excluded from CS open load because it is the agent's QC queue.
- Null `sla_minutes` uses `effectiveSlaMinutes` from priority/category rules.
- Archived tasks are excluded everywhere in the dashboard.
- Existing assignments to excluded/inactive/unknown accounts appear in out-of-pool exceptions.

## Testing

- Pure aggregation: pool dedupe, zero-load rows, stage/priority totals, multi-assignee semantics,
  SLA contributions, unknown_effort fallback, flags, pulse attribution, and absolute badge levels.
- Pure dashboard model: scatter points, attention counts, work-mix totals, deterministic sort, and
  recommendation ranking using projected candidate metrics and explainable reasons.
- Integration: admin-only route, no-store response, archived exclusion, exception reporting,
  unassigned correctness, invalid/inactive candidate rejection, and atomic assign `409` race.
- UI: chart keyboard/aria labels, chart-to-table filtering, row drill-down, optimistic assignment,
  conflict recovery, loading/error/stale states, and realtime refetch.

## Out of scope

Auto-assign, historical charts, real presence, capacity editing, drag-to-rebalance, fit learning,
agent self-view, and effort tracking beyond the explicit SLA-load proxy.
