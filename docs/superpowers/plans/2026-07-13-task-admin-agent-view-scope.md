# Task Board — Admin vs Agent/Assistant View Scope

> **For a human implementer:** hand-coding plan. Pure actor/permission logic is
> TDD'd first; wiring is verified with `npm run typecheck && npm run lint && npm run test:run && npm run build`.

**Goal:** Stop treating "has `task.manage`" as "is an admin". Only a true **Admin account** should see every task + the admin-only surfaces (SLA / Categories / Agent Groups / cross-agent filters). An **Agent/Assistant** — even one who still carries a legacy `task.manage` permission — is scoped to their own agents' tasks and can only **create tasks + work their scope**; **actions stay decided by `resolveTaskCapabilities`** (unchanged).

**Architecture:** Redefine the `isManager` flag on `TaskActor` to mean "admin view" — it now requires the Admin **role**, not merely the `task.manage` **permission**. A demoted agent/assistant becomes a scoped worker (`isWorker = true`), so the existing worker fetch-scope in `queries.ts` and the existing client split (`isManager` vs `canManageOwnAgentGroup`) automatically produce the right view. Per-task action capability is untouched: an agent still gets full control of **their** agent's tasks through the resolver's `isAgentOwner` path.

**Tech Stack:** Next.js App Router (see `agent-portal/AGENTS.md`), Supabase (service-role), Vitest, TypeScript.

## Global Constraints

- `src/lib/tasks/access.ts` stays pure + unit-tested; capability decisions still flow only through it and `resolveTaskCapabilities`.
- No schema change. No new RBAC permission keys.
- New UI text in English. Do NOT push to the `vercel` remote. Commit after each task.

## Decisions baked in (from the discussion)

1. **`isManager` REDEFINED** = `task.manage` **AND** Admin role. This is the "admin, sees everything" flag. (Was: just `task.manage`.)
2. **`isWorker` = `task.work` OR `task.manage`** — so an agent/assistant who only had `task.manage` still has board access after being demoted.
3. **Actions unchanged** — `resolveTaskCapabilities` still keys on `isManager` for the admin short-circuit and on `isAgentOwner` for agent-level control. An agent acts on their scope via `isAgentOwner`, exactly as today.
4. **Agent/Assistant capabilities**: create tasks (for agents they own/assist), see + work those agents' tasks (incl. backlog, assignee-within-team). **No** SLA / Category / Agent-Group management, **no** cross-agent filters.
5. **This reverses the earlier agent self-service Agent-Group management** — Agent Groups becomes Admin-only (see Task 4 + the client Agent-Groups button). Confirm you're OK with that; it follows directly from decision 4.

## Admin signal (already exists)

`page.tsx`'s `getTaskBoardTitle` already computes it; extract it. A user is an admin when:
`session.user.role === "admin"` OR `session.user.roles` includes `SYSTEM_ROLE_NAMES.SUPER_ADMIN` ("Admin") OR `LEGACY_SUPER_ADMIN_ROLE_NAME` ("Super Admin"). (`src/lib/rbac/system-roles.ts`.)

## File Structure

- `src/lib/tasks/access.ts` — `isTaskViewAdmin(user)` helper; `buildTaskActor` gets an `isAdmin` input and the new `isManager`/`isWorker` formulas.
- `src/lib/tasks/access.test.ts`, `src/lib/tasks/transitions.test.ts` — update the "manager" actor construction; add demotion tests.
- All `buildTaskActor(...)` call sites (24) — pass the admin signal.
- `src/app/api/tasks/categories/route.ts`, `categories/[id]/route.ts`, `admin/task-sla-rules/route.ts`, `admin/task-reminder-settings/route.ts` — already gate on `actor.isManager`; now automatically admin-only (verify).
- `src/app/api/admin/agent-members/route.ts` — harden to admin-only.
- `src/app/(authed)/tasks/_components/TaskBoardClient.tsx` — Agent Groups button → admin-only; everything else already keyed correctly.

---

## Task 1: Redefine the actor (pure, TDD)

**Files:** modify `src/lib/tasks/access.ts`, `src/lib/tasks/access.test.ts`.

**Interfaces:**
- Produces `isTaskViewAdmin(user: { role?: string | null; roles?: readonly string[] }): boolean`.
- Changes `buildTaskActor(permissions, email, opts?: { isAdmin?: boolean }): TaskActor` with:
  - `isManager = can(permissions, TASK_MANAGE) && Boolean(opts?.isAdmin)`
  - `isWorker = can(permissions, TASK_WORK) || can(permissions, TASK_MANAGE)`

- [ ] **Step 1: Failing tests** — add to `access.test.ts`:

