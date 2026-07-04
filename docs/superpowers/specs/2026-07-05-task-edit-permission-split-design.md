# Task Board — Split "Edit Content" from "Change Status"

Date: 2026-07-05
Branch: `main`
Status: Approved (delegated — user asked for design + implementation, no review round)

## Problem

Request: only admin (manager) and the task's sales agent (`agent_email` owner)
should be able to edit a task; the reporter (creator) and the assignee should
not be able to edit.

Today `canEditTask` = `isManager || agent_email === me || reporter_email === me`,
and `canChangeTaskStatus` literally calls `canEditTask` — they are the same
permission. If we just remove `reporter_email` (and never add assignee) from
that one function, status changes break too: a CS worker who self-creates and
self-assigns a task (the normal worker flow — see `resolveCreateAssignment`)
is both reporter and assignee, so today they can drag their own card across
the board *only* because they're the reporter. Removing reporter rights from
the same function that also gates status would leave workers unable to move
their own tasks from To Do → In Progress → Done at all, which breaks the
board and contradicts point 3 of this same request (assignee must be able to
move to In Progress and later submit an overdue reason to unlock).

## Decision

Split one permission into two:

- **`canEditTaskFields`** (content: title, description, `fub_link`, priority,
  category, `agent_email`, reassignment) = `isManager || agent_email === me`.
  Reporter and assignee no longer qualify on their own.
- **`canChangeTaskStatus`** (status, `waiting_reason`/overdue reason, kanban
  position) = `isManager || agent_email === me || isAssignee`. This is a new,
  looser check so the person doing the work can still progress it — required
  for the SLA/overdue flow in the next spec.

`canAssignToTask` keeps calling the fields-permission (reassigning is a
content-ish action reserved for manager/agent owner — unchanged behavior
except reporter loses it, consistent with the ask).

`canDeleteTask` unchanged (manager only).

### Files
- `src/lib/tasks/access.ts` — rename `canEditTask` → `canEditTaskFields`,
  add `isAssignee` param; add new `canChangeTaskStatus(actor, task, isAssignee)`
  independent of it (currently defined as an alias, see line ~97).
- `src/lib/tasks/transitions.ts` — `resolveTaskPatch` takes the two resolved
  booleans instead of one.
- `src/app/api/tasks/[id]/route.ts` — `resolveTaskAccess` already resolves
  `isAssignee`; wire it into both checks instead of only view.
- `src/app/api/tasks/[id]/attachments/route.ts` — uses `canEditTask` today for
  upload gating; switch to `canEditTaskFields` (attachments are content).
- `TaskBoardClient.tsx`, `TaskListView.tsx` — mirror the same split
  client-side (used only for UI gating; server is authoritative).
- `access.test.ts`, `transitions.test.ts` — update/add cases: assignee-only
  (not manager/agent) can change status but not fields; reporter-only can do
  neither.

No schema change.
