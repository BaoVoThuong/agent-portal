# Task Board — Split "Edit Content" from "Change Status"

Date: 2026-07-05 (corrected same day — see note)
Branch: `main`
Status: Implemented

## Correction note

An earlier version of this doc was written against a stale read of
`access.ts` (a `canEditTask(actor, task)` keyed on `agent_email`/
`reporter_email`). The actual current code (confirmed by fresh `Read` +
`grep` + passing tests) already went through the "Assignment & Visibility
Overhaul" refactor from `2026-06-27-assignment-visibility-and-perf-design.md`:
permission functions take **resolved boolean flags**
(`isAssignee`, `isAgentOwner`, `isAgentMember`), not raw task columns. This
version reflects and implements against that real baseline.

## Problem

Ask: only admin (manager) and the task's sales agent (`agent_email` owner)
should be able to edit a task's content; the reporter and the assignee
should not.

Current baseline (`src/lib/tasks/access.ts`):
- `canMutateTask(actor, task, isAssignee)` = `manager || isAssignee` — gates
  full content-field edits (title/description/priority/category/agent_email/
  fub_link) and task-level attachment uploads.
- `canChangeTaskStatus(actor, task, { isAssignee })` = `manager ||
  isAssignee` — same condition, separate function, used for the kanban
  drag/status-only patch path.
- `canAssignToTask(actor, isAgentMember)` = `manager || isAgentMember`
  (CS belongs to the task's agent team) — reassignment, unrelated to this ask.
- Reporter already has **no** special rights anywhere in the current code —
  that part of the ask is already true.

So the actual gap is narrower than first thought: assignee currently *can*
edit content (via `canMutateTask`), and the ask says they shouldn't. But
assignee must still be able to *change status* — they're the one doing the
work, and the SLA/overdue spec depends on it (assignee moves to In Progress,
later submits an overdue reason to unlock).

## Decision

- `canMutateTask`: keep the function, change what grants it. Third param
  becomes `isAgentOwner` (task's `agent_email === actor.email`) instead of
  `isAssignee`. `manager || isAgentOwner` only.
- `canChangeTaskStatus`: add `isAgentOwner` alongside the existing
  `isAssignee`. `manager || isAssignee || isAgentOwner`.
- `canAssignToTask` unchanged (agent-team based, not this ask's concern).
- `canReviewDoneTask` unchanged (`manager || agent_email owner`).

### Files (implemented)
- `src/lib/tasks/access.ts` — `canMutateTask` param renamed to `isAgentOwner`
  in meaning; `canChangeTaskStatus` flags gain `isAgentOwner`.
- `src/app/api/tasks/[id]/route.ts` — passes `access.isAgentOwner` to
  `canMutateTask` (was `access.isAssignee`); `canChangeTaskStatus` call gets
  both flags.
- `src/app/api/tasks/[id]/attachments/route.ts` — task-level upload gate
  computes `isAgentOwner` from `task.agent_email` directly (no longer needs
  an extra `isTaskAssignee` DB round-trip for this branch).
- `TaskBoardClient.tsx` — `canChangeStatusTask` adds `task.agent_email ===
  currentEmail`; `canEditOpen` (drawer content-edit gate) switches from
  `assignees.includes` to `agent_email === currentEmail`. The drawer
  (`TaskDetailDrawer`) has no separate status control, only content fields,
  so this one flag is sufficient there.
- `TaskListView.tsx` — its `canEdit` prop actually gates the inline **status**
  pill (not content — content editing happens in the shared drawer), so it
  gets the same treatment as `canChangeStatusTask`: add `agent_email ===
  currentEmail` alongside the existing assignee check.
- `access.test.ts` — updated to assert assignee-only grants status-change but
  not content-mutate; agent-owner grants both.

No schema change. No `transitions.ts` change needed — it already just takes
resolved patch data and doesn't call these permission functions itself (the
route resolves permission before shaping the patch).
