# Task Board Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the database, permissions, navigation, and a gated `/tasks` page shell so the Task Board has a working, role-aware foundation before any task CRUD is built.

**Architecture:** New Postgres tables in `supabase/schema.sql` (service-role access, RLS-on like all other tables). Two new RBAC permission keys declared in both `src/lib/rbac/permissions.ts` and the SQL `permissions` seed. A new pure-logic module `src/lib/tasks/access.ts` centralizes all permission/scope decisions (unit-tested). The `/tasks` route is gated server-side with the existing `requireAnyPermission` helper and shows a placeholder until Phase 2.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (`@supabase/supabase-js` via service role), next-auth v5, Tailwind v4, vitest.

## Global Constraints

- Permission keys live in TWO places and must stay in sync: `src/lib/rbac/permissions.ts` (`PERMISSIONS` + `PERMISSION_DEFINITIONS`) AND the `insert into permissions ... on conflict` seed in `supabase/schema.sql`. The seed's `delete from permissions where key not in (...)` allow-list MUST include every new key or it gets deleted on re-run.
- User identity key is **email** (`session.user.email`); there is no account id in the session.
- All authorization is enforced **server-side**; the client never decides permissions. App uses the service-role Supabase client (`getSupabaseAdmin()`), which bypasses RLS.
- New permission keys: `task.manage` (label "Tasks - Manage"), `task.work` (label "Tasks - Work"), group `tasks` / "Tasks".
- Brand color `#0f2849`; icons from `lucide-react`; tests use vitest with the `@/` path alias.
- Status enum: `backlog | todo | in_progress | waiting | done`. Priority enum: `low | medium | high | urgent`. Invariant: a `backlog` task has `assignee_email = null`; assigning moves status to `todo`.

---

### Task 1: Database schema — task board tables

**Files:**
- Modify: `supabase/schema.sql` (append new tables before the final RLS `do $$` block; extend the permissions seed and the `protected_tables` array)

This task has no unit test (it is SQL run manually in the Supabase SQL editor). Verification is by running it and inspecting the tables.

- [ ] **Step 1: Add the six task tables**

Insert this block in `supabase/schema.sql` immediately BEFORE the final "Defense-in-depth: enable RLS" `do $$ ... $$;` block:

```sql
-- ============================================================
-- Task Board (customer-service work tracking)
-- ============================================================
create table if not exists task_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text,
  position integer not null default 0,
  is_active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'backlog'
    check (status in ('backlog','todo','in_progress','waiting','done')),
  priority text not null default 'medium'
    check (priority in ('low','medium','high','urgent')),
  category_id uuid references task_categories(id) on delete set null,
  assignee_email text,
  reporter_email text not null,
  due_date date,
  waiting_reason text
    check (waiting_reason is null or waiting_reason in ('customer','carrier','documents','other')),
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint tasks_backlog_no_assignee
    check (status <> 'backlog' or assignee_email is null)
);

create index if not exists tasks_assignee_idx on tasks (assignee_email);
create index if not exists tasks_status_position_idx on tasks (status, position);
create index if not exists tasks_category_idx on tasks (category_id);
create index if not exists tasks_due_date_idx on tasks (due_date);
create index if not exists tasks_archived_idx on tasks (archived_at);

create table if not exists task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  parent_id uuid references task_comments(id) on delete cascade,
  author_email text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists task_comments_task_idx on task_comments (task_id, created_at);

create table if not exists task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  comment_id uuid references task_comments(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by text,
  created_at timestamptz not null default now()
);

create index if not exists task_attachments_task_idx on task_attachments (task_id);

create table if not exists task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  actor_email text not null,
  type text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists task_activity_task_idx on task_activity (task_id, created_at);

create table if not exists task_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  task_id uuid not null references tasks(id) on delete cascade,
  type text not null check (type in ('assigned','mentioned','commented')),
  actor_email text not null,
  comment_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists task_notifications_recipient_idx
  on task_notifications (recipient_email, is_read, created_at desc);
```

- [ ] **Step 2: Seed the two new permissions**

In the existing `insert into permissions (key, label, description, group_key, group_label, sort_order) values` block, add these two rows to the `values` list (before the closing `on conflict`):

```sql
  ('task.manage', 'Tasks - Manage', 'Create, assign and manage all tasks, and see the backlog.', 'tasks', 'Tasks', 100),
  ('task.work', 'Tasks - Work', 'Work on tasks assigned to you.', 'tasks', 'Tasks', 200),
```

