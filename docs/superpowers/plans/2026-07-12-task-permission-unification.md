# Task Permission Unification — Implementation Plan

> **For a human implementer:** hand-coding plan. The pure permission logic is
> TDD'd first (it's the whole point — one tested source of truth). Wiring is
> verified with `npm run typecheck && npm run lint && npm run test:run && npm run build`.

**Goal:** Collapse the tangled task-permission model (RBAC `task.manage`/`task.work` + agent-owner + `is_assistant` + team-member) into **one tested pure resolver** used identically by the server and the client, and apply three agreed behaviour fixes. No new Agent/Admin UI yet — this only makes the foundation clean and consistent.

**Architecture:** Add `resolveTaskCapabilities(actor, flags)` in `src/lib/tasks/access.ts` returning a single `TaskCapabilities` object. Every route resolves the per-task membership flags (as it already does) and calls the resolver; the client calls the **same** function with the flags it already knows (assignees, agent owner/assistant, participant, reporter), deleting its duplicated permission logic. This kills the server/client drift that currently lets an Assistant see a QC button the server rejects.

**Tech Stack:** Next.js App Router (see `agent-portal/AGENTS.md`), Supabase (service-role, server-only), Vitest, TypeScript.

## Global Constraints

- `src/lib/tasks/access.ts` stays pure + unit-tested; it is the ONLY place capability decisions are made. The client no longer re-derives them.
- No schema change. No new RBAC permission keys.
- New UI text in English. Do NOT push to the `vercel` remote. Commit after each task.

## Agreed model (target)

Three capability tiers per task:

- **Admin** = `task.manage` → every capability, on every task.
- **Agent-level** = the task's agent owner (`agent_email === email`) OR a promoted Assistant (`is_assistant`) of that agent — resolved by the existing `isAgentOwnerOrAssistant`. Full control of **that** task (edit, status, assign, delete, QC, reopen). Agent and Assistant are identical.
- **CS** = `task.work`, sees the task via assignment / team-membership / participation, and may change status **only on tasks assigned to them** (plus comment/view). No content-edit, assign, delete, or QC.

Three behaviour fixes vs today:
1. **CS can no longer change the status of a teammate's task** — drop `isAgentMember` from the status capability, and remove the "team status confirm" dialog entirely.
2. **Assistant can QC** — the server `canReviewDoneTask` currently allows only the literal agent; make it accept the resolved `isAgentOwner` flag (owner OR assistant).
3. **One resolver, both sides** — client deletes its ad-hoc `canChangeStatusTask` / `needsTeamStatusConfirm` / local `canReviewDoneTask` / `isAgentOwnerOrAssistantOf` / `isAgentTeamMemberOf` and calls `resolveTaskCapabilities`.

## Capability truth table (what the resolver must produce)

Given `flags = { isAssignee, isAgentOwner, isAgentMember, isReporter, isParticipant }`:

| capability | Admin | Agent-level (`isAgentOwner`) | CS |
|---|---|---|---|
| `canView` | ✓ | ✓ | `isAssignee || (isAgentMember && task has assignee) || isParticipant` |
| `canEditContent` | ✓ | ✓ | `isReporter` |
| `canChangeStatus` | ✓ | ✓ | `isAssignee` |
| `canAssign` | ✓ | ✓ | ✗ |
| `canDelete` | ✓ | ✓ | ✗ |
| `canReviewQC` | ✓ | ✓ | ✗ |
| `canReopen` | ✓ | ✓ | `isAssignee` |

(`canReopen` == `canChangeStatus`; kept as its own field for call-site clarity. A non-worker with no flags gets everything `false`.)

## File Structure

- `src/lib/tasks/access.ts` — add `TaskCapabilities` + `resolveTaskCapabilities`; change `canChangeTaskStatus` and `canReviewDoneTask`; keep the rest.
- `src/lib/tasks/access.test.ts` — rewrite the capability tests around the resolver + the two changed functions.
- `src/app/api/tasks/[id]/route.ts` — use the resolver; drop the team-confirm key; fix the QC call.
- `src/app/api/tasks/[id]/overdue-unlock/route.ts`, `reopen/route.ts` — unchanged logically (they already gate on assignee/owner, not team) but verify.
- `src/app/(authed)/tasks/_components/TaskBoardClient.tsx` — replace ad-hoc gating with the resolver; delete the confirm dialog.
- `src/app/(authed)/tasks/_components/TaskListView.tsx`, `TaskRowItem.tsx`, `TaskDetailDrawer.tsx` — consume resolver-derived booleans passed down (no new logic).

