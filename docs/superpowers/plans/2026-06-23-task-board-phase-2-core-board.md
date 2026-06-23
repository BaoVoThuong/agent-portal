# Task Board Phase 2 — Core Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full task lifecycle — create, list (role-scoped), edit, assign, drag across the Kanban, and manage the Backlog — on the `/tasks` page.

**Architecture:** Pure helpers in `src/lib/tasks/` (ordering, update-invariant) keep all logic unit-testable. Server route handlers under `src/app/api/tasks/` enforce authorization via the Phase 1 access helpers and the service-role client. The page server-fetches the scoped task list and renders a client board (`@dnd-kit` Kanban + Backlog tab) with optimistic updates.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase service role, `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`, Tailwind v4, lucide-react, vitest.

**Depends on:** Phase 1 (tables, permissions, `src/lib/tasks/types.ts`, `src/lib/tasks/access.ts`, `/tasks` shell).

## Global Constraints

- Identity is **email**. Authorization is **server-side** only; reuse Phase 1 access helpers (`buildTaskActor`, `canViewTask`, `canMutateTask`, `canAssign`, `canCreateTask`, `resolveCreateAssignment`).
- Status enum `backlog|todo|in_progress|waiting|done`; priority `low|medium|high|urgent`; waiting_reason `customer|carrier|documents|other`.
- Invariants: a `backlog` task has `assignee_email = null`; a non-backlog task MUST have an assignee; `waiting_reason` is non-null only when status is `waiting`.
- Kanban columns are `todo, in_progress, waiting, done` (Backlog is a separate tab, manager-only).
- Brand `#0f2849`; lucide-react icons; vitest with `@/` alias.
- Activity-log writes, comments, notifications, attachments, and category UI are OUT of this phase (Phases 3–4). Tasks created here have `category_id = null`.

---

### Task 1: Install drag-and-drop dependencies

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install @dnd-kit packages**

Run:
```bash
npm install @dnd-kit/core@^6 @dnd-kit/sortable@^9 @dnd-kit/utilities@^3
```
Expected: three packages added to `dependencies`.

- [ ] **Step 2: Verify install**

Run: `npx tsc --noEmit`
Expected: No errors (deps resolve).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(tasks): add @dnd-kit for the Kanban board"
```

---

### Task 2: Ordering helper (`midpoint`)

**Files:**
- Create: `src/lib/tasks/ordering.ts`
- Test: `src/lib/tasks/ordering.test.ts`

**Interfaces:**
- Produces: `midpoint(before: number | null, after: number | null): number` — a position strictly between two neighbors (or above/below a single neighbor, or `1` for an empty column).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/tasks/ordering.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { midpoint } from "@/lib/tasks/ordering";

describe("midpoint", () => {
  it("empty column -> 1", () => {
    expect(midpoint(null, null)).toBe(1);
  });
  it("drop at top (above first) -> below.value - 1", () => {
    expect(midpoint(null, 10)).toBe(9);
  });
  it("drop at bottom (after last) -> above.value + 1", () => {
    expect(midpoint(10, null)).toBe(11);
  });
  it("drop between two -> average", () => {
    expect(midpoint(10, 20)).toBe(15);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/tasks/ordering.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `midpoint`**

Create `src/lib/tasks/ordering.ts`:

```typescript
// Fractional ranking for card order within a column. The client computes the
// new position from the neighbours in the drop target and sends it to the API.
export function midpoint(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1;
  if (before === null) return (after as number) - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/tasks/ordering.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/ordering.ts src/lib/tasks/ordering.test.ts
git commit -m "feat(tasks): add midpoint ordering helper"
```

---

### Task 3: Update-invariant helper (`resolveTaskPatch`)

**Files:**
- Create: `src/lib/tasks/transitions.ts`
- Test: `src/lib/tasks/transitions.test.ts`

**Interfaces:**
- Consumes: `canAssign` from `@/lib/tasks/access`; `TaskActor`, `TaskRow`, `TaskStatus`, `TaskPriority`, `WaitingReason`, `TASK_STATUSES`, `TASK_PRIORITIES`, `WAITING_REASONS` from `./types`.
- Produces:
  - `type TaskPatchInput` = partial of editable fields (`title`, `description`, `priority`, `due_date`, `category_id`, `status`, `assignee_email`, `waiting_reason`, `position`).
  - `resolveTaskPatch(actor: TaskActor, current: Pick<TaskRow,"status"|"assignee_email">, raw: unknown): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/tasks/transitions.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveTaskPatch } from "@/lib/tasks/transitions";
import { buildTaskActor } from "@/lib/tasks/access";

const manager = buildTaskActor(["task.manage"], "mgr@x.com");
const cs = buildTaskActor(["task.work"], "cs@x.com");
const assigned = { status: "todo" as const, assignee_email: "cs@x.com" };