- [ ] **Step 3: Keep the new permissions from being deleted**

In the `delete from permissions where key not in (...)` block, add the two new keys to the allow-list:

```sql
  'task.manage',
  'task.work',
```

- [ ] **Step 4: Enable RLS on the new tables**

In the final `protected_tables text[] := array[...]` list, add the six new table names:

```sql
    'task_categories',
    'tasks',
    'task_comments',
    'task_attachments',
    'task_activity',
    'task_notifications',
```

- [ ] **Step 5: Run and verify**

Run the full `supabase/schema.sql` in the Supabase SQL editor. Expected: no errors; re-running is idempotent.
Verify:
```sql
select key from permissions where key in ('task.manage','task.work');
-- Expected: 2 rows
select count(*) from tasks;
-- Expected: 0
```

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(tasks): add task board tables and permissions to schema"
```

---

### Task 2: Permission constants (TypeScript side)

**Files:**
- Modify: `src/lib/rbac/permissions.ts`
- Test: `src/lib/rbac/permissions.test.ts` (create)

**Interfaces:**
- Produces: `PERMISSIONS.TASK_MANAGE = "task.manage"`, `PERMISSIONS.TASK_WORK = "task.work"`, and matching entries in `PERMISSION_DEFINITIONS`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/rbac/permissions.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { PERMISSIONS, PERMISSION_DEFINITIONS } from "@/lib/rbac/permissions";

describe("task permissions", () => {
  it("declares the two task permission keys", () => {
    expect(PERMISSIONS.TASK_MANAGE).toBe("task.manage");
    expect(PERMISSIONS.TASK_WORK).toBe("task.work");
  });

  it("has a definition for each task key in the Tasks group", () => {
    const keys = PERMISSION_DEFINITIONS.filter(
      (d) => d.groupKey === "tasks"
    ).map((d) => d.key);
    expect(keys).toContain("task.manage");
    expect(keys).toContain("task.work");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rbac/permissions.test.ts`
Expected: FAIL — `PERMISSIONS.TASK_MANAGE` is `undefined`.

- [ ] **Step 3: Add the keys and definitions**

In `src/lib/rbac/permissions.ts`, add to the `PERMISSIONS` object (after `SETTINGS`):

```typescript
  TASK_MANAGE: "task.manage",
  TASK_WORK: "task.work",
```

Add to the `PERMISSION_DEFINITIONS` array (after the settings entry):

```typescript
  {
    key: PERMISSIONS.TASK_MANAGE,
    label: "Tasks - Manage",
    groupKey: "tasks",
    groupLabel: "Tasks",
    description: "Create, assign and manage all tasks, and see the backlog.",
    sortOrder: 100,
  },
  {
    key: PERMISSIONS.TASK_WORK,
    label: "Tasks - Work",
    groupKey: "tasks",
    groupLabel: "Tasks",
    description: "Work on tasks assigned to you.",
    sortOrder: 200,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/rbac/permissions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rbac/permissions.ts src/lib/rbac/permissions.test.ts
git commit -m "feat(tasks): add task.manage and task.work permission constants"
```

---

### Task 3: Task domain types

**Files:**
- Create: `src/lib/tasks/types.ts`

**Interfaces:**
- Produces: `TaskStatus`, `TaskPriority`, `WaitingReason`, `TASK_STATUSES`, `TASK_PRIORITIES`, `WAITING_REASONS`, `TaskRow`, `TaskActor` types used by every later task.

- [ ] **Step 1: Create the types module**

Create `src/lib/tasks/types.ts`:

```typescript
// Shared types + enum whitelists for the Task Board. Imported by access
// helpers, API routes, and UI. Mirrors the columns in supabase/schema.sql.

export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "waiting",
  "done",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const WAITING_REASONS = [
  "customer",
  "carrier",
  "documents",
  "other",
] as const;
export type WaitingReason = (typeof WAITING_REASONS)[number];

// Columns shown on the Kanban (Backlog is a separate view, not a Kanban column).
export const KANBAN_STATUSES: TaskStatus[] = [
  "todo",
  "in_progress",
  "waiting",
  "done",
];

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  category_id: string | null;
  assignee_email: string | null;
  reporter_email: string;
  due_date: string | null;
  waiting_reason: WaitingReason | null;
  position: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

// Derived from the session; the only source of truth for permissions.
export type TaskActor = {
  email: string;
  isManager: boolean;
  isWorker: boolean;
};
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tasks/types.ts
git commit -m "feat(tasks): add task board domain types"
```