---

## Task 1: The resolver + the two function changes (pure, TDD)

**Files:** modify `src/lib/tasks/access.ts`, `src/lib/tasks/access.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export type TaskMembershipFlags = {
    isAssignee?: boolean;
    isAgentOwner?: boolean;   // owner OR assistant, already resolved by isAgentOwnerOrAssistant
    isAgentMember?: boolean;  // on the agent's team (any agent_members row)
    isReporter?: boolean;
    isParticipant?: boolean;
  };
  export type TaskCapabilities = {
    canView: boolean; canEditContent: boolean; canChangeStatus: boolean;
    canAssign: boolean; canDelete: boolean; canReviewQC: boolean; canReopen: boolean;
  };
  export function resolveTaskCapabilities(
    actor: TaskActor,
    task: Pick<TaskRow, "assignee_email">,
    flags?: TaskMembershipFlags
  ): TaskCapabilities;
  ```
- Changed:
  - `canChangeTaskStatus(actor, task, { isAssignee?, isAgentOwner? })` — **drop** `isAgentMember`.
  - `canReviewDoneTask(actor, { isAgentOwner? })` — replace the `agent_email === email` check with the passed flag.

- [ ] **Step 1: Write failing tests** in `access.test.ts`. Replace/extend the existing status + review tests with:

```ts
import { buildTaskActor, canChangeTaskStatus, canReviewDoneTask, resolveTaskCapabilities } from "@/lib/tasks/access";

const admin = buildTaskActor(["task.manage"], "admin@x.com");
const cs = buildTaskActor(["task.work"], "cs@x.com");
const none = buildTaskActor([], "no@x.com");
const task = { assignee_email: "cs@x.com" };

describe("canChangeTaskStatus (team members can no longer move teammates)", () => {
  it("assignee or agent owner can; a plain team member cannot", () => {
    expect(canChangeTaskStatus(cs, task, { isAssignee: true })).toBe(true);
    expect(canChangeTaskStatus(cs, task, { isAgentOwner: true })).toBe(true);
    expect(canChangeTaskStatus(cs, task, { isAgentMember: true } as never)).toBe(false);
    expect(canChangeTaskStatus(admin, task, {})).toBe(true);
  });
});

describe("canReviewDoneTask (assistant/owner allowed via flag)", () => {
  it("admin and agent-owner/assistant can; plain CS cannot", () => {
    expect(canReviewDoneTask(admin, {})).toBe(true);
    expect(canReviewDoneTask(cs, { isAgentOwner: true })).toBe(true);
    expect(canReviewDoneTask(cs, {})).toBe(false);
  });
});

describe("resolveTaskCapabilities", () => {
  it("admin gets everything", () => {
    expect(resolveTaskCapabilities(admin, task, {})).toEqual({
      canView: true, canEditContent: true, canChangeStatus: true,
      canAssign: true, canDelete: true, canReviewQC: true, canReopen: true,
    });
  });
  it("agent-level gets everything on the task", () => {
    const c = resolveTaskCapabilities(cs, task, { isAgentOwner: true });
    expect(c).toEqual({
      canView: true, canEditContent: true, canChangeStatus: true,
      canAssign: true, canDelete: true, canReviewQC: true, canReopen: true,
    });
  });
  it("CS assignee: view + status + reopen only", () => {
    const c = resolveTaskCapabilities(cs, task, { isAssignee: true });
    expect(c.canView).toBe(true);
    expect(c.canChangeStatus).toBe(true);
    expect(c.canReopen).toBe(true);
    expect(c.canEditContent).toBe(false);
    expect(c.canAssign).toBe(false);
    expect(c.canDelete).toBe(false);
    expect(c.canReviewQC).toBe(false);
  });
  it("CS team member (not assignee): can view but not change status", () => {
    const c = resolveTaskCapabilities(cs, { assignee_email: "other@x.com" }, { isAgentMember: true });
    expect(c.canView).toBe(true);
    expect(c.canChangeStatus).toBe(false);
  });
  it("no board permission: nothing", () => {
    const c = resolveTaskCapabilities(none, task, { isAgentOwner: true, isAssignee: true });
    expect(Object.values(c).every((v) => v === false)).toBe(true);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/tasks/access.test.ts` → FAIL.