describe("resolveTaskPatch", () => {
  it("accepts a simple field edit", () => {
    const r = resolveTaskPatch(manager, assigned, { title: "  New title  " });
    expect(r).toEqual({ ok: true, patch: { title: "New title" } });
  });

  it("rejects empty title", () => {
    const r = resolveTaskPatch(manager, assigned, { title: "   " });
    expect(r.ok).toBe(false);
  });

  it("worker cannot reassign", () => {
    const r = resolveTaskPatch(cs, assigned, { assignee_email: "other@x.com" });
    expect(r.ok).toBe(false);
  });

  it("manager can reassign", () => {
    const r = resolveTaskPatch(manager, assigned, { assignee_email: "other@x.com" });
    expect(r).toEqual({ ok: true, patch: { assignee_email: "other@x.com" } });
  });

  it("moving to backlog while still assigned is rejected", () => {
    const r = resolveTaskPatch(manager, assigned, { status: "backlog" });
    expect(r.ok).toBe(false);
  });

  it("manager can send back to backlog by unassigning in the same patch", () => {
    const r = resolveTaskPatch(manager, assigned, {
      status: "backlog",
      assignee_email: null,
    });
    expect(r).toEqual({
      ok: true,
      patch: { status: "backlog", assignee_email: null },
    });
  });

  it("rejects leaving backlog without an assignee", () => {
    const r = resolveTaskPatch(
      manager,
      { status: "backlog", assignee_email: null },
      { status: "todo" }
    );
    expect(r.ok).toBe(false);
  });

  it("waiting_reason kept only when status is waiting", () => {
    const r1 = resolveTaskPatch(cs, assigned, {
      status: "waiting",
      waiting_reason: "customer",
    });
    expect(r1).toEqual({
      ok: true,
      patch: { status: "waiting", waiting_reason: "customer" },
    });
    const r2 = resolveTaskPatch(cs, assigned, {
      status: "in_progress",
      waiting_reason: "customer",
    });
    expect(r2).toEqual({
      ok: true,
      patch: { status: "in_progress", waiting_reason: null },
    });
  });

  it("validates enums and position", () => {
    expect(resolveTaskPatch(manager, assigned, { priority: "nope" }).ok).toBe(false);
    expect(resolveTaskPatch(manager, assigned, { status: "nope" }).ok).toBe(false);
    expect(
      resolveTaskPatch(manager, assigned, { position: 3.5 })
    ).toEqual({ ok: true, patch: { position: 3.5 } });
    expect(resolveTaskPatch(manager, assigned, { position: "x" }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/tasks/transitions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `resolveTaskPatch`**

Create `src/lib/tasks/transitions.ts`:

```typescript
// Pure validation + invariant enforcement for task updates. Returns a clean
// patch object (only the fields that actually change) or an error. The API route
// applies the patch via Supabase. Permission to mutate the task at all is checked
// separately (canMutateTask); this enforces field-level rules + invariants.
import { canAssign } from "./access";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  WAITING_REASONS,
  type TaskActor,
  type TaskRow,
} from "./types";

export type TaskPatchInput = {
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  due_date?: unknown;
  category_id?: unknown;
  status?: unknown;
  assignee_email?: unknown;
  waiting_reason?: unknown;
  position?: unknown;
};

type Current = Pick<TaskRow, "status" | "assignee_email">;
type Result =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; error: string };

function isEnum<T extends readonly string[]>(v: unknown, allowed: T): v is T[number] {
  return typeof v === "string" && (allowed as readonly string[]).includes(v);
}

export function resolveTaskPatch(
  actor: TaskActor,
  current: Current,
  raw: unknown
): Result {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid body." };
  const r = raw as TaskPatchInput;
  const patch: Record<string, unknown> = {};

  if (r.title !== undefined) {
    if (typeof r.title !== "string" || r.title.trim() === "")
      return { ok: false, error: "Title is required." };
    patch.title = r.title.trim();
  }
  if (r.description !== undefined) {
    patch.description =
      typeof r.description === "string" && r.description.trim() !== ""
        ? r.description.trim()
        : null;
  }
  if (r.priority !== undefined) {
    if (!isEnum(r.priority, TASK_PRIORITIES))
      return { ok: false, error: "Invalid priority." };
    patch.priority = r.priority;
  }
  if (r.due_date !== undefined) {
    patch.due_date =
      typeof r.due_date === "string" && r.due_date.trim() !== ""
        ? r.due_date.trim()
        : null;
  }
  if (r.category_id !== undefined) {
    patch.category_id =
      typeof r.category_id === "string" && r.category_id.trim() !== ""
        ? r.category_id.trim()
        : null;
  }
  if (r.position !== undefined) {
    if (typeof r.position !== "number" || !Number.isFinite(r.position))
      return { ok: false, error: "Invalid position." };
    patch.position = r.position;
  }

  // --- status / assignee / waiting_reason are interdependent ---
  const reassigning = r.assignee_email !== undefined;
  if (reassigning && !canAssign(actor)) {
    return { ok: false, error: "You cannot reassign tasks." };
  }
  if (r.status !== undefined && !isEnum(r.status, TASK_STATUSES)) {
    return { ok: false, error: "Invalid status." };
  }

  const nextAssignee = reassigning
    ? (typeof r.assignee_email === "string" && r.assignee_email.trim() !== ""
        ? r.assignee_email.trim()
        : null)
    : current.assignee_email;
  const nextStatus = (r.status as TaskRow["status"]) ?? current.status;

  if (nextStatus === "backlog" && nextAssignee !== null) {
    return { ok: false, error: "Unassign the task before moving it to backlog." };
  }
  if (nextStatus !== "backlog" && nextAssignee === null) {
    return { ok: false, error: "Assign someone before moving out of backlog." };
  }

  if (reassigning) patch.assignee_email = nextAssignee;
  if (r.status !== undefined) patch.status = nextStatus;

  // waiting_reason only meaningful in 'waiting'; otherwise force null when status changes.
  if (r.waiting_reason !== undefined || r.status !== undefined) {
    if (nextStatus === "waiting") {
      if (r.waiting_reason !== undefined) {
        if (r.waiting_reason === null) {
          patch.waiting_reason = null;
        } else if (isEnum(r.waiting_reason, WAITING_REASONS)) {
          patch.waiting_reason = r.waiting_reason;
        } else {
          return { ok: false, error: "Invalid waiting reason." };
        }
      }
    } else {
      patch.waiting_reason = null;
    }
  }

  if (Object.keys(patch).length === 0)
    return { ok: false, error: "Nothing to update." };
  return { ok: true, patch };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/tasks/transitions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/transitions.ts src/lib/tasks/transitions.test.ts
git commit -m "feat(tasks): add task update invariant helper"
```

---

### Task 4: Server query + assignees lookup

**Files:**
- Create: `src/lib/tasks/queries.ts`
- Create: `src/lib/tasks/assignees.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin` from `@/lib/supabase`; `TaskActor`, `TaskRow` from `./types`.
- Produces:
  - `fetchTasksForActor(actor: TaskActor): Promise<TaskRow[]>` — non-archived tasks, scoped (manager: all; worker: `assignee_email = actor.email`).
  - `fetchTaskAssignees(): Promise<{ email: string; name: string | null }[]>` — active accounts holding `task.work` or `task.manage`.

These hit the DB; verification is via the API routes (Task 5) and manual testing.

- [ ] **Step 1: Implement the task query**

Create `src/lib/tasks/queries.ts`:

```typescript
import { getSupabaseAdmin } from "@/lib/supabase";
import type { TaskActor, TaskRow } from "./types";

const TASK_COLUMNS =
  "id,title,description,status,priority,category_id,assignee_email,reporter_email,due_date,waiting_reason,position,created_at,updated_at,archived_at";

export async function fetchTasksForActor(actor: TaskActor): Promise<TaskRow[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .is("archived_at", null)
    .order("position", { ascending: true });

  // Manager sees everything; worker sees only their own assigned tasks.
  if (!actor.isManager) {
    query = query.eq("assignee_email", actor.email);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TaskRow[];
}
```

- [ ] **Step 2: Implement the assignees lookup**

Create `src/lib/tasks/assignees.ts`:

```typescript
import { getSupabaseAdmin } from "@/lib/supabase";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export type TaskAssignee = { email: string; name: string | null };

// Active accounts whose role grants task.work or task.manage. Used by the
// assignee picker (manager only).
export async function fetchTaskAssignees(): Promise<TaskAssignee[]> {
  const supabase = getSupabaseAdmin();

  const { data: rp, error: rpErr } = await supabase
    .from("role_permissions")
    .select("role_id")
    .in("permission_key", [PERMISSIONS.TASK_WORK, PERMISSIONS.TASK_MANAGE]);
  if (rpErr) throw new Error(rpErr.message);

  const roleIds = [...new Set((rp ?? []).map((r) => (r as { role_id: string }).role_id))];
  if (roleIds.length === 0) return [];

  const { data: ur, error: urErr } = await supabase
    .from("user_roles")
    .select("user_id")
    .in("role_id", roleIds);
  if (urErr) throw new Error(urErr.message);

  const userIds = [...new Set((ur ?? []).map((r) => (r as { user_id: string }).user_id))];
  if (userIds.length === 0) return [];

  const { data: accounts, error: accErr } = await supabase
    .from("portal_account")
    .select("email,name,is_active")
    .in("id", userIds)
    .eq("is_active", true);
  if (accErr) throw new Error(accErr.message);

  return ((accounts ?? []) as unknown as { email: string; name: string | null }[])
    .map((a) => ({ email: a.email, name: a.name }))
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tasks/queries.ts src/lib/tasks/assignees.ts
git commit -m "feat(tasks): add scoped task query and assignee lookup"
```

---

### Task 5: Tasks collection API — `GET` / `POST /api/tasks`

**Files:**
- Create: `src/app/api/tasks/route.ts`

**Interfaces:**
- Consumes: `auth`, `buildTaskActor`, `canAccessBoard`, `canCreateTask`, `resolveCreateAssignment`, `fetchTasksForActor`, `getSupabaseAdmin`, `midpoint`.
- Produces: `GET` → `{ tasks: TaskRow[] }`; `POST` body `{ title, description?, priority?, due_date?, assignee_email?, status? }` → `{ task: TaskRow }`.

- [ ] **Step 1: Implement the route**

Create `src/app/api/tasks/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canAccessBoard, canCreateTask, resolveCreateAssignment } from "@/lib/tasks/access";
import { fetchTasksForActor } from "@/lib/tasks/queries";
import { midpoint } from "@/lib/tasks/ordering";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email);
  if (!canAccessBoard(actor))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tasks = await fetchTasksForActor(actor);
  return NextResponse.json({ tasks });
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email);
  if (!canCreateTask(actor))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });

  const requestedStatus =
    typeof body?.status === "string" &&
    (TASK_STATUSES as readonly string[]).includes(body.status)
      ? body.status
      : "backlog";
  const assignment = resolveCreateAssignment(actor, {
    assignee_email: typeof body?.assignee_email === "string" ? body.assignee_email : null,
    status: requestedStatus,
  });
  if (!assignment.ok)
    return NextResponse.json({ error: assignment.error }, { status: 400 });

  const priority =
    typeof body?.priority === "string" &&
    (TASK_PRIORITIES as readonly string[]).includes(body.priority)
      ? body.priority
      : "medium";

  const supabase = getSupabaseAdmin();
  // Place new card at the bottom of its column.
  const { data: last } = await supabase
    .from("tasks")
    .select("position")
    .eq("status", assignment.status)
    .is("archived_at", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = midpoint((last as { position: number } | null)?.position ?? null, null);

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title,
      description:
        typeof body?.description === "string" && body.description.trim() !== ""
          ? body.description.trim()
          : null,
      status: assignment.status,
      priority,
      assignee_email: assignment.assignee_email,
      reporter_email: email,
      due_date:
        typeof body?.due_date === "string" && body.due_date.trim() !== ""
          ? body.due_date.trim()
          : null,
      position,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}
```

- [ ] **Step 2: Verify type-check + build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Manual smoke test**

With the dev server running (`npm run dev`) and signed in as Manager:
```bash
# (use the browser devtools/network or a logged-in curl with session cookie)
# POST a task and GET the list; confirm 200 + the task appears.
```
Expected: `POST /api/tasks` returns the created task; `GET /api/tasks` includes it.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/tasks/route.ts
git commit -m "feat(tasks): add GET/POST /api/tasks"
```

---

### Task 6: Single-task API — `GET` / `PATCH` / `DELETE /api/tasks/[id]`

**Files:**
- Create: `src/app/api/tasks/[id]/route.ts`

**Interfaces:**
- Consumes: `auth`, `buildTaskActor`, `canViewTask`, `canMutateTask`, `resolveTaskPatch`, `getSupabaseAdmin`.
- Produces: `GET` → `{ task }`; `PATCH` body = patch fields → `{ task }`; `DELETE` → `{ ok: true }` (soft archive).
- Next 16 route handler signature: the second arg is `{ params }` where `params` is a `Promise` — `await` it.

- [ ] **Step 1: Implement the route**

Create `src/app/api/tasks/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canViewTask, canMutateTask } from "@/lib/tasks/access";
import { resolveTaskPatch } from "@/lib/tasks/transitions";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function loadActorAndTask(id: string) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };
  const actor = buildTaskActor(session.user.permissions, email);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found", status: 404 };
  return { actor, task: data as unknown as TaskRow, supabase };
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!canViewTask(r.actor, r.task))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  return NextResponse.json({ task: r.task });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!canMutateTask(r.actor, r.task))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const resolved = resolveTaskPatch(r.actor, r.task, body);
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });

  const { data, error } = await r.supabase
    .from("tasks")
    .update({ ...resolved.patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!canMutateTask(r.actor, r.task))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { error } = await r.supabase
    .from("tasks")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Manual smoke test**

As CS, `PATCH` your own task's status → 200. `PATCH` a task assigned to someone else → 403. As Manager, `PATCH` any task → 200.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/tasks/[id]/route.ts"
git commit -m "feat(tasks): add GET/PATCH/DELETE /api/tasks/[id]"
```

---

### Task 7: Assignees API — `GET /api/tasks/assignees`

**Files:**
- Create: `src/app/api/tasks/assignees/route.ts`

**Interfaces:**
- Consumes: `auth`, `buildTaskActor`, `canAssign`, `fetchTaskAssignees`.
- Produces: `GET` → `{ assignees: { email, name }[] }` (manager only).

- [ ] **Step 1: Implement the route**

Create `src/app/api/tasks/assignees/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildTaskActor, canAssign } from "@/lib/tasks/access";
import { fetchTaskAssignees } from "@/lib/tasks/assignees";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email);
  if (!canAssign(actor))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const assignees = await fetchTaskAssignees();
  return NextResponse.json({ assignees });
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add src/app/api/tasks/assignees/route.ts
git commit -m "feat(tasks): add GET /api/tasks/assignees"
```

---

### Task 8: Board client — display + shared UI atoms

**Files:**
- Create: `src/app/(authed)/tasks/_components/board-ui.tsx` (presentational atoms: priority dot, due badge, category/waiting tags, avatar)
- Create: `src/app/(authed)/tasks/_components/TaskCard.tsx`

**Interfaces:**
- Consumes: `TaskRow`, `TaskPriority` from `@/lib/tasks/types`.
- Produces: `PriorityDot`, `DueBadge`, `Initials`, `WaitingTag` (from board-ui); `TaskCard({ task, onOpen })`.

- [ ] **Step 1: Create the UI atoms**

Create `src/app/(authed)/tasks/_components/board-ui.tsx`:

```tsx
import type { TaskPriority, WaitingReason } from "@/lib/tasks/types";

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  low: "bg-slate-300",
  medium: "bg-sky-400",
  high: "bg-amber-500",
  urgent: "bg-red-500",
};