---

### Task 4: Access/scope helper module (the heart of authorization)

**Files:**
- Create: `src/lib/tasks/access.ts`
- Test: `src/lib/tasks/access.test.ts`

**Interfaces:**
- Consumes: `PERMISSIONS` from `@/lib/rbac/permissions`, `can` from `@/lib/rbac/client`, `TaskActor`, `TaskRow`, `TaskStatus` from `./types`.
- Produces:
  - `buildTaskActor(permissions: readonly string[] | undefined, email: string): TaskActor`
  - `canAccessBoard(actor: TaskActor): boolean`
  - `canSeeBacklog(actor: TaskActor): boolean`
  - `canCreateTask(actor: TaskActor): boolean`
  - `canAssign(actor: TaskActor): boolean`
  - `canManageCategories(actor: TaskActor): boolean`
  - `canMutateTask(actor: TaskActor, task: Pick<TaskRow, "assignee_email">): boolean`
  - `canViewTask(actor: TaskActor, task: Pick<TaskRow, "assignee_email">): boolean`
  - `resolveCreateAssignment(actor, input): { ok: true; assignee_email: string | null; status: TaskStatus } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/tasks/access.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  buildTaskActor,
  canAccessBoard,
  canSeeBacklog,
  canCreateTask,
  canAssign,
  canManageCategories,
  canMutateTask,
  canViewTask,
  resolveCreateAssignment,
} from "@/lib/tasks/access";

const manager = buildTaskActor(["task.manage"], "mgr@x.com");
const cs = buildTaskActor(["task.work"], "cs@x.com");
const outsider = buildTaskActor(["settings.access"], "out@x.com");

describe("buildTaskActor", () => {
  it("flags manager and worker from permissions", () => {
    expect(manager.isManager).toBe(true);
    expect(manager.isWorker).toBe(false);
    expect(cs.isWorker).toBe(true);
    expect(cs.isManager).toBe(false);
    expect(manager.email).toBe("mgr@x.com");
  });
});

describe("board access", () => {
  it("manager and CS can access; outsider cannot", () => {
    expect(canAccessBoard(manager)).toBe(true);
    expect(canAccessBoard(cs)).toBe(true);
    expect(canAccessBoard(outsider)).toBe(false);
  });
  it("only manager sees backlog", () => {
    expect(canSeeBacklog(manager)).toBe(true);
    expect(canSeeBacklog(cs)).toBe(false);
  });
});

describe("create / assign / categories", () => {
  it("both roles can create tasks", () => {
    expect(canCreateTask(manager)).toBe(true);
    expect(canCreateTask(cs)).toBe(true);
    expect(canCreateTask(outsider)).toBe(false);
  });
  it("only manager assigns and manages categories", () => {
    expect(canAssign(manager)).toBe(true);
    expect(canAssign(cs)).toBe(false);
    expect(canManageCategories(manager)).toBe(true);
    expect(canManageCategories(cs)).toBe(false);
  });
});

describe("per-task view/mutate scope", () => {
  it("manager can view/mutate any task", () => {
    expect(canViewTask(manager, { assignee_email: "cs@x.com" })).toBe(true);
    expect(canMutateTask(manager, { assignee_email: "cs@x.com" })).toBe(true);
    expect(canMutateTask(manager, { assignee_email: null })).toBe(true);
  });
  it("CS can only view/mutate own assigned tasks", () => {
    expect(canViewTask(cs, { assignee_email: "cs@x.com" })).toBe(true);
    expect(canViewTask(cs, { assignee_email: "other@x.com" })).toBe(false);
    expect(canViewTask(cs, { assignee_email: null })).toBe(false);
    expect(canMutateTask(cs, { assignee_email: "cs@x.com" })).toBe(true);
    expect(canMutateTask(cs, { assignee_email: "other@x.com" })).toBe(false);
  });
});

describe("resolveCreateAssignment", () => {
  it("CS create is forced to self + todo regardless of input", () => {
    const r = resolveCreateAssignment(cs, {
      assignee_email: "someone@x.com",
      status: "backlog",
    });
    expect(r).toEqual({ ok: true, assignee_email: "cs@x.com", status: "todo" });
  });
  it("manager may leave it in backlog (unassigned)", () => {
    const r = resolveCreateAssignment(manager, {
      assignee_email: null,
      status: "backlog",
    });
    expect(r).toEqual({ ok: true, assignee_email: null, status: "backlog" });
  });
  it("manager assigning forces status out of backlog to todo", () => {
    const r = resolveCreateAssignment(manager, {
      assignee_email: "cs@x.com",
      status: "backlog",
    });
    expect(r).toEqual({ ok: true, assignee_email: "cs@x.com", status: "todo" });
  });
  it("manager may create directly in a working column with an assignee", () => {
    const r = resolveCreateAssignment(manager, {
      assignee_email: "cs@x.com",
      status: "in_progress",
    });
    expect(r).toEqual({
      ok: true,
      assignee_email: "cs@x.com",
      status: "in_progress",
    });
  });
  it("rejects a non-backlog task with no assignee", () => {
    const r = resolveCreateAssignment(manager, {
      assignee_email: null,
      status: "todo",
    });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/tasks/access.test.ts`
