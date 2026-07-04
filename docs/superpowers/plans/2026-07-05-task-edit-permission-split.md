# Plan — Split edit-content from change-status permission

Spec: `docs/superpowers/specs/2026-07-05-task-edit-permission-split-design.md`
(corrected same day against the real current `access.ts` baseline — see the
spec's correction note).

## Done
1. `src/lib/tasks/access.ts` — `canMutateTask(actor, task, isAgentOwner)` =
   `manager || isAgentOwner`; `canChangeTaskStatus(actor, task, { isAssignee,
   isAgentOwner })` = `manager || isAssignee || isAgentOwner`.
2. `src/app/api/tasks/[id]/route.ts` — `canMutateTask` call passes
   `access.isAgentOwner`; `canChangeTaskStatus` call passes both flags.
3. `src/app/api/tasks/[id]/attachments/route.ts` — task-level upload gate
   computes `isAgentOwner` from `r.task.agent_email` directly.
4. `TaskBoardClient.tsx` — `canChangeStatusTask` adds agent-owner;
   `canEditOpen` becomes agent-owner-only (drawer has no separate status
   control).
5. `TaskListView.tsx` — row `canEdit` (gates the status pill) adds
   agent-owner.
6. `access.test.ts` — updated assertions + a new case for agent-owner
   granting both mutate and status-change.
7. `npm run test:run` — 208/208 pass. `npm run typecheck` — clean.

## Remaining
- `npm run build` as part of the final verification pass (bundled with the
  other two features' build check before the implementation commit).
- Manual smoke check once the dev server is up: log in as a CS who is
  assigned-but-not-agent-owner on a task, confirm the drawer's fields are
  now read-only but the kanban card / list status pill still lets them
  progress it.