export function PriorityDot({ priority }: { priority: TaskPriority }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${PRIORITY_COLOR[priority]}`}
      title={priority}
      aria-label={`priority ${priority}`}
    />
  );
}

export function DueBadge({ due }: { due: string | null }) {
  if (!due) return null;
  const overdue = new Date(`${due}T23:59:59`) < new Date();
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        overdue ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500"
      }`}
    >
      {due}
    </span>
  );
}

const WAITING_LABEL: Record<WaitingReason, string> = {
  customer: "waiting: customer",
  carrier: "waiting: carrier",
  documents: "waiting: docs",
  other: "waiting",
};

export function WaitingTag({ reason }: { reason: WaitingReason | null }) {
  if (!reason) return null;
  return (
    <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-600">
      {WAITING_LABEL[reason]}
    </span>
  );
}

export function Initials({ email }: { email: string | null }) {
  if (!email) return null;
  const initials = email.slice(0, 2).toUpperCase();
  return (
    <span
      className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0f2849] text-[10px] font-semibold text-white"
      title={email}
    >
      {initials}
    </span>
  );
}
```

- [ ] **Step 2: Create the TaskCard**

Create `src/app/(authed)/tasks/_components/TaskCard.tsx`:

```tsx
import type { TaskRow } from "@/lib/tasks/types";
import { PriorityDot, DueBadge, WaitingTag, Initials } from "./board-ui";