Expected: FAIL — module `@/lib/tasks/access` not found.

- [ ] **Step 3: Implement the access module**

Create `src/lib/tasks/access.ts`:

```typescript
// The ONLY place task-board permission/scope decisions are made. Pure functions
// (no I/O) so they are fully unit-tested. API routes call these; the client
// never decides permissions. Identity is by email (no account id in session).
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import type { TaskActor, TaskRow, TaskStatus } from "./types";

export function buildTaskActor(
  permissions: readonly string[] | undefined,
  email: string
): TaskActor {
  return {
    email,
    isManager: can(permissions, PERMISSIONS.TASK_MANAGE),
    isWorker: can(permissions, PERMISSIONS.TASK_WORK),
  };
}

export function canAccessBoard(actor: TaskActor): boolean {
  return actor.isManager || actor.isWorker;
}

// Backlog (unassigned work) is a manager-only view.
export function canSeeBacklog(actor: TaskActor): boolean {
  return actor.isManager;
}

export function canCreateTask(actor: TaskActor): boolean {
  return actor.isManager || actor.isWorker;
}

export function canAssign(actor: TaskActor): boolean {
  return actor.isManager;
}

export function canManageCategories(actor: TaskActor): boolean {
  return actor.isManager;
}

// Manager: any task. Worker: only a task currently assigned to them.
export function canViewTask(
  actor: TaskActor,
  task: Pick<TaskRow, "assignee_email">
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return task.assignee_email === actor.email;
}

export function canMutateTask(
  actor: TaskActor,
  task: Pick<TaskRow, "assignee_email">
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return task.assignee_email === actor.email;
}

export type CreateAssignmentInput = {
  assignee_email: string | null;
  status: TaskStatus;
};

export type CreateAssignmentResult =
  | { ok: true; assignee_email: string | null; status: TaskStatus }
  | { ok: false; error: string };

// Enforces the core invariants at creation time:
//  - A worker can only create tasks assigned to themselves, never in backlog.
//  - A backlog task must have no assignee; assigning forces status -> 'todo'.
//  - A non-backlog task must have an assignee.
export function resolveCreateAssignment(
  actor: TaskActor,
  input: CreateAssignmentInput
): CreateAssignmentResult {
  if (!actor.isManager && actor.isWorker) {
    // Worker: always self-assigned, always 'todo'.
    return { ok: true, assignee_email: actor.email, status: "todo" };
  }
  if (!actor.isManager) {
    return { ok: false, error: "Not allowed to create tasks." };
  }

  // Manager.
  const assignee = input.assignee_email?.trim() || null;
  if (assignee === null) {
    // Unassigned -> must be backlog.
    return { ok: true, assignee_email: null, status: "backlog" };
  }
  // Assigned -> cannot be backlog; default backlog request to 'todo'.
  const status = input.status === "backlog" ? "todo" : input.status;
  return { ok: true, assignee_email: assignee, status };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/tasks/access.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/access.ts src/lib/tasks/access.test.ts
git commit -m "feat(tasks): add task access/scope helpers with tests"
```

---

### Task 5: Sidebar entry + route registration

**Files:**
- Modify: `src/app/(authed)/_components/Sidebar.tsx`
- Modify: `src/lib/rbac/routes.ts`

**Interfaces:**
- Consumes: `PERMISSIONS.TASK_MANAGE`, `PERMISSIONS.TASK_WORK` (Task 2).

- [ ] **Step 1: Add the "Tasks" nav item**

