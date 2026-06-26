# Task Board — Assignment & Visibility Overhaul + Performance Pass

Date: 2026-06-27
Branch: `main` (work on a new feature branch)
Status: Approved (design direction)

End-to-end design for three pieces, ordered as implementation phases:

- **Phase 0 — Performance pass** (approved earlier): kill the per-request auth DB
  cost and redundant drawer fetches.
- **Phase 1 — Agent groups + agent-scoped visibility (C1)**: admin manages which
  CS belong to which agent; CS see tasks of agents they belong to.
- **Phase 2 — Multi-assignee (C2)**: a task can be assigned to several people.

Phases are independent enough to land/verify separately, but share the
access/query layer so they live in one spec.

---

## Agreed model (Phases 1–2)

- **Membership**: many-to-many **agent ↔ CS**, admin-managed via a new screen.
- **Visibility (CS)** — a CS sees a task if ANY holds:
  - `task.agent_email` ∈ the agents the CS belongs to, **or**
  - the CS is one of the task's assignees, **or**
  - the CS is a participant (was @mentioned — existing Project B behavior).
  Managers see everything.
- **Assign (add/remove assignees)**: manager, **or** a CS who belongs to the
  task's agent.
- **Edit fields/status (`canMutateTask`)**: manager **or** any assignee.
  (A CS in the agent who isn't assigned can self-assign first — one click, since
  they have assign rights. Decision; flip to "any agent member can edit" if
  preferred.)
- **Invariant kept**: `status = 'backlog'` ⇔ the task has **0 assignees**;
  any non-backlog status ⇒ ≥1 assignee. `agent_email` is independent of
  assignment, so a backlog task can carry an agent and be visible to that agent's
  CS to pick up.

---

## Phase 0 — Performance pass

Bottlenecks found:

1. **`auth()` does ~5 DB round-trips per request.** `jwt` callback runs on every
   `auth()` and calls `getUserAccessByEmail` (4 sequential queries) + a separate
   `agent_id` query. Every API call pays this; opening a task fires 2–3 calls.
2. **CommentThread re-fetches `/api/tasks/members`** every open, though the list
   (`assignees`) is already loaded at the board/drawer level.
3. **comments GET signs attachment URLs sequentially** in an `await` loop.

Changes:

- **`getUserAccessByEmail` → one nested PostgREST query**
  (`portal_account → user_roles → roles → role_permissions`) and select
  `agent_id` in the same row. Extract a pure `flattenAccess(row)` (active roles +
  deduped permissions + agentId) for unit testing. `jwt` callback calls it once
  and drops its separate `agent_id` query. → 5 round-trips → 1.
- **CommentThread**: accept a `members` prop (pass the drawer's `assignees`);
  delete the `/api/tasks/members` fetch.
- **comments GET**: sign attachment URLs with `Promise.all`, only when present.
- No JWT permission caching (chosen: always fresh).

Tests: `flattenAccess` (roles/perms/agentId from a nested row; ignores inactive
roles; dedups). Manual: time opening a task before/after.

---

## Phase 1 — Agent groups + agent-scoped visibility (C1)

### Data
- `agent_members (agent_email text, cs_email text, created_at timestamptz default
  now(), primary key (agent_email, cs_email))`; indexes on `cs_email` and
  `agent_email`; RLS on (service-role only). Admin-managed.
- `agent_email` continues to reference an agent account
  (`portal_account` with role `agent`).

### Access layer
- `lib/tasks/membership.ts`:
  - `fetchAgentsForCs(email): Promise<string[]>` — agent emails the CS belongs to.
  - `fetchVisibleTaskScope(email)` (helper used by queries) returning the CS's
    agent list (and reused for `canViewTask`).
- `canViewTask(actor, task, { isAssignee, isAgentMember, isParticipant })` —
  refactor to take resolved booleans (pure, testable). Manager → true; else any
  flag true.
- `queries.fetchTasksForActor` (CS): tasks where
  `agent_email IN (myAgents)` OR `id IN (my assigned ids)` OR
  `id IN (my participant ids)` — built with `.or(...)` over the three sets.
- `canAssignToTask(actor, task, isAgentMember)` — manager or agent member.

### Admin screen
- New page **Management → Agent Groups** (gated by `management.account_manager`).
  - Left: agents (accounts with role `agent`). Select one → manage its CS members
    (add/remove from `agent_members`); a CS can appear under multiple agents.
  - API: `GET/POST/DELETE /api/admin/agent-members` (admin-only).

### Create flow
- CS create: an **Agent** selector scoped to the creator's agents (pre-selected
  if exactly one); sets `agent_email` so teammates see it. Manager create: agent
  optional (any agent). `agent_email` stays nullable at the DB level; a task with
  no agent is visible only to its assignees + manager.