export function TaskCard({
  task,
  onOpen,
}: {
  task: TaskRow;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      className="block w-full rounded-lg border border-slate-200 bg-white p-2.5 text-left shadow-sm transition hover:border-[#0f2849]/30"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-slate-800">{task.title}</span>
        <PriorityDot priority={task.priority} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <WaitingTag reason={task.waiting_reason} />
        <DueBadge due={task.due_date} />
        <span className="ml-auto">
          <Initials email={task.assignee_email} />
        </span>
      </div>
    </button>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add "src/app/(authed)/tasks/_components/board-ui.tsx" "src/app/(authed)/tasks/_components/TaskCard.tsx"
git commit -m "feat(tasks): add task card and board UI atoms"
```

---

### Task 9: Kanban board with drag-and-drop

**Files:**
- Create: `src/app/(authed)/tasks/_components/KanbanBoard.tsx`

**Interfaces:**
- Consumes: `TaskRow`, `KANBAN_STATUSES`, `TaskStatus` from `@/lib/tasks/types`; `midpoint` from `@/lib/tasks/ordering`; `TaskCard` (Task 8).
- Produces: `KanbanBoard({ tasks, onOpen, onMove })` where `onMove(taskId, { status, position }) => void`.

- [ ] **Step 1: Implement the board**

Create `src/app/(authed)/tasks/_components/KanbanBoard.tsx`:

```tsx
"use client";

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { KANBAN_STATUSES, type TaskRow, type TaskStatus } from "@/lib/tasks/types";
import { midpoint } from "@/lib/tasks/ordering";
import { TaskCard } from "./TaskCard";

const COLUMN_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  waiting: "Waiting",
  done: "Done",
};

function SortableCard({
  task,
  onOpen,
}: {
  task: TaskRow;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      {...attributes}
      {...listeners}
      className="mb-2"
    >
      <TaskCard task={task} onOpen={onOpen} />
    </div>
  );
}

function Column({
  status,
  tasks,
  onOpen,
}: {
  status: TaskStatus;
  tasks: TaskRow[];
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-slate-100 p-2">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {COLUMN_LABEL[status]}
        </span>
        <span className="text-xs text-slate-400">{tasks.length}</span>
      </div>
      <div ref={setNodeRef} className={`min-h-24 rounded-lg p-1 ${isOver ? "bg-slate-200" : ""}`}>
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => (
            <SortableCard key={t.id} task={t} onOpen={onOpen} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

export function KanbanBoard({
  tasks,
  onOpen,
  onMove,
}: {
  tasks: TaskRow[];
  onOpen: (id: string) => void;
  onMove: (taskId: string, change: { status: TaskStatus; position: number }) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const byStatus = (s: TaskStatus) =>
    tasks.filter((t) => t.status === s).sort((a, b) => a.position - b.position);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const moving = tasks.find((t) => t.id === activeId);
    if (!moving) return;

    // Destination status: dropped on a column area, or onto another card.
    let destStatus: TaskStatus;
    if (overId.startsWith("col:")) {
      destStatus = overId.slice(4) as TaskStatus;
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (!overTask) return;
      destStatus = overTask.status;
    }

    const dest = byStatus(destStatus).filter((t) => t.id !== activeId);
    // Index where it was dropped.
    let index = dest.length;
    if (!overId.startsWith("col:")) {
      const overIdx = dest.findIndex((t) => t.id === overId);
      if (overIdx !== -1) index = overIdx;
    }
    const before = index > 0 ? dest[index - 1].position : null;
    const after = index < dest.length ? dest[index].position : null;
    const position = midpoint(before, after);

    if (destStatus === moving.status && position === moving.position) return;
    onMove(activeId, { status: destStatus, position });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto p-4">
        {KANBAN_STATUSES.map((s) => (
          <Column key={s} status={s} tasks={byStatus(s)} onOpen={onOpen} />
        ))}
      </div>
    </DndContext>
  );
}
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/tasks/_components/KanbanBoard.tsx"
git commit -m "feat(tasks): add Kanban board with dnd-kit"
```

---

### Task 10: New-task dialog + task detail drawer (fields)

**Files:**
- Create: `src/app/(authed)/tasks/_components/NewTaskDialog.tsx`
- Create: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`

**Interfaces:**
- Consumes: `TaskRow`, `TASK_PRIORITIES` from `@/lib/tasks/types`.
- Produces:
  - `NewTaskDialog({ open, isManager, assignees, onClose, onCreate })` — `onCreate(payload) => Promise<void>` where payload `{ title, description, priority, due_date, assignee_email? }`.
  - `TaskDetailDrawer({ task, isManager, canEdit, assignees, onClose, onPatch, onArchive })` — `onPatch(patch) => Promise<void>`; tabs Comments/Activity are placeholders filled in Phase 3.

- [ ] **Step 1: Create NewTaskDialog**

Create `src/app/(authed)/tasks/_components/NewTaskDialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { TASK_PRIORITIES, type TaskPriority } from "@/lib/tasks/types";
import type { TaskAssignee } from "@/lib/tasks/assignees";

export type NewTaskPayload = {
  title: string;
  description: string;
  priority: TaskPriority;
  due_date: string;
  assignee_email?: string;
};

export function NewTaskDialog({
  open,
  isManager,
  assignees,
  onClose,
  onCreate,
}: {
  open: boolean;
  isManager: boolean;
  assignees: TaskAssignee[];
  onClose: () => void;
  onCreate: (payload: NewTaskPayload) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [assignee, setAssignee] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  async function submit() {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        priority,
        due_date: dueDate,
        assignee_email: isManager && assignee ? assignee : undefined,
      });
      setTitle("");
      setDescription("");
      setPriority("medium");
      setDueDate("");
      setAssignee("");
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-[#0f2849]">New task</h2>
        <div className="mt-4 space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            rows={3}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="flex-1 rounded-lg border border-slate-200 px-2 py-2 text-sm"
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="flex-1 rounded-lg border border-slate-200 px-2 py-2 text-sm"
            />
          </div>
          {isManager && (
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
            >
              <option value="">Unassigned (Backlog)</option>
              {assignees.map((a) => (
                <option key={a.email} value={a.email}>{a.name ?? a.email}</option>
              ))}
            </select>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-500">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!title.trim() || saving}
            className="rounded-lg bg-[#0f2849] px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create TaskDetailDrawer**

Create `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`:

```tsx
"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { TASK_PRIORITIES, type TaskPriority, type TaskRow } from "@/lib/tasks/types";
import type { TaskAssignee } from "@/lib/tasks/assignees";

export function TaskDetailDrawer({
  task,
  isManager,
  canEdit,
  assignees,
  onClose,
  onPatch,
  onArchive,
}: {
  task: TaskRow;
  isManager: boolean;
  canEdit: boolean;
  assignees: TaskAssignee[];
  onClose: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onArchive: () => Promise<void>;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <span className="text-sm font-semibold text-[#0f2849]">Task</span>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <input
            value={title}
            disabled={!canEdit}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => canEdit && title.trim() && title !== task.title && onPatch({ title: title.trim() })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium disabled:bg-slate-50"
          />
          <textarea
            value={description}
            disabled={!canEdit}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => canEdit && description !== (task.description ?? "") && onPatch({ description })}
            rows={4}
            placeholder="Description"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
          />

          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="space-y-1">
              <span className="text-xs text-slate-500">Priority</span>
              <select
                value={task.priority}
                disabled={!canEdit}
                onChange={(e) => onPatch({ priority: e.target.value as TaskPriority })}
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 disabled:bg-slate-50"
              >
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-slate-500">Due date</span>
              <input
                type="date"
                defaultValue={task.due_date ?? ""}
                disabled={!canEdit}
                onChange={(e) => onPatch({ due_date: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 disabled:bg-slate-50"
              />
            </label>
          </div>

          {isManager && (
            <label className="block space-y-1 text-sm">
              <span className="text-xs text-slate-500">Assignee</span>
              <select
                value={task.assignee_email ?? ""}
                onChange={(e) =>
                  onPatch(
                    e.target.value
                      ? { assignee_email: e.target.value, status: task.status === "backlog" ? "todo" : task.status }
                      : { assignee_email: null, status: "backlog" }
                  )
                }
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5"
              >
                <option value="">Unassigned (Backlog)</option>
                {assignees.map((a) => (
                  <option key={a.email} value={a.email}>{a.name ?? a.email}</option>
                ))}
              </select>
            </label>
          )}

          {/* Comments / Activity / Attachments tabs are added in Phases 3-4. */}
          <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-400">
            Comments, activity and attachments arrive in later phases.
          </p>
        </div>

        {canEdit && (
          <footer className="border-t border-slate-100 p-3">
            <button
              type="button"
              onClick={onArchive}
              className="text-xs font-medium text-red-500 hover:underline"
            >
              Archive task
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add "src/app/(authed)/tasks/_components/NewTaskDialog.tsx" "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx"
git commit -m "feat(tasks): add new-task dialog and detail drawer"
```

---

### Task 11: Backlog list (manager) + assign action

**Files:**
- Create: `src/app/(authed)/tasks/_components/BacklogList.tsx`

**Interfaces:**
- Consumes: `TaskRow` from `@/lib/tasks/types`; `TaskAssignee`.
- Produces: `BacklogList({ tasks, assignees, onOpen, onAssign })` where `onAssign(taskId, email) => void` (sets assignee + moves to To Do).

- [ ] **Step 1: Implement the backlog list**

Create `src/app/(authed)/tasks/_components/BacklogList.tsx`:

```tsx
"use client";

import { PriorityDot, DueBadge } from "./board-ui";
import type { TaskRow } from "@/lib/tasks/types";
import type { TaskAssignee } from "@/lib/tasks/assignees";

export function BacklogList({
  tasks,
  assignees,
  onOpen,
  onAssign,
}: {
  tasks: TaskRow[];
  assignees: TaskAssignee[];
  onOpen: (id: string) => void;
  onAssign: (taskId: string, email: string) => void;
}) {
  const backlog = tasks
    .filter((t) => t.status === "backlog")
    .sort((a, b) => a.position - b.position);

  if (backlog.length === 0) {
    return <p className="p-6 text-sm text-slate-400">Backlog is empty.</p>;
  }

  return (
    <ul className="divide-y divide-slate-100 p-4">
      {backlog.map((task) => (
        <li key={task.id} className="flex items-center gap-3 py-2">
          <PriorityDot priority={task.priority} />
          <button
            type="button"
            onClick={() => onOpen(task.id)}
            className="flex-1 text-left text-sm text-slate-800 hover:underline"
          >
            {task.title}
          </button>
          <DueBadge due={task.due_date} />
          <select
            defaultValue=""
            onChange={(e) => e.target.value && onAssign(task.id, e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
          >
            <option value="">Assign…</option>
            {assignees.map((a) => (
              <option key={a.email} value={a.email}>{a.name ?? a.email}</option>
            ))}
          </select>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add "src/app/(authed)/tasks/_components/BacklogList.tsx"
git commit -m "feat(tasks): add backlog list with assign action"
```

---

### Task 12: Board client orchestrator + wire into the page

**Files:**
- Create: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`
- Modify: `src/app/(authed)/tasks/page.tsx`
- Delete: `src/app/(authed)/tasks/_components/TaskBoardPlaceholder.tsx`

**Interfaces:**
- Consumes: all components from Tasks 8–11; `TaskRow`, `TaskStatus`; `fetchTasksForActor`, `fetchTaskAssignees` (server, in page).
- Produces: `TaskBoardClient({ initialTasks, isManager, currentEmail, assignees })`.

- [ ] **Step 1: Implement the orchestrator**

Create `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { TaskRow, TaskStatus } from "@/lib/tasks/types";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { KanbanBoard } from "./KanbanBoard";
import { BacklogList } from "./BacklogList";
import { TaskCard } from "./TaskCard";
import { NewTaskDialog, type NewTaskPayload } from "./NewTaskDialog";
import { TaskDetailDrawer } from "./TaskDetailDrawer";

type Tab = "board" | "backlog";

export function TaskBoardClient({
  initialTasks,
  isManager,
  currentEmail,
  assignees,
}: {
  initialTasks: TaskRow[];
  isManager: boolean;
  currentEmail: string;
  assignees: TaskAssignee[];
}) {
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [tab, setTab] = useState<Tab>("board");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const openTask = tasks.find((t) => t.id === openId) ?? null;

  function replaceTask(updated: TaskRow) {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  async function patchTask(id: string, patch: Record<string, unknown>) {
    const prev = tasks;
    // optimistic
    setTasks((cur) => cur.map((t) => (t.id === id ? ({ ...t, ...patch } as TaskRow) : t)));
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setTasks(prev); // rollback
      return;
    }
    const data = await res.json();
    replaceTask(data.task as TaskRow);
  }

  function moveTask(id: string, change: { status: TaskStatus; position: number }) {
    void patchTask(id, change);
  }

  async function createTask(payload: NewTaskPayload) {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    const data = await res.json();
    setTasks((cur) => [...cur, data.task as TaskRow]);
  }

  async function archiveTask(id: string) {
    const prev = tasks;
    setTasks((cur) => cur.filter((t) => t.id !== id));
    setOpenId(null);
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    if (!res.ok) setTasks(prev);
  }

  const canEditOpen =
    openTask !== null && (isManager || openTask.assignee_email === currentEmail);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex gap-1">
          <TabButton active={tab === "board"} onClick={() => setTab("board")}>Board</TabButton>
          {isManager && (
            <TabButton active={tab === "backlog"} onClick={() => setTab("backlog")}>Backlog</TabButton>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 rounded-lg bg-[#0f2849] px-3 py-1.5 text-sm text-white"
        >
          <Plus className="h-4 w-4" /> New task
        </button>
      </div>

      {tab === "board" ? (
        <KanbanBoard tasks={tasks} onOpen={setOpenId} onMove={moveTask} />
      ) : (
        <BacklogList
          tasks={tasks}
          assignees={assignees}
          onOpen={setOpenId}
          onAssign={(id, email) =>
            patchTask(id, { assignee_email: email, status: "todo" })
          }
        />
      )}

      <NewTaskDialog
        open={creating}
        isManager={isManager}
        assignees={assignees}
        onClose={() => setCreating(false)}
        onCreate={createTask}
      />

      {openTask && (
        <TaskDetailDrawer
          task={openTask}
          isManager={isManager}
          canEdit={canEditOpen}
          assignees={assignees}
          onClose={() => setOpenId(null)}
          onPatch={(patch) => patchTask(openTask.id, patch)}
          onArchive={() => archiveTask(openTask.id)}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
        active ? "bg-slate-100 text-[#0f2849]" : "text-slate-500"
      }`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Wire the server page**

Replace the contents of `src/app/(authed)/tasks/page.tsx`:

```tsx
import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { buildTaskActor, canAssign } from "@/lib/tasks/access";
import { fetchTasksForActor } from "@/lib/tasks/queries";
import { fetchTaskAssignees } from "@/lib/tasks/assignees";
import { TaskBoardClient } from "./_components/TaskBoardClient";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const session = await requireAnyPermission([
    PERMISSIONS.TASK_MANAGE,
    PERMISSIONS.TASK_WORK,
  ]);
  const email = session.user.email ?? "";
  const actor = buildTaskActor(session.user.permissions, email);

  const tasks = await fetchTasksForActor(actor);
  const assignees = canAssign(actor) ? await fetchTaskAssignees() : [];

  return (
    <TaskBoardClient
      initialTasks={tasks}
      isManager={actor.isManager}
      currentEmail={email}
      assignees={assignees}
    />
  );
}
```

- [ ] **Step 3: Delete the placeholder**

Run:
```bash
git rm "src/app/(authed)/tasks/_components/TaskBoardPlaceholder.tsx"
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit` (Expected: No errors).
Run: `npx next build` (Expected: build succeeds).

- [ ] **Step 5: Manual end-to-end verification**

1. As Manager: create a task with no assignee → appears in **Backlog** tab. Assign it → moves to **To Do** on the Board. Drag it across columns; drag to Waiting; open the drawer, change priority/due/assignee, archive it.
2. As CS: create a task → appears in **To Do** assigned to you (no Backlog tab visible). You see only your own cards. Drag your card; you cannot reassign (no assignee selector). Open a task not assigned to you via direct URL/API → 403.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(authed)/tasks"
git commit -m "feat(tasks): wire core task board (Kanban + backlog) into /tasks"
```

---

## Self-Review

**Spec coverage (Phase 2 portion):**
- tasks API list/create/patch/delete with per-change authorization + scope → Tasks 5, 6. ✓
- assignees API (manager only; task.work or task.manage) → Tasks 4, 7. ✓
- Kanban (todo/in_progress/waiting/done) + dnd + optimistic + refetch → Tasks 9, 12. ✓
- Backlog (manager) + Assign → Task 11, 12. ✓
- TaskCard (priority color, assignee, due badge, waiting tag) → Task 8. ✓
- NewTask + Drawer (fields editable per permission) → Task 10. ✓
- CS forced self-assign / no backlog / own-only scope → `resolveCreateAssignment` + `fetchTasksForActor` + `canMutateTask` (verified Task 12 Step 5). ✓
- Invariants (backlog↔assignee, waiting_reason, leaving backlog needs assignee) → `resolveTaskPatch` (Task 3). ✓

**Placeholder scan:** No TBD/TODO; the drawer's "later phases" note is an intentional, labeled stub replaced in Phases 3–4 — not a code placeholder. ✓

**Type consistency:** `onMove(taskId, { status, position })` defined in Task 9 and called identically in Task 12. `TaskAssignee` from `assignees.ts` used uniformly. `resolveTaskPatch`/`resolveCreateAssignment` signatures match their Phase 1/Task 3 definitions. `midpoint(before, after)` consistent across Tasks 2, 5, 9. ✓

**Deferred (not gaps):** comments/replies, @mention, notifications, activity log writes + Activity tab, attachments, category selector/manager — Phases 3–4.