```ts
import { buildTaskActor, isTaskViewAdmin } from "@/lib/tasks/access";

describe("isTaskViewAdmin", () => {
  it("true for legacy admin role or the Admin/Super Admin system role", () => {
    expect(isTaskViewAdmin({ role: "admin" })).toBe(true);
    expect(isTaskViewAdmin({ roles: ["Admin"] })).toBe(true);
    expect(isTaskViewAdmin({ roles: ["Super Admin"] })).toBe(true);
  });
  it("false for a plain agent", () => {
    expect(isTaskViewAdmin({ role: "agent", roles: ["Agent"] })).toBe(false);
  });
});

describe("buildTaskActor admin vs manage split", () => {
  it("admin account with task.manage is a manager", () => {
    const a = buildTaskActor(["task.manage"], "admin@x.com", { isAdmin: true });
    expect(a.isManager).toBe(true);
    expect(a.isWorker).toBe(true);
  });
  it("agent with legacy task.manage is NOT a manager but stays a worker", () => {
    const a = buildTaskActor(["task.manage"], "agent@x.com", { isAdmin: false });
    expect(a.isManager).toBe(false);
    expect(a.isWorker).toBe(true);
  });
  it("plain CS with task.work is a worker only", () => {
    const a = buildTaskActor(["task.work"], "cs@x.com");
    expect(a.isManager).toBe(false);
    expect(a.isWorker).toBe(true);
  });
});
```

- [ ] **Step 2:** Update the EXISTING actor constructions that mean "full-power admin" so they still are. In `access.test.ts` and `transitions.test.ts`, every `buildTaskActor(["task.manage"], "…")` that represents the all-powerful manager becomes `buildTaskActor(["task.manage"], "…", { isAdmin: true })`. (Find/replace; the CS `buildTaskActor(["task.work"], …)` lines are unchanged.)

- [ ] **Step 3:** Run `npx vitest run src/lib/tasks/access.test.ts src/lib/tasks/transitions.test.ts` → the new tests FAIL (function/opts missing); confirm the intent.

- [ ] **Step 4: Implement** in `access.ts`:

```ts
import { LEGACY_SUPER_ADMIN_ROLE_NAME, SYSTEM_ROLE_NAMES } from "@/lib/rbac/system-roles";

// True admin = the Admin system role (or legacy role "admin"). This is the
// "sees every task + owns global settings" signal — deliberately NOT the same
// as holding the task.manage permission, which an agent/assistant may also
// carry but which must NOT grant an admin-wide view.
export function isTaskViewAdmin(user: {
  role?: string | null;
  roles?: readonly string[];
}): boolean {
  const roles = user.roles ?? [];
  return (
    user.role === "admin" ||
    roles.includes(SYSTEM_ROLE_NAMES.SUPER_ADMIN) ||
    roles.includes(LEGACY_SUPER_ADMIN_ROLE_NAME)
  );
}

export function buildTaskActor(
  permissions: readonly string[] | undefined,
  email: string,
  opts?: { isAdmin?: boolean }
): TaskActor {
  const hasManage = can(permissions, PERMISSIONS.TASK_MANAGE);
  return {
    email,
    // Admin view requires BOTH the manage permission and the admin role.
    isManager: hasManage && Boolean(opts?.isAdmin),
    // A demoted agent/assistant (manage but not admin) keeps board access.
    isWorker: can(permissions, PERMISSIONS.TASK_WORK) || hasManage,
  };
}
```

- [ ] **Step 5:** Tests PASS. **Step 6:** Commit (`refactor(tasks): isManager = admin role + task.manage, not the permission alone`).