### Tests
- `canViewTask` flag combinations (agent member but not assignee → true; none →
  false; manager → true).
- membership flatten/resolve helpers.

---

## Phase 2 — Multi-assignee (C2)

### Data
- `task_assignees (task_id uuid references tasks(id) on delete cascade, email
  text, created_at timestamptz default now(), primary key (task_id, email))`;
  index on `email`; RLS on.
- **Migration**: backfill from `tasks.assignee_email`
  (`insert ... select where assignee_email is not null`). The junction becomes the
  source of truth; `assignee_email` reads are replaced everywhere. Keep the column
  temporarily (nullable, unused) and drop in a follow-up once verified.

### Access / invariant
- `canMutateTask(actor, task, isAssignee)` — manager or assignee (refactored to a
  boolean flag; callers resolve membership from the junction).
- Assign endpoint manages the set + keeps the invariant: adding the first
  assignee to a backlog task moves it to `todo`; removing the last assignee moves
  it to `backlog` and clears `waiting_reason`.
- `TaskRow` gains `assignees: string[]` (resolved in queries); `assignee_email`
  removed from the type once migration lands.

### API
- `POST /api/tasks/[id]/assignees { email }` and
  `DELETE /api/tasks/[id]/assignees/[email]` — gated by `canAssignToTask`;
  enforce the invariant; notify the added assignee; broadcast task room + tasks
  stream.
- Create/PATCH updated to write the junction.

### UI
- Card/row/drawer show an **avatar stack** of assignees (overflow "+N").
- Assignee control becomes **multi-select** (add/remove); shown to managers and
  CS-in-agent.
- Assignee filter matches if the user is **any** assignee.
- Notifications: notify each newly added assignee.

### Tests
- Invariant transitions (first add → todo; last remove → backlog + clear waiting).
- Assignee filter matches any-of.

---

## Cross-cutting

- **RLS**: add `agent_members`, `task_assignees` to the protected-tables loop in
  `schema.sql`.
- **Realtime**: assignee/visibility changes already covered by the `tasks-stream`
  broadcast added earlier (board/list refetch). Admin membership changes don't
  need realtime (rare).
- **Permissions matrix** (final):
  | Action | Manager | CS in task's agent | CS not in agent |
  | --- | --- | --- | --- |
  | View | ✓ all | ✓ | only if assignee/mentioned |
  | Assign | ✓ | ✓ | ✗ |
  | Edit fields/status | ✓ | only if assignee | only if assignee |
  | Comment | ✓ | ✓ (can view) | only if assignee/mentioned |

## Migration / rollout order
1. Phase 0 (perf) — safe, no behavior change.
2. Phase 1 — add `agent_members` + admin screen; visibility widens only after
   admin populates groups (graceful: empty groups = today's behavior).
3. Phase 2 — add `task_assignees`, backfill, switch reads, multi-select UI.

## Risks / decisions
- Edit rights = manager or assignee (not "any agent member"); revisit if it feels
  restrictive.
- `assignee_email` removed only after the junction is verified (two-step to avoid
  a risky big-bang migration).
- Tasks with no `agent_email` aren't group-visible — create flow nudges CS to set
  an agent.
- Membership keyed by email (consistent with the rest of the task code).
