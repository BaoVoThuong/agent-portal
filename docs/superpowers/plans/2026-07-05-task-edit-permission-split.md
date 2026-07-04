# Plan — Split edit-content from change-status permission

Spec: `docs/superpowers/specs/2026-07-05-task-edit-permission-split-design.md`

1. `src/lib/tasks/access.ts`
   - Rename `canEditTask` → `canEditTaskFields`: `isManager || agent_email === actor.email`.
   - Add `canChangeTaskStatus(actor, task, isAssignee)`:
     `isManager || agent_email === actor.email || isAssignee`.
   - `canAssignToTask` calls `canEditTaskFields`.
   - `canDeleteTask` unchanged.
2. `src/lib/tasks/transitions.ts` — `resolveTaskPatch` takes
   `{ canEditFields, canChangeStatus, canAssign, canReviewDone, nowIso }`;
   field-shape edits (title/description/fub_link/priority/category/agent_email)
   require `canEditFields`; status/waiting-adjacent edits require
   `canChangeStatus`. (`waiting_reason` handling removed here per the SLA
   spec — coordinate order of these two changes so this file isn't edited
   twice; do the permission split first, land it, then the SLA spec removes
   the waiting_reason block entirely.)
3. `src/app/api/tasks/[id]/route.ts` — `resolveTaskAccess` already resolves
   `isAssignee`; pass it into both the `canMutate`/content check and the
   status-only fallback so the second branch is no longer permanently
   `false`.
4. `src/app/api/tasks/[id]/attachments/route.ts` — swap `canEditTask` →
   `canEditTaskFields`.
5. `TaskBoardClient.tsx`, `TaskListView.tsx` — mirror the split client-side
   (need `isAssignee` computed client-side too — check how `assignees` is
   already available on `TaskRow` for the open task, e.g.
   `task.assignees.includes(currentEmail)`).
6. Tests: `access.test.ts` (assignee-only can change status, not fields;
   reporter-only can do neither; agent-owner can do both), `transitions.test.ts`
   (status-only patch succeeds with only `canChangeStatus`, rejected without
   it; field patch rejected without `canEditFields` even with
   `canChangeStatus`).
7. `npm run test:run`, `npm run typecheck`, `npm run build` — fix failures.
8. Commit.
