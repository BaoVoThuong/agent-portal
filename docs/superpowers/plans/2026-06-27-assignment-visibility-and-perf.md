# Task Board: Assignment & Visibility Overhaul + Performance Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Task Board fast (kill per-request auth DB cost) and change the
collaboration model so CS staff see all tasks of agents they belong to and a task
can have multiple assignees.

**Architecture:** Three independent, separately-shippable phases. Phase 0 collapses
the auth permission lookup to a single query and removes redundant drawer fetches.
Phase 1 adds an admin-managed agent↔CS membership table and widens task visibility
by `task.agent_email`. Phase 2 replaces the single `assignee_email` with a
`task_assignees` junction (multi-assignee) and a multi-select UI.

**Tech Stack:** Next.js (App Router, `force-dynamic` routes), Supabase
(`@supabase/supabase-js`, service-role server-side, PostgREST nested selects),
NextAuth (JWT strategy), Vitest, ESLint, TypeScript.

## Global Constraints

- Work on a new branch off `main`: `feat/assignment-visibility`.
- Supabase is reached **only** via the service-role client (`getSupabaseAdmin()`); RLS stays on with no public policies. Add every new table to the RLS loop in `supabase/schema.sql`.
- DDL is **not** run by code — add SQL to `supabase/schema.sql` and call it out for the user to run in the Supabase SQL editor.
- Identity is by **email** throughout the task code (not account id).
- Verify from the `agent-portal/` directory: `npx tsc --noEmit`, `npx eslint <changed files>`, `npx vitest run src/lib/tasks`.
- Reply/commit message language: English commit messages; co-author trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do not add JWT permission caching (decision: always-fresh, achieved via the single-query fix).
- Keep the invariant: `status = 'backlog'` ⇔ task has 0 assignees; non-backlog ⇒ ≥1 assignee.

---

## File Structure

**Phase 0 (perf)**
- Modify `src/lib/rbac/access.ts` — `getUserAccessByEmail` → 1 nested query; add pure `flattenAccess`.
- Modify `src/auth.ts` — jwt callback uses `flattenAccess` result (incl. agentId); drop separate agent_id query.
- Create `src/lib/rbac/access.test.ts` (or extend) — `flattenAccess` unit tests.
- Modify `src/app/(authed)/tasks/_components/CommentThread.tsx` — `members` prop, drop `/members` fetch.
- Modify `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx` — pass `assignees` → CommentThread.
- Modify `src/app/api/tasks/[id]/comments/route.ts` — parallelize attachment signing.

**Phase 1 (agent groups + visibility)**
- Modify `supabase/schema.sql` — `agent_members` table + RLS entry.
- Create `src/lib/tasks/membership.ts` — `fetchAgentsForCs`, `fetchVisibleTaskIdsForCs` helpers.
- Modify `src/lib/tasks/access.ts` — `canViewTask(actor, task, flags)`, `canAssignToTask`.
- Create/extend `src/lib/tasks/access.test.ts` — flag-based view tests.
- Modify `src/lib/tasks/queries.ts` — agent-aware `fetchTasksForActor`.
- Modify `src/app/api/tasks/[id]/comments/route.ts`, `.../attachments/route.ts`, `.../activity/route.ts` — flag-based `canView`.
- Create `src/app/api/admin/agent-members/route.ts` — admin CRUD.
- Create `src/lib/tasks/agent-groups.ts` — server data for admin screen.
- Create `src/app/(authed)/management/agent-groups/page.tsx` + `_components/AgentGroupsClient.tsx` — admin UI.
- Modify `src/app/(authed)/tasks/_components/NewTaskDialog.tsx` — agent selector scoped to creator's agents.

**Phase 2 (multi-assignee)**
- Modify `supabase/schema.sql` — `task_assignees` table + RLS entry + backfill statement.
- Create `src/lib/tasks/assignees-set.ts` — invariant resolver `resolveAssigneeChange`.
- Create `src/lib/tasks/assignees-set.test.ts`.
- Modify `src/lib/tasks/queries.ts` — return `assignees: string[]` per task.
- Modify `src/lib/tasks/types.ts` — `TaskRow.assignees`, drop `assignee_email` (last task).
- Create `src/app/api/tasks/[id]/assignees/route.ts` + `.../assignees/[email]/route.ts`.
- Modify `src/lib/tasks/access.ts` — `canMutateTask(actor, task, isAssignee)`.
- Modify task UI components — avatar stack + multi-select + filter any-of.

---

# PHASE 0 — Performance pass

### Task 0.1: `flattenAccess` pure function + tests

**Files:**
- Modify: `src/lib/rbac/access.ts`
- Test: `src/lib/rbac/access.test.ts` (create if missing)

**Interfaces:**
- Produces: `flattenAccess(row: AccessRow): UserAccess` where
  `AccessRow = { id: string; role: string | null; is_active: boolean | null; agent_id: string | null; user_roles: { roles: { id: string; name: string; is_active: boolean; role_permissions: { permission_key: string }[] } | null }[] | null }`
  and `UserAccess` gains `agentId: string | null`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/rbac/access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { flattenAccess } from "@/lib/rbac/access";