- [ ] **Step 3: Implement** in `access.ts`.
  - Change `canChangeTaskStatus` — remove `isAgentMember` from the type and the return:

```ts
export function canChangeTaskStatus(
  actor: TaskActor,
  task: Pick<TaskRow, "assignee_email">,
  flags: { isAssignee?: boolean; isAgentOwner?: boolean } = {}
): boolean {
  void task;
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return Boolean(flags.isAssignee) || Boolean(flags.isAgentOwner);
}
```

  - Change `canReviewDoneTask` — take the flag:

```ts
export function canReviewDoneTask(
  actor: TaskActor,
  flags: { isAgentOwner?: boolean } = {}
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return Boolean(flags.isAgentOwner);
}
```

  - Add the resolver (reuse the existing single-capability functions so there's no third copy of the rules):

```ts
export type TaskMembershipFlags = {
  isAssignee?: boolean;
  isAgentOwner?: boolean;
  isAgentMember?: boolean;
  isReporter?: boolean;
  isParticipant?: boolean;
};

export type TaskCapabilities = {
  canView: boolean;
  canEditContent: boolean;
  canChangeStatus: boolean;
  canAssign: boolean;
  canDelete: boolean;
  canReviewQC: boolean;
  canReopen: boolean;
};

// Single source of truth: resolve every per-task capability at once from the
// membership flags. Server routes and the client both call this with the same
// flags, so a capability can never disagree between the UI and the API.
export function resolveTaskCapabilities(
  actor: TaskActor,
  task: Pick<TaskRow, "assignee_email">,
  flags: TaskMembershipFlags = {}
): TaskCapabilities {
  const canView = canViewTask(actor, task, flags);
  const changeStatus = canChangeTaskStatus(actor, task, {
    isAssignee: flags.isAssignee,
    isAgentOwner: flags.isAgentOwner,
  });
  return {
    canView,
    canEditContent: canMutateTask(actor, task, {
      isAgentOwner: flags.isAgentOwner,
      isReporter: flags.isReporter,
    }),
    canChangeStatus: changeStatus,
    canAssign: canAssignToTask(actor, Boolean(flags.isAgentOwner)),
    canDelete: canDeleteTask(actor, Boolean(flags.isAgentOwner)),
    canReviewQC: canReviewDoneTask(actor, { isAgentOwner: flags.isAgentOwner }),
    canReopen: changeStatus,
  };
}
```

- [ ] **Step 4:** Test PASS. **Step 5:** `npm run typecheck` (will surface the changed-signature call sites — fixed in Task 2/3). Commit (`refactor(tasks): single resolveTaskCapabilities + CS-status/QC fixes`).

> Note: typecheck fails until Tasks 2–3 update the call sites of `canChangeTaskStatus`/`canReviewDoneTask`. That's expected; do 1→2→3 in order and only run the full green gate at the end of Task 3.

---

## Task 2: Server routes use the changed functions

**Files:** modify `src/app/api/tasks/[id]/route.ts`; verify `overdue-unlock/route.ts` and `reopen/route.ts`.

- [ ] **Step 1:** In `[id]/route.ts` PATCH, the review gate `const canReviewDone = canReviewDoneTask(r.actor, r.task);` → `canReviewDoneTask(r.actor, { isAgentOwner: access.isAgentOwner });`.

- [ ] **Step 2:** In the same file, the status-only gate that calls `canChangeTaskStatus(r.actor, r.task, { isAssignee, isAgentMember, isAgentOwner })` → drop `isAgentMember`.

- [ ] **Step 3:** Remove the team-status-confirm machinery entirely: the `TEAM_STATUS_CONFIRMED_KEY` constant, its membership in `STATUS_PATCH_KEYS`, and the `needsTeamStatusConfirm` block that returns the "Confirm before changing a teammate's task status" 400. A CS who is not the assignee now simply fails `canChangeStatus` (403), which is the desired behaviour.

- [ ] **Step 4:** Open `overdue-unlock/route.ts` and `reopen/route.ts` — confirm their `canChangeTaskStatus(actor, task, { isAssignee, isAgentOwner })` calls do **not** pass `isAgentMember` (they don't today). No change needed; just verify the signature still matches.

- [ ] **Step 5:** `npm run typecheck` for these files. Commit (`refactor(tasks): routes drop team status-change + wire QC flag`).

---

## Task 3: Client uses the resolver; delete duplicated logic + confirm dialog

**Files:** modify `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`; check props threaded to `TaskListView.tsx` / `TaskRowItem.tsx` / `TaskDetailDrawer.tsx`.

- [ ] **Step 1:** Add a per-task capability helper in `TaskBoardClient` built on the shared resolver:

```ts
import { resolveTaskCapabilities } from "@/lib/tasks/access";
// actor built once from the session role the client already has:
const actor = { email: currentEmail, isManager, isWorker: true };

function capabilitiesFor(task: TaskRow) {
  return resolveTaskCapabilities(actor, { assignee_email: task.assignees[0] ?? task.assignee_email }, {
    isAssignee: task.assignees.includes(currentEmail),
    isAgentOwner: isAgentOwnerOrAssistantOf(task.agent_email), // keep THIS helper (it's data, not policy)
    isAgentMember: isAgentTeamMemberOf(task.agent_email),       // keep THIS helper too
    isReporter: task.reporter_email === currentEmail,
    isParticipant: Boolean(task.viewer_is_participant),
  });
}
```

  Keep `isAgentOwnerOrAssistantOf` and `isAgentTeamMemberOf` — those resolve **membership data** from `myAssistantAgents` / `agentMembersByAgent`, not policy. Delete the **policy** duplicates below.

- [ ] **Step 2:** Replace the ad-hoc gates with `capabilitiesFor(task).*`:
  - `canChangeStatusTask(task)` → `capabilitiesFor(task).canChangeStatus`. Delete the old function.
  - `canReviewDoneTask(task)` (local) → `task.status === "done" && capabilitiesFor(task).canReviewQC`. Delete the local function.
  - `canDeleteOpenTask(task)` → `capabilitiesFor(task).canDelete`.
  - The drawer's `canDelete` / `canChangeStatus` / edit gates → the matching capability.

- [ ] **Step 3:** Delete the team-confirm flow: remove `needsTeamStatusConfirm`, `TEAM_STATUS_CONFIRMED_KEY`, and the `window.confirm(...)` branch inside `patchTask`. `patchTask` now just sends the patch; the server 403s if not allowed (already handled by the existing `revert()` + error toast).

- [ ] **Step 4:** In `TaskListView.tsx` (already receives `isManager`, `myAssistantAgents`, `agentMembersByAgent`, `currentEmail`): replace its inline `canEdit` / `canAssign` expressions on `TaskRowItem` with the resolver (build the same `capabilitiesFor` there, or lift it to a shared prop passed down). Ensure `canEdit` → `canChangeStatus || canEditContent` semantics the row actually needs (the row uses `canEdit` for the status pill + assignee menu; map: status pill uses `canChangeStatus`, assignee menu uses `canAssign`). Split the row's `canEdit`/`canAssign` props to the precise capabilities so a CS assignee can move status but not reassign.

- [ ] **Step 5:** Full gate: `npm run typecheck && npm run lint && npm run test:run && npm run build` → all green. Manual check: as a plain CS, a teammate's task shows **no** status dropdown and **no** QC button, and dragging it is blocked; your own assigned task still moves. Commit (`refactor(tasks): client gating via shared resolveTaskCapabilities; drop team-confirm`).

---

## Self-Review

- **Coverage:** decision 1 (Agent=Assistant) → both map to `isAgentOwner` in the resolver; decision 2 (CS not teammate status) → `canChangeTaskStatus` drops `isAgentMember` + confirm dialog removed (Tasks 1–3); decision 3 (Assistant QC) → `canReviewDoneTask` flag + route wiring (Tasks 1–2); decision 4 (no new Agent/Admin UI) → none added, CS UI only tightened. ✓
- **The QC drift bug** is structurally fixed: server and client both call `canReviewDoneTask(actor, { isAgentOwner })` via the one resolver, so they cannot disagree.
- **Placeholders:** Task 1 is complete tested code; Tasks 2–3 name exact call sites and what to delete.
- **Type consistency:** `resolveTaskCapabilities(actor, task, flags)` and the two changed function signatures are used identically in routes and client. `isAgentOwnerOrAssistantOf` / `isAgentTeamMemberOf` are intentionally kept (data resolution), only policy duplicates are deleted.
- **Out of scope (later):** building the distinct Admin/Agent/Assistant UI surfaces (filters/views they see beyond CS). This plan only makes the model correct + single-sourced so that work is a clean follow-up.