In `src/app/(authed)/_components/Sidebar.tsx`, add this entry to the `menuData` array (after the "Dashboard" block, before "Management"). It is a single link (no children), gated by either task permission:

```typescript
  {
    href: "/tasks",
    label: "Tasks",
    anyPermission: [PERMISSIONS.TASK_MANAGE, PERMISSIONS.TASK_WORK],
  },
```

- [ ] **Step 2: Register the route for redirect fallback**

In `src/lib/rbac/routes.ts`, add to the `ACCESSIBLE_ROUTES` array (after the dashboard routes):

```typescript
  {
    href: "/tasks",
    anyPermission: [PERMISSIONS.TASK_MANAGE, PERMISSIONS.TASK_WORK],
  },
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(authed)/_components/Sidebar.tsx" src/lib/rbac/routes.ts
git commit -m "feat(tasks): add Tasks nav item and route"
```

---

### Task 6: `/tasks` page shell (server-gated)

**Files:**
- Create: `src/app/(authed)/tasks/page.tsx`
- Create: `src/app/(authed)/tasks/_components/TaskBoardPlaceholder.tsx`

**Interfaces:**
- Consumes: `requireAnyPermission` from `@/lib/rbac/server`, `PERMISSIONS`, `buildTaskActor` (Task 4).
- Produces: the `/tasks` route. Later phases replace `TaskBoardPlaceholder` with the real board.

- [ ] **Step 1: Create the placeholder client component**

Create `src/app/(authed)/tasks/_components/TaskBoardPlaceholder.tsx`:

```tsx
type Props = {
  isManager: boolean;
};

export function TaskBoardPlaceholder({ isManager }: Props) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-[#0f2849]">Tasks</h1>
      <p className="mt-2 text-sm text-slate-500">
        Task board is coming online.
        {isManager
          ? " You can manage and assign tasks."
          : " You can work on tasks assigned to you."}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Create the gated server page**

Create `src/app/(authed)/tasks/page.tsx`:

```tsx
import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { buildTaskActor } from "@/lib/tasks/access";
import { TaskBoardPlaceholder } from "./_components/TaskBoardPlaceholder";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const session = await requireAnyPermission([
    PERMISSIONS.TASK_MANAGE,
    PERMISSIONS.TASK_WORK,
  ]);
  const actor = buildTaskActor(
    session.user.permissions,
    session.user.email ?? ""
  );

  return <TaskBoardPlaceholder isManager={actor.isManager} />;
}
```

- [ ] **Step 3: Verify build + gating**

Run: `npx tsc --noEmit`
Expected: No errors.

Run: `npx next build`
Expected: Build succeeds; `/tasks` appears in the route list.

- [ ] **Step 4: Manual verification**

1. Grant `task.manage` to a test role (Role Manager) and assign to a Manager test account; grant `task.work` to a CS account.
2. As Manager: visit `/tasks` → see "You can manage and assign tasks." "Tasks" appears in the sidebar.
3. As CS: visit `/tasks` → see "You can work on tasks assigned to you."
4. As an account with neither permission: `/tasks` redirects away (to first accessible path); "Tasks" is absent from the sidebar.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authed)/tasks"
git commit -m "feat(tasks): add gated /tasks page shell"
```

---

## Self-Review

**Spec coverage (Phase 1 portion):**
- Tables (tasks, categories, comments, attachments, activity, notifications) → Task 1. ✓
- Permission keys in both TS + SQL, delete-allow-list updated → Tasks 1 & 2. ✓
- RLS on new tables → Task 1 Step 4. ✓
- Backlog invariant (`backlog` ⇒ no assignee; assign ⇒ todo) → DB check constraint (Task 1) + `resolveCreateAssignment` (Task 4). ✓
- Sidebar "Tasks" + `/tasks` route + routes.ts → Tasks 5 & 6. ✓
- Server-gated page by either task permission → Task 6. ✓
- Identity by email → `buildTaskActor` uses email. ✓

**Placeholder scan:** No TBD/TODO; every code step contains full code. ✓

**Type consistency:** `TaskActor`, `TaskRow`, `TaskStatus` defined in Task 3 and consumed unchanged in Tasks 4 & 6. `buildTaskActor` signature identical across Tasks 4 and 6. ✓

**Deferred to later phases (not gaps):** task CRUD API, board UI, comments, notifications, attachments, categories UI — Phases 2–4.