> Typecheck will still be red at other `buildTaskActor` call sites (they don't yet pass `opts`, which is fine — they default to non-admin). Task 2 fixes them to pass the real signal.

---

## Task 2: Every route + page passes the admin signal

**Files:** all 24 `buildTaskActor(session.user.permissions, email)` call sites (see the list produced by
`rg -n "buildTaskActor\(session" src/app`), plus `src/app/(authed)/tasks/page.tsx`.

- [ ] **Step 1:** At each call site, change to:

```ts
const actor = buildTaskActor(session.user.permissions, email, {
  isAdmin: isTaskViewAdmin(session.user),
});
```

Import `isTaskViewAdmin` from `@/lib/tasks/access` in each file. (In `assignees/*` routes the variable is `actorEmail`; keep it.)

- [ ] **Step 2:** In `page.tsx`, replace the local admin computation in `getTaskBoardTitle` with `isTaskViewAdmin(session.user)` too (DRY — one definition). The `myAgents`/`myAssistantAgents` lines already branch on `actor.isManager`; leave them — now that `isManager` means admin, an admin gets all agents and an agent gets their own, which is exactly right.

- [ ] **Step 3:** Verify the fetch scope: `src/lib/tasks/queries.ts` `fetchTasksForActor` branches on `actor.isManager` (`if (!actor.isManager) { …worker scope… }`). No code change — but confirm by reading that the worker OR-clause includes `agent_email.eq.<self>` and the assistant agents, so a demoted agent still sees their own agents' tasks (incl. their unassigned backlog via `isAgentOwner` in the post-filter `canViewTask`).

- [ ] **Step 4:** `npm run typecheck && npm run test:run` → green. Commit (`refactor(tasks): route actors carry the admin-role signal`).

---

## Task 3: Client — Agent Groups becomes admin-only; verify the rest

**Files:** modify `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`.

The client already receives `isManager` (now = admin) and computes `canManageOwnAgentGroup` (agent/assistant). Almost every gate is already correct once `isManager` means admin:
- `showAgentFilter = isManager`, `showAssigneeFilter = isManager`, Categories/SLA buttons `isManager`, `showCategoryFilter = !shouldLimitPlainCsTasks` → all become admin-only. ✓
- `canCreateTasks = isManager || canManageOwnAgentGroup`, `showBacklog = isManager || canManageOwnAgentGroup`, `shouldLimitPlainCsTasks = !isManager && !canManageOwnAgentGroup` → agent/assistant keep create + backlog + non-limited view. ✓
- `capabilitiesFor` passes `isManager` to the resolver → admin gets full; agent (isManager false) gets agent-level control via `isAgentOwner`. ✓

The ONE change (decision 4/5 — agent doesn't manage Agent Groups):

- [ ] **Step 1:** The Agent Groups button currently renders under `{(isManager || canManageOwnAgentGroup) && (…)}`. Change it to `{isManager && (…)}`. Also update the `AgentGroupsModal` open-state / props it passes so it's only reachable by admin (if `manageableAgentEmails`/`isManager` are passed into the modal, an admin still gets the full list; agents no longer open it).

- [ ] **Step 2:** `npm run typecheck && npm run lint && npm run build` → green. Manual check as an agent-with-task.manage: board shows **only their agents' tasks**; **no** Agent/All-Assignees filter, **no** Categories/SLA/Agent-Groups buttons; **can** create a task + see their backlog + move/act on their own tasks. As an admin: unchanged (sees everything). Commit (`feat(tasks): Agent Groups management is admin-only`).

---

## Task 4: Harden the Agent-Groups API to admin-only

**Files:** modify `src/app/api/admin/agent-members/route.ts`.

Today `canManageThisAgentGroup` allows a global permission **or** `isAgentOwnerOrAssistant` (agent self-service). Per decision 4/5 this is admin-only now.

- [ ] **Step 1:** Change the guard so writes (POST/DELETE) require `isTaskViewAdmin(session.user)` (import it). Keep GET as-is only if the client still needs to *read* a group for display; otherwise gate GET on admin too. Remove the `isAgentOwnerOrAssistant` self-service branch.

- [ ] **Step 2:** Verify `categories/*`, `admin/task-sla-rules/*`, `admin/task-reminder-settings/*` routes: they gate on `actor.isManager`, which is now admin-only — no change needed, just confirm an agent (isManager false) gets 403 there.

- [ ] **Step 3:** `npm run typecheck && npm run lint && npm run test:run && npm run build` → all green. Commit (`fix(tasks): agent-group + settings routes are admin-only`).

---

## Self-Review

- **Coverage:** view-scope split → Task 1 (`isManager` = admin) + Task 2 (routes/fetch); agent can only create + work scope, no SLA/Category/AgentGroup → Tasks 3–4 (client button + API hardening); actions unchanged → resolver untouched, agent control via `isAgentOwner`. ✓
- **Why the client barely changes:** the earlier CS work already split `isManager` from `canManageOwnAgentGroup`; redefining `isManager` on the server makes those gates mean the right thing. Only the Agent-Groups affordance moves to admin-only.
- **Security:** the scope is enforced server-side — `fetchTasksForActor` (fetch), the settings/agent-group routes (admin-only), and `resolveTaskCapabilities` (per-task). The client flags are cosmetic on top.
- **Placeholders:** Task 1 is complete tested code; Tasks 2–4 name exact call sites / guards.
- **Watch-outs:** (a) update BOTH `access.test.ts` and `transitions.test.ts` "manager" constructions or the suite fails; (b) any other consumer of `session.user.role`/`roles` for task admin should route through `isTaskViewAdmin` (DRY); (c) decision 5 reverses agent self-service Agent Groups — confirm before shipping.