const row = {
  id: "u1",
  role: "agent",
  is_active: true,
  agent_id: "EPS0001",
  user_roles: [
    { roles: { id: "r1", name: "CS", is_active: true, role_permissions: [{ permission_key: "task.work" }, { permission_key: "settings.access" }] } },
    { roles: { id: "r2", name: "Old", is_active: false, role_permissions: [{ permission_key: "task.manage" }] } },
    { roles: null },
  ],
};

describe("flattenAccess", () => {
  it("collects permissions from active roles only, dedups, keeps agentId", () => {
    const a = flattenAccess(row);
    expect(a.isActive).toBe(true);
    expect(a.agentId).toBe("EPS0001");
    expect(a.roles).toEqual(["CS"]);
    expect([...a.permissions].sort()).toEqual(["settings.access", "task.work"]);
  });

  it("inactive account → no roles/permissions", () => {
    const a = flattenAccess({ ...row, is_active: false });
    expect(a.isActive).toBe(false);
    expect(a.permissions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/lib/rbac/access.test.ts`
Expected: FAIL — `flattenAccess` not exported.

- [ ] **Step 3: Implement `flattenAccess` and the `AccessRow` type**

In `src/lib/rbac/access.ts`, add `agentId` to `UserAccess` and add:

```ts
export type AccessRow = {
  id: string;
  role: string | null;
  is_active: boolean | null;
  agent_id: string | null;
  user_roles:
    | { roles: { id: string; name: string; is_active: boolean; role_permissions: { permission_key: string }[] } | null }[]
    | null;
};

export function flattenAccess(row: AccessRow): UserAccess {
  const legacyRole: UserRole = row.role === "admin" ? "admin" : "agent";
  if (row.is_active === false) {
    return { userId: row.id, legacyRole, roles: [], permissions: [], isActive: false, agentId: row.agent_id ?? null };
  }
  const activeRoles = (row.user_roles ?? [])
    .map((ur) => ur.roles)
    .filter((r): r is NonNullable<typeof r> => Boolean(r) && r!.is_active);
  const roleNames = activeRoles.map((r) => r.name);
  const permissions = [
    ...new Set(activeRoles.flatMap((r) => r.role_permissions.map((p) => p.permission_key))),
  ];
  return {
    userId: row.id,
    legacyRole: getLegacyRoleFromRoleNames(roleNames),
    roles: roleNames,
    permissions,
    isActive: true,
    agentId: row.agent_id ?? null,
  };
}
```

Add `agentId: string | null;` to the `UserAccess` type.

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/lib/rbac/access.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rbac/access.ts src/lib/rbac/access.test.ts
git commit -m "perf(rbac): add pure flattenAccess + agentId on UserAccess

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 0.2: `getUserAccessByEmail` → single nested query; simplify jwt

**Files:**
- Modify: `src/lib/rbac/access.ts:51-135` (`getUserAccessByEmail`)
- Modify: `src/auth.ts:145-164` (jwt callback)

**Interfaces:**
- Consumes: `flattenAccess` (Task 0.1).
- Produces: `getUserAccessByEmail(email): Promise<UserAccess>` (now includes `agentId`).

- [ ] **Step 1: Rewrite `getUserAccessByEmail` to one query**

Replace the body of `getUserAccessByEmail` with:

```ts
export async function getUserAccessByEmail(email: string): Promise<UserAccess> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(PORTAL_ACCOUNT_TABLE)
    .select(
      "id,role,is_active,agent_id,user_roles(roles(id,name,is_active,role_permissions(permission_key)))"
    )
    .eq("email", email)
    .maybeSingle();

  if (error || !data) {
    return { userId: null, legacyRole: "agent", roles: [], permissions: [], isActive: false, agentId: null };
  }
  return flattenAccess(data as unknown as AccessRow);
}
```

- [ ] **Step 2: Simplify the jwt callback** in `src/auth.ts`

Replace the `if (token.email) { ... }` block (lines ~145-164) with:

```ts
      if (token.email) {
        const access = await getUserAccessByEmail(token.email);
        if (access.isActive) {
          token.role = access.legacyRole;
          token.roles = access.roles;
          token.permissions = access.permissions;
        } else {
          token.roles = [];
          token.permissions = [];
        }
        token.agentId = access.agentId;
      }
```

Remove the now-dead second Supabase query for `agent_id` and its imports if unused (`getSupabaseAdmin`, `PORTAL_ACCOUNT_TABLE`) — check with `npx eslint src/auth.ts` and delete only if flagged unused.

- [ ] **Step 3: Verify typecheck + existing tests**

Run: `npx tsc --noEmit` → Expected: No errors.
Run: `npx vitest run src/lib/rbac` → Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/rbac/access.ts src/auth.ts
git commit -m "perf(auth): collapse permission lookup to one query in jwt callback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 0.3: CommentThread takes `members` prop (drop `/members` fetch)

**Files:**
- Modify: `src/app/(authed)/tasks/_components/CommentThread.tsx`
- Modify: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`

**Interfaces:**
- Consumes: `assignees: TaskAssignee[]` already on `TaskDetailDrawer`.
- Produces: `CommentThread({ taskId, currentEmail, members })`.

- [ ] **Step 1: Add `members` prop, remove the members fetch**

In `CommentThread.tsx`, change the component signature to accept `members: TaskAssignee[]` and **delete** the `const [members, setMembers] = useState(...)` plus the `void fetch("/api/tasks/members")...` block. Use the `members` prop directly.

- [ ] **Step 2: Pass `assignees` from the drawer**

In `TaskDetailDrawer.tsx`, where `<CommentThread taskId={task.id} currentEmail={currentEmail} />` is rendered, change to:

```tsx
<CommentThread taskId={task.id} currentEmail={currentEmail} members={assignees} />
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → Expected: No errors.
Run: `npx eslint "src/app/(authed)/tasks/_components/CommentThread.tsx" "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx"` → Expected: no issues.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(authed)/tasks/_components/CommentThread.tsx" "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx"
git commit -m "perf(tasks): pass members into CommentThread, drop redundant /members fetch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 0.4: Parallelize comment attachment signing

**Files:**
- Modify: `src/app/api/tasks/[id]/comments/route.ts` (GET)

- [ ] **Step 1: Replace the sequential signing loop**

In the GET handler, replace the `for (const a of attData ?? []) { ... await signTaskFile ... }` block with a parallel build:

```ts
  const signed = await Promise.all(
    (attData ?? []).map(async (a) => {
      const row = a as {
        id: string; comment_id: string; file_name: string;
        mime_type: string | null; size_bytes: number | null; storage_path: string;
      };
      return {
        comment_id: row.comment_id,
        att: {
          id: row.id, file_name: row.file_name, mime_type: row.mime_type,
          size_bytes: row.size_bytes, url: await signTaskFile(row.storage_path),
        },
      };
    })
  );
  const byComment = new Map<string, { id: string; file_name: string; mime_type: string | null; size_bytes: number | null; url: string }[]>();
  for (const { comment_id, att } of signed) {
    const list = byComment.get(comment_id) ?? [];
    list.push(att);
    byComment.set(comment_id, list);
  }
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/tasks/[id]/comments/route.ts"
git commit -m "perf(tasks): sign comment attachment URLs in parallel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Phase 0 manual check**

Open a task, switch to Comments and Activity tabs; confirm load feels snappy. (No automated assertion — it's a latency change.)

---

# PHASE 1 — Agent groups + agent-scoped visibility

### Task 1.1: `agent_members` table + RLS

**Files:**
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Add the table** near the other task tables in `schema.sql`:

```sql
-- Which CS staff support which agent (many-to-many). Admin-managed. Drives task
-- visibility: a CS sees tasks whose agent_email is one of their agents.
create table if not exists agent_members (
  agent_email text not null,
  cs_email text not null,
  created_at timestamptz not null default now(),
  primary key (agent_email, cs_email)
);
create index if not exists agent_members_cs_idx on agent_members (cs_email);
create index if not exists agent_members_agent_idx on agent_members (agent_email);
```

- [ ] **Step 2: Add to the RLS protected-tables loop** — add `'agent_members'` to the `protected_tables` array.

- [ ] **Step 3: Commit + flag SQL to run**

```bash
git add supabase/schema.sql
git commit -m "feat(tasks): agent_members schema for agent-scoped visibility

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Tell the user: run the `agent_members` block in the Supabase SQL editor.

---

### Task 1.2: membership helpers

**Files:**
- Create: `src/lib/tasks/membership.ts`

**Interfaces:**
- Produces:
  - `fetchAgentsForCs(email: string): Promise<string[]>` — agent emails the CS belongs to ([] on error/empty).
  - `fetchCsForAgent(agentEmail: string): Promise<string[]>` — member emails of an agent.

- [ ] **Step 1: Implement**

```ts
import { getSupabaseAdmin } from "@/lib/supabase";

export async function fetchAgentsForCs(email: string): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_members").select("agent_email").eq("cs_email", email);
  if (error) return [];
  return [...new Set((data ?? []).map((r) => (r as { agent_email: string }).agent_email))];
}

export async function fetchCsForAgent(agentEmail: string): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_members").select("cs_email").eq("agent_email", agentEmail);
  if (error) return [];
  return [...new Set((data ?? []).map((r) => (r as { cs_email: string }).cs_email))];
}
```

- [ ] **Step 2: Verify** `npx tsc --noEmit` → No errors.
- [ ] **Step 3: Commit**

```bash
git add src/lib/tasks/membership.ts
git commit -m "feat(tasks): membership helpers (agents-for-cs, cs-for-agent)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 1.3: `canViewTask` flag refactor + `canAssignToTask`

**Files:**
- Modify: `src/lib/tasks/access.ts`
- Modify: `src/lib/tasks/access.test.ts`

**Interfaces:**
- Produces:
  - `canViewTask(actor, task, flags?: { isAssignee?: boolean; isAgentMember?: boolean; isParticipant?: boolean }): boolean`
  - `canAssignToTask(actor, isAgentMember: boolean): boolean`

- [ ] **Step 1: Write failing tests** (append to `access.test.ts`):

```ts
describe("canViewTask with flags", () => {
  it("agent member (not assignee) can view", () => {
    expect(canViewTask(cs, { assignee_email: "other@x.com" }, { isAgentMember: true })).toBe(true);
  });
  it("no flags, not assignee → cannot view", () => {
    expect(canViewTask(cs, { assignee_email: "other@x.com" }, {})).toBe(false);
  });
  it("assignee flag → view", () => {
    expect(canViewTask(cs, { assignee_email: "other@x.com" }, { isAssignee: true })).toBe(true);
  });
});

describe("canAssignToTask", () => {
  it("manager always; CS only if agent member", () => {
    expect(canAssignToTask(manager, false)).toBe(true);
    expect(canAssignToTask(cs, true)).toBe(true);
    expect(canAssignToTask(cs, false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/lib/tasks/access.test.ts` → FAIL (signature mismatch / canAssignToTask missing).

- [ ] **Step 3: Implement**

```ts
export function canViewTask(
  actor: TaskActor,
  task: Pick<TaskRow, "assignee_email">,
  flags: { isAssignee?: boolean; isAgentMember?: boolean; isParticipant?: boolean } = {}
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return (
    task.assignee_email === actor.email ||
    Boolean(flags.isAssignee) ||
    Boolean(flags.isAgentMember) ||
    Boolean(flags.isParticipant)
  );
}

export function canAssignToTask(actor: TaskActor, isAgentMember: boolean): boolean {
  if (actor.isManager) return true;
  return actor.isWorker && isAgentMember;
}
```

(Existing call sites passing a 3rd boolean for `isParticipant` must change to `{ isParticipant: true }` — fixed in Task 1.5.)

- [ ] **Step 4: Run tests** — `npx vitest run src/lib/tasks/access.test.ts` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/access.ts src/lib/tasks/access.test.ts
git commit -m "feat(tasks): flag-based canViewTask + canAssignToTask

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 1.4: agent-aware `fetchTasksForActor`

**Files:**
- Modify: `src/lib/tasks/queries.ts`

**Interfaces:**
- Consumes: `fetchAgentsForCs` (1.2), `fetchParticipantTaskIds` (existing).

- [ ] **Step 1: Update the non-manager branch**

```ts
  if (!actor.isManager) {
    const [agents, participantIds] = await Promise.all([
      fetchAgentsForCs(actor.email),
      fetchParticipantTaskIds(actor.email),
    ]);
    const ors: string[] = [`assignee_email.eq."${actor.email}"`];
    if (agents.length > 0) ors.push(`agent_email.in.(${agents.map((a) => `"${a}"`).join(",")})`);
    if (participantIds.length > 0) ors.push(`id.in.(${participantIds.join(",")})`);
    query = query.or(ors.join(","));
  }
```

Add `import { fetchAgentsForCs } from "./membership";`.

- [ ] **Step 2: Verify** `npx tsc --noEmit` → No errors. `npx vitest run src/lib/tasks` → PASS.
- [ ] **Step 3: Commit**

```bash
git add src/lib/tasks/queries.ts
git commit -m "feat(tasks): CS sees tasks of their agents (agent-scoped fetch)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 1.5: route view-permission uses agent membership

**Files:**
- Modify: `src/app/api/tasks/[id]/comments/route.ts`
- Modify: `src/app/api/tasks/[id]/attachments/route.ts`
- Modify: `src/app/api/tasks/[id]/activity/route.ts`

**Interfaces:**
- Consumes: `isTaskParticipant` (existing), `fetchAgentsForCs` (1.2), flag-based `canViewTask` (1.3).

- [ ] **Step 1: Add an agent-aware view helper in each route**

Each route already loads the task (with `agent_email` — add it to the `select` where missing). Replace the `canView`/`canViewTask` call with:

```ts
async function canViewResolved(actor, task, taskId) {
  if (actor.isManager) return true;
  const [isP, agents] = await Promise.all([
    isTaskParticipant(taskId, actor.email),
    fetchAgentsForCs(actor.email),
  ]);
  const isAgentMember = Boolean(task.agent_email && agents.includes(task.agent_email));
  return canViewTask(actor, task, { isParticipant: isP, isAgentMember });
}
```

Update the comments `loadActorAndTask` select to include `agent_email`
(`select("id,status,assignee_email,agent_email")`); likewise attachments
(`id,assignee_email,agent_email`) and activity (`id,assignee_email,agent_email`).
Replace the existing `canView(...)`/`canViewTask(...)` usages (including the
participant 3rd-arg call in attachments POST) with `canViewResolved(...)`.

- [ ] **Step 2: Verify** `npx tsc --noEmit` → No errors; `npx eslint <the 3 routes>` → clean.
- [ ] **Step 3: Commit**

```bash
git add "src/app/api/tasks/[id]/comments/route.ts" "src/app/api/tasks/[id]/attachments/route.ts" "src/app/api/tasks/[id]/activity/route.ts"
git commit -m "feat(tasks): comment/attachment/activity view honors agent membership

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 1.6: widen assign permission in PATCH

**Files:**
- Modify: `src/app/api/tasks/[id]/route.ts` (PATCH — reassign branch)

- [ ] **Step 1:** When the PATCH changes `assignee_email` (reassign), gate it with `canAssignToTask` instead of manager-only. Before applying a reassignment, resolve membership:

```ts
const agents = r.actor.isManager ? [] : await fetchAgentsForCs(r.actor.email);
const isAgentMember = Boolean(r.task.agent_email && agents.includes(r.task.agent_email));
if (reassigning && !canAssignToTask(r.actor, isAgentMember)) {
  return NextResponse.json({ error: "You cannot assign this task." }, { status: 403 });
}
```

Ensure the PATCH's task `select` includes `agent_email`. (`resolveTaskPatch`'s
own `canAssign` check stays for the create/role gate; this adds the agent path.)

- [ ] **Step 2: Verify** `npx tsc --noEmit` → No errors.
- [ ] **Step 3: Commit**

```bash
git add "src/app/api/tasks/[id]/route.ts"
git commit -m "feat(tasks): CS in a task's agent can (re)assign it

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 1.7: admin agent-members API

**Files:**
- Create: `src/app/api/admin/agent-members/route.ts`
- Create: `src/lib/tasks/agent-groups.ts`

**Interfaces:**
- Produces: `GET /api/admin/agent-members?agent=<email>` → `{ members: string[] }`; `POST { agent_email, cs_email }`; `DELETE { agent_email, cs_email }`. All admin-gated (`management.account_manager`).

- [ ] **Step 1: Implement the route** (admin-gated via `can(permissions, PERMISSIONS.MANAGEMENT_ACCOUNT_MANAGER)` — confirm the exact permission key in `src/lib/rbac/permissions.ts`):

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  if (!can(session.user.permissions, PERMISSIONS.MANAGEMENT_ACCOUNT_MANAGER)) return null;
  return email;
}

export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const agent = new URL(req.url).searchParams.get("agent");
  if (!agent) return NextResponse.json({ members: [] });
  const { data } = await getSupabaseAdmin().from("agent_members").select("cs_email").eq("agent_email", agent);
  return NextResponse.json({ members: (data ?? []).map((r) => (r as { cs_email: string }).cs_email) });
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const agent_email = typeof body?.agent_email === "string" ? body.agent_email : "";
  const cs_email = typeof body?.cs_email === "string" ? body.cs_email : "";
  if (!agent_email || !cs_email) return NextResponse.json({ error: "agent_email and cs_email required" }, { status: 400 });
  const { error } = await getSupabaseAdmin().from("agent_members").upsert({ agent_email, cs_email }, { onConflict: "agent_email,cs_email", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const agent_email = typeof body?.agent_email === "string" ? body.agent_email : "";
  const cs_email = typeof body?.cs_email === "string" ? body.cs_email : "";
  const { error } = await getSupabaseAdmin().from("agent_members").delete().eq("agent_email", agent_email).eq("cs_email", cs_email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

In `src/lib/tasks/agent-groups.ts`, add a server helper for the admin page data:

```ts
import { getSupabaseAdmin } from "@/lib/supabase";

export async function fetchAgentsAndCs(): Promise<{
  agents: { email: string; name: string | null }[];
  cs: { email: string; name: string | null }[];
}> {
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("portal_account").select("email,name,role,is_active").eq("is_active", true);
  const rows = (data ?? []) as { email: string; name: string | null; role: string | null }[];
  return {
    agents: rows.filter((r) => r.role === "agent").map((r) => ({ email: r.email, name: r.name })),
    cs: rows.map((r) => ({ email: r.email, name: r.name })),
  };
}
```

(Confirm `PERMISSIONS.MANAGEMENT_ACCOUNT_MANAGER` exists; if the key differs, use the actual constant for "Account Manager".)

- [ ] **Step 2: Verify** `npx tsc --noEmit` → No errors; `npx eslint "src/app/api/admin/agent-members/route.ts" src/lib/tasks/agent-groups.ts` → clean.
- [ ] **Step 3: Commit**

```bash
git add "src/app/api/admin/agent-members/route.ts" src/lib/tasks/agent-groups.ts
git commit -m "feat(admin): agent-members API + data helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 1.8: admin "Agent Groups" screen

**Files:**
- Create: `src/app/(authed)/management/agent-groups/page.tsx`
- Create: `src/app/(authed)/management/agent-groups/_components/AgentGroupsClient.tsx`

**Interfaces:**
- Consumes: `fetchAgentsAndCs` (1.7), `/api/admin/agent-members` (1.7), `requireAnyPermission`/`requirePermission` server guard (follow the pattern in an existing `management/*` page).

- [ ] **Step 1: Page (server)** — mirror an existing management page's guard:

```tsx
import { requirePermission } from "@/lib/rbac/server"; // confirm exact export
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { fetchAgentsAndCs } from "@/lib/tasks/agent-groups";
import { AgentGroupsClient } from "./_components/AgentGroupsClient";

export const dynamic = "force-dynamic";

export default async function AgentGroupsPage() {
  await requirePermission(PERMISSIONS.MANAGEMENT_ACCOUNT_MANAGER);
  const { agents, cs } = await fetchAgentsAndCs();
  return <AgentGroupsClient agents={agents} cs={cs} />;
}
```

(Open an existing file under `src/app/(authed)/management/` to copy the exact guard helper name and layout wrapper.)

- [ ] **Step 2: Client** — agent list on the left, member checkboxes on the right:

```tsx
"use client";
import { useEffect, useState } from "react";

type Person = { email: string; name: string | null };

export function AgentGroupsClient({ agents, cs }: { agents: Person[]; cs: Person[] }) {
  const [agent, setAgent] = useState<string | null>(agents[0]?.email ?? null);
  const [members, setMembers] = useState<string[]>([]);

  useEffect(() => {
    if (!agent) return;
    void fetch(`/api/admin/agent-members?agent=${encodeURIComponent(agent)}`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => setMembers(d.members as string[]));
  }, [agent]);

  async function toggle(csEmail: string, on: boolean) {
    setMembers((cur) => (on ? [...cur, csEmail] : cur.filter((m) => m !== csEmail)));
    await fetch("/api/admin/agent-members", {
      method: on ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_email: agent, cs_email: csEmail }),
    });
  }

  return (
    <div className="flex gap-6 p-6">
      <ul className="w-64 shrink-0 space-y-1">
        {agents.map((a) => (
          <li key={a.email}>
            <button
              type="button"
              onClick={() => setAgent(a.email)}
              className={`w-full rounded px-3 py-2 text-left text-sm ${agent === a.email ? "bg-[#e9f2ff] text-[#0c66e4]" : "hover:bg-[#f4f5f7]"}`}
            >
              {a.name ?? a.email}
            </button>
          </li>
        ))}
      </ul>
      <div className="min-w-0 flex-1">
        <h2 className="mb-3 text-sm font-bold uppercase text-[#6b778c]">CS members</h2>
        <ul className="space-y-1">
          {cs.map((p) => {
            const on = members.includes(p.email);
            return (
              <li key={p.email}>
                <label className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[#f4f5f7]">
                  <input type="checkbox" checked={on} disabled={!agent} onChange={(e) => toggle(p.email, e.target.checked)} />
                  {p.name ?? p.email}
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the nav entry** — add "Agent Groups" under Management in the sidebar (find the Management nav config; copy an existing item's shape, gate by the same permission).

- [ ] **Step 4: Verify** `npx tsc --noEmit` → No errors; `npx eslint <both files>` → clean.
- [ ] **Step 5: Commit**

```bash
git add "src/app/(authed)/management/agent-groups"
git commit -m "feat(admin): Agent Groups management screen

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 1.9: agent selector in New Task (scoped to creator's agents)

**Files:**
- Modify: `src/app/(authed)/tasks/page.tsx` (pass the creator's agents)
- Modify: `src/app/(authed)/tasks/_components/NewTaskDialog.tsx`

- [ ] **Step 1:** In `page.tsx`, compute the creator's agents and pass to `TaskBoardClient` → `NewTaskDialog`:

```ts
import { fetchAgentsForCs } from "@/lib/tasks/membership";
// ...
const myAgents = actor.isManager ? agents.map((a) => a.email) : await fetchAgentsForCs(email);
```

Thread `myAgents` to `NewTaskDialog`.

- [ ] **Step 2:** In `NewTaskDialog`, the Agent dropdown options are: managers → all `agents`; CS → only `myAgents` (pre-select if exactly one). Keep `agent_email` optional but, for a CS with ≥1 agent, default to their (first/only) agent so teammates can see the task.

- [ ] **Step 3: Verify** `npx tsc --noEmit` → No errors.
- [ ] **Step 4: Commit**

```bash
git add "src/app/(authed)/tasks/page.tsx" "src/app/(authed)/tasks/_components/NewTaskDialog.tsx"
git commit -m "feat(tasks): scope New Task agent selector to creator's agents

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Phase 1 manual check** — as admin, add a CS to an agent; log in as that CS → they see the agent's tasks; can (re)assign within the agent.

---

# PHASE 2 — Multi-assignee

### Task 2.1: `task_assignees` table + RLS + backfill

**Files:**
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Add table + backfill** in `schema.sql`:

```sql
create table if not exists task_assignees (
  task_id uuid not null references tasks(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  primary key (task_id, email)
);
create index if not exists task_assignees_email_idx on task_assignees (email);

-- Backfill from the legacy single-assignee column (idempotent).
insert into task_assignees (task_id, email)
select id, assignee_email from tasks
where assignee_email is not null
on conflict (task_id, email) do nothing;
```

- [ ] **Step 2:** Add `'task_assignees'` to the RLS protected-tables array.
- [ ] **Step 3: Commit + flag SQL**

```bash
git add supabase/schema.sql
git commit -m "feat(tasks): task_assignees junction + backfill

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Tell the user to run this block in Supabase.

---

### Task 2.2: invariant resolver + tests

**Files:**
- Create: `src/lib/tasks/assignees-set.ts`
- Create: `src/lib/tasks/assignees-set.test.ts`

**Interfaces:**
- Produces: `resolveAssigneeChange(current: { status: TaskStatus; assignees: string[] }, change: { add?: string; remove?: string }): { assignees: string[]; status: TaskStatus; clearWaitingReason: boolean }`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { resolveAssigneeChange } from "@/lib/tasks/assignees-set";

describe("resolveAssigneeChange", () => {
  it("first assignee on a backlog task → todo", () => {
    const r = resolveAssigneeChange({ status: "backlog", assignees: [] }, { add: "a@x.com" });
    expect(r.assignees).toEqual(["a@x.com"]);
    expect(r.status).toBe("todo");
  });
  it("adding a second keeps status", () => {
    const r = resolveAssigneeChange({ status: "in_progress", assignees: ["a@x.com"] }, { add: "b@x.com" });
    expect(r.assignees.sort()).toEqual(["a@x.com", "b@x.com"]);
    expect(r.status).toBe("in_progress");
  });
  it("removing the last → backlog + clear waiting", () => {
    const r = resolveAssigneeChange({ status: "waiting", assignees: ["a@x.com"] }, { remove: "a@x.com" });
    expect(r.assignees).toEqual([]);
    expect(r.status).toBe("backlog");
    expect(r.clearWaitingReason).toBe(true);
  });
  it("removing one of many keeps status", () => {
    const r = resolveAssigneeChange({ status: "done", assignees: ["a@x.com", "b@x.com"] }, { remove: "a@x.com" });
    expect(r.assignees).toEqual(["b@x.com"]);
    expect(r.status).toBe("done");
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/lib/tasks/assignees-set.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { TaskStatus } from "./types";

export function resolveAssigneeChange(
  current: { status: TaskStatus; assignees: string[] },
  change: { add?: string; remove?: string }
): { assignees: string[]; status: TaskStatus; clearWaitingReason: boolean } {
  const set = new Set(current.assignees);
  if (change.add) set.add(change.add);
  if (change.remove) set.delete(change.remove);
  const assignees = [...set];
  let status = current.status;
  let clearWaitingReason = false;
  if (assignees.length === 0) {
    status = "backlog";
    if (current.status === "waiting") clearWaitingReason = true;
  } else if (current.status === "backlog") {
    status = "todo";
  }
  return { assignees, status, clearWaitingReason };
}
```

- [ ] **Step 4: Run, verify pass** → PASS (4 tests).
- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/assignees-set.ts src/lib/tasks/assignees-set.test.ts
git commit -m "feat(tasks): multi-assignee invariant resolver

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2.3: queries return `assignees[]`; type change

**Files:**
- Modify: `src/lib/tasks/types.ts`
- Modify: `src/lib/tasks/queries.ts`

- [ ] **Step 1:** Add `assignees: string[];` to `TaskRow` (keep `assignee_email` for now to avoid a big-bang break).
- [ ] **Step 2:** In `fetchTasksForActor`, after fetching tasks, fetch their assignees and attach:

```ts
const ids = (data ?? []).map((t) => (t as { id: string }).id);
const assigneesByTask = new Map<string, string[]>();
if (ids.length) {
  const { data: ta } = await supabase.from("task_assignees").select("task_id,email").in("task_id", ids);
  for (const r of ta ?? []) {
    const row = r as { task_id: string; email: string };
    const list = assigneesByTask.get(row.task_id) ?? [];
    list.push(row.email);
    assigneesByTask.set(row.task_id, list);
  }
}
return (data ?? []).map((t) => {
  const row = t as { id: string };
  return { ...(t as object), assignees: assigneesByTask.get(row.id) ?? [] } as unknown as TaskRow;
});
```

Also update the non-manager `fetchTasksForActor` filter to use the junction for "assigned to me": replace `assignee_email.eq."..."` with a participant-style id list from `task_assignees where email = me`. (Fetch those ids alongside agents/participants and add `id.in.(...)`.)

- [ ] **Step 3: Verify** `npx tsc --noEmit` → No errors; `npx vitest run src/lib/tasks` → PASS.
- [ ] **Step 4: Commit**

```bash
git add src/lib/tasks/types.ts src/lib/tasks/queries.ts
git commit -m "feat(tasks): resolve assignees[] per task from junction

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2.4: assignee add/remove endpoints

**Files:**
- Create: `src/app/api/tasks/[id]/assignees/route.ts` (POST add)
- Create: `src/app/api/tasks/[id]/assignees/[email]/route.ts` (DELETE remove)

**Interfaces:**
- Consumes: `canAssignToTask` (1.3), `fetchAgentsForCs` (1.2), `resolveAssigneeChange` (2.2), `broadcastTaskRoom`/`broadcastTasksChanged` (existing), `insertNotifications` (existing).

- [ ] **Step 1: POST add** — load task (with `status,agent_email`), resolve membership, gate with `canAssignToTask`; read current assignees; `resolveAssigneeChange({status, assignees}, { add: email })`; upsert into `task_assignees`; if status changed, update `tasks.status` (+ clear `waiting_reason`); notify the added user (`type: "assigned"`); `broadcastTasksChanged()` + `broadcastTaskRoom(id)`. Insert `task_activity` `assigned`.

- [ ] **Step 2: DELETE remove** — same gating; `resolveAssigneeChange({...}, { remove: email })`; delete the junction row; apply status/waiting changes; broadcast.

(Write the full handlers following the pattern of `src/app/api/tasks/[id]/route.ts` — `auth()`, `loadActorAndTask`, JSON body, service-role mutations, `NextResponse.json`.)

- [ ] **Step 3: Verify** `npx tsc --noEmit` → No errors; `npx eslint <both files>` → clean.
- [ ] **Step 4: Commit**

```bash
git add "src/app/api/tasks/[id]/assignees"
git commit -m "feat(tasks): add/remove assignee endpoints with invariant + notify

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2.5: `canMutateTask` flag refactor + route wiring

**Files:**
- Modify: `src/lib/tasks/access.ts` + `access.test.ts`
- Modify: `src/app/api/tasks/[id]/route.ts` (PATCH/DELETE mutate checks)

- [ ] **Step 1: Failing test**

```ts
describe("canMutateTask with isAssignee flag", () => {
  it("manager always; CS only if assignee flag", () => {
    expect(canMutateTask(manager, { assignee_email: null }, false)).toBe(true);
    expect(canMutateTask(cs, { assignee_email: "x@x.com" }, true)).toBe(true);
    expect(canMutateTask(cs, { assignee_email: "x@x.com" }, false)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement**

```ts
export function canMutateTask(
  actor: TaskActor,
  task: Pick<TaskRow, "assignee_email">,
  isAssignee = false
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return task.assignee_email === actor.email || isAssignee;
}
```

- [ ] **Step 3:** In the PATCH/DELETE handlers, resolve `isAssignee` from the junction (`select 1 from task_assignees where task_id and email`) and pass it to `canMutateTask`.
- [ ] **Step 4: Verify** `npx vitest run src/lib/tasks/access.test.ts` → PASS; `npx tsc --noEmit` → No errors.
- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/access.ts src/lib/tasks/access.test.ts "src/app/api/tasks/[id]/route.ts"
git commit -m "feat(tasks): mutate rights honor multi-assignee membership

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2.6: multi-assignee UI

**Files:**
- Modify: `src/app/(authed)/tasks/_components/TaskRowItem.tsx` (avatar stack + multi-select menu)
- Modify: `src/app/(authed)/tasks/_components/TaskCard.tsx` (avatar stack)
- Modify: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx` (multi-select assignee)
- Modify: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx` (assignee filter any-of; assign handlers call new endpoints)
- Modify: `src/lib/tasks/filtering.ts` (+ test) — match if `assignees` includes the filter

- [ ] **Step 1:** Render an avatar stack from `task.assignees` (reuse `Initials`; overflow "+N") in card + row.
- [ ] **Step 2:** The assignee control becomes multi-select: checkboxes per member; toggling calls `POST/DELETE /api/tasks/[id]/assignees`. Shown to managers and CS-in-agent.
- [ ] **Step 3:** `filtering.ts` — change the assignee predicate:

```ts
if (c.assignee) {
  if (c.assignee === NO_ASSIGNEE) {
    if (task.assignees.length > 0) return false;
  } else if (!task.assignees.includes(c.assignee)) {
    return false;
  }
}
```

Add a filtering test asserting any-of match. Update `defaultSearchText` to use `assignees.join(" ")`.

- [ ] **Step 4: Verify** `npx tsc --noEmit` → No errors; `npx vitest run src/lib/tasks` → PASS; `npx eslint <changed files>` → clean.
- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks src/app/(authed)/tasks/_components
git commit -m "feat(tasks): multi-assignee UI (avatar stack, multi-select, any-of filter)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2.7: retire `assignee_email` reads (cleanup)

**Files:**
- Modify: all remaining readers of `assignee_email` (grep), `transitions.ts`, `access.ts`, UI.

- [ ] **Step 1:** `grep -rn "assignee_email" src` — replace remaining reads with the `assignees[]`/junction equivalents (e.g., `canViewTask`/`canMutateTask` flag inputs already cover routes). Keep DB column for now (drop in a later, separate migration once production is verified).
- [ ] **Step 2:** Update `StatusPill`/avatar logic that used `task.assignee_email !== null` to `task.assignees.length > 0`.
- [ ] **Step 3: Verify** `npx tsc --noEmit`; `npx vitest run src/lib/tasks`; `npx eslint`.
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(tasks): drive assignment off task_assignees, deprecate assignee_email reads

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Phase 2 manual check** — assign 2 people to a task; both see/edit it; avatar stack shows 2; removing the last sends it to backlog.

---

## Self-Review

**Spec coverage:**
- Perf #1 auth → Task 0.1/0.2 ✓; #2 members → 0.3 ✓; #3 signing → 0.4 ✓.
- C1 membership table → 1.1 ✓; helpers → 1.2 ✓; canView/canAssign → 1.3 ✓; fetch → 1.4 ✓; routes → 1.5 ✓; assign perm → 1.6 ✓; admin API → 1.7 ✓; admin UI → 1.8 ✓; create-flow agent → 1.9 ✓.
- C2 junction+backfill → 2.1 ✓; invariant → 2.2 ✓; queries/type → 2.3 ✓; endpoints → 2.4 ✓; mutate → 2.5 ✓; UI → 2.6 ✓; cleanup → 2.7 ✓.
- RLS additions: 1.1, 2.1 ✓. Realtime reuse: noted (endpoints broadcast in 2.4). Permissions matrix realized by 1.3/1.5/1.6/2.5.

**Placeholder scan:** Tasks 1.5, 1.8, 1.9, 2.4, 2.6, 2.7 reference "follow the existing pattern / grep" rather than full code for boilerplate handlers/UI — intentional because exact code depends on existing file shapes the implementer must open (guard helper names, nav config, drawer markup). Core logic (flattenAccess, resolveAssigneeChange, canView/canAssign/canMutate, filtering predicate, queries) has complete code. Acceptable; not silent TODOs.

**Type consistency:** `canViewTask(actor, task, flags)`, `canAssignToTask(actor, isAgentMember)`, `canMutateTask(actor, task, isAssignee)`, `resolveAssigneeChange(current, change)`, `fetchAgentsForCs/fetchCsForAgent`, `TaskRow.assignees: string[]` used consistently across tasks.

## Notes for the implementer
- Confirm exact RBAC export/permission names before Tasks 1.7/1.8 (`requirePermission`, `PERMISSIONS.MANAGEMENT_ACCOUNT_MANAGER`) by opening `src/lib/rbac/server.ts` and `src/lib/rbac/permissions.ts`.
- After each phase, run the phase manual check and the SQL blocks (1.1, 2.1) before exercising the feature.
