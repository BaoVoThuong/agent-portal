# Task Board Phase 3 — Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comments with one-level replies and @mentions, an activity log, and in-app notifications (with a TopBar bell) layered onto the existing task board.

**Architecture:** Pure helpers (`activity.ts`, `notifications.ts`) compute what to log and whom to notify; they are unit-tested. Comment/activity/notification route handlers reuse the Phase 1 access helpers. The create/patch task routes from Phase 2 are extended to write activity rows and assignment notifications. The detail drawer gains Comments and Activity tabs; the TopBar gains a polling notification bell.

**Tech Stack:** Next.js 16, TypeScript, Supabase service role, Tailwind, lucide-react, vitest.

**Depends on:** Phases 1–2 (tables, access helpers, task routes, drawer, board client).

## Global Constraints

- Identity by **email**; authorization server-side via Phase 1 access helpers (`canViewTask`, `canMutateTask`).
- Notifications fire ONLY on: assigned-to-me, @mentioned, and new comment on a task I'm the assignee of. Status changes do NOT notify.
- Comment replies are limited to ONE level (a reply's parent must be a top-level comment).
- A comment may be edited/deleted by its **author only**.
- Mentionable users = board members (accounts with `task.work` or `task.manage`), exposed to any board user via `GET /api/tasks/members`.
- Brand `#0f2849`; lucide-react; vitest with `@/` alias.

---

### Task 1: Activity entry builder (pure)

**Files:**
- Create: `src/lib/tasks/activity.ts`
- Test: `src/lib/tasks/activity.test.ts`

**Interfaces:**
- Produces:
  - `type ActivityEntry = { type: string; meta: Record<string, unknown> | null }`
  - `buildActivityEntries(before: { status: string; assignee_email: string | null }, patch: Record<string, unknown>): ActivityEntry[]`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/tasks/activity.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildActivityEntries } from "@/lib/tasks/activity";

const before = { status: "todo", assignee_email: "cs@x.com" };

describe("buildActivityEntries", () => {
  it("logs a status change", () => {
    expect(buildActivityEntries(before, { status: "in_progress" })).toEqual([
      { type: "status_changed", meta: { from: "todo", to: "in_progress" } },
    ]);
  });
  it("logs reopened when leaving done", () => {
    expect(
      buildActivityEntries({ status: "done", assignee_email: "cs@x.com" }, { status: "in_progress" })
    ).toEqual([{ type: "reopened", meta: { from: "done", to: "in_progress" } }]);
  });
  it("logs assignment", () => {
    expect(buildActivityEntries(before, { assignee_email: "other@x.com" })).toEqual([
      { type: "assigned", meta: { to: "other@x.com" } },
    ]);
  });
  it("logs priority, due, category, and edits", () => {
    expect(buildActivityEntries(before, { priority: "high" })).toEqual([
      { type: "priority_changed", meta: { to: "high" } },
    ]);
    expect(buildActivityEntries(before, { due_date: "2026-07-01" })).toEqual([
      { type: "due_changed", meta: { to: "2026-07-01" } },
    ]);
    expect(buildActivityEntries(before, { category_id: "c1" })).toEqual([
      { type: "category_changed", meta: { to: "c1" } },
    ]);
    expect(buildActivityEntries(before, { title: "x" })).toEqual([
      { type: "edited", meta: null },
    ]);
  });
  it("ignores position-only reorders", () => {
    expect(buildActivityEntries(before, { position: 5 })).toEqual([]);
  });
  it("collapses title+description into a single edited entry", () => {
    expect(buildActivityEntries(before, { title: "x", description: "y" })).toEqual([
      { type: "edited", meta: null },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/tasks/activity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/tasks/activity.ts`:

```typescript
// Computes activity-log entries from a before-state + a resolved patch.
// Pure + tested. The API route inserts the returned rows into task_activity.
export type ActivityEntry = { type: string; meta: Record<string, unknown> | null };

export function buildActivityEntries(
  before: { status: string; assignee_email: string | null },
  patch: Record<string, unknown>
): ActivityEntry[] {
  const entries: ActivityEntry[] = [];

  if (typeof patch.status === "string" && patch.status !== before.status) {
    const type = before.status === "done" ? "reopened" : "status_changed";
    entries.push({ type, meta: { from: before.status, to: patch.status } });
  }
  if ("assignee_email" in patch && patch.assignee_email !== before.assignee_email) {
    entries.push({ type: "assigned", meta: { to: patch.assignee_email ?? null } });
  }
  if (typeof patch.priority === "string") {
    entries.push({ type: "priority_changed", meta: { to: patch.priority } });
  }
  if ("due_date" in patch) {
    entries.push({ type: "due_changed", meta: { to: patch.due_date ?? null } });
  }
  if ("category_id" in patch) {
    entries.push({ type: "category_changed", meta: { to: patch.category_id ?? null } });
  }
  if ("title" in patch || "description" in patch) {
    entries.push({ type: "edited", meta: null });
  }
  return entries;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/tasks/activity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/activity.ts src/lib/tasks/activity.test.ts
git commit -m "feat(tasks): add activity entry builder"
```

---

### Task 2: Comment notification resolver (pure) + DB helpers

**Files:**
- Create: `src/lib/tasks/notifications.ts`
- Test: `src/lib/tasks/notifications.test.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin` from `@/lib/supabase`.
- Produces:
  - `type CommentNotification = { email: string; type: "mentioned" | "commented" }`
  - `resolveCommentRecipients(task: { assignee_email: string | null }, authorEmail: string, mentions: string[]): CommentNotification[]`
  - `insertNotifications(rows: { recipient_email: string; task_id: string; type: string; actor_email: string; comment_id?: string | null }[]): Promise<void>`

- [ ] **Step 1: Write the failing tests (pure part)**

Create `src/lib/tasks/notifications.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveCommentRecipients } from "@/lib/tasks/notifications";

describe("resolveCommentRecipients", () => {
  it("notifies mentioned users (excluding author)", () => {
    const r = resolveCommentRecipients(
      { assignee_email: "cs@x.com" },
      "author@x.com",
      ["a@x.com", "author@x.com"]
    );
    expect(r).toContainEqual({ email: "a@x.com", type: "mentioned" });
    expect(r.find((n) => n.email === "author@x.com")).toBeUndefined();
  });
  it("notifies the assignee with 'commented' when not the author", () => {
    const r = resolveCommentRecipients({ assignee_email: "cs@x.com" }, "mgr@x.com", []);
    expect(r).toEqual([{ email: "cs@x.com", type: "commented" }]);
  });
  it("does not double-notify: mention wins over commented for the same person", () => {
    const r = resolveCommentRecipients({ assignee_email: "cs@x.com" }, "mgr@x.com", ["cs@x.com"]);
    expect(r).toEqual([{ email: "cs@x.com", type: "mentioned" }]);
  });
  it("no assignee, no mentions -> no notifications", () => {
    expect(resolveCommentRecipients({ assignee_email: null }, "a@x.com", [])).toEqual([]);
  });
  it("author is the assignee -> no 'commented' self-notify", () => {
    expect(resolveCommentRecipients({ assignee_email: "a@x.com" }, "a@x.com", [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/tasks/notifications.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/tasks/notifications.ts`:

```typescript
import { getSupabaseAdmin } from "@/lib/supabase";

export type CommentNotification = { email: string; type: "mentioned" | "commented" };

// Who to notify for a new comment: mentioned users (minus the author), plus the
// task's assignee as 'commented' (unless they are the author or already mentioned).
export function resolveCommentRecipients(
  task: { assignee_email: string | null },
  authorEmail: string,
  mentions: string[]
): CommentNotification[] {
  const mentionSet = new Set(
    mentions.map((m) => m.trim()).filter((m) => m && m !== authorEmail)
  );
  const out: CommentNotification[] = [...mentionSet].map((email) => ({
    email,
    type: "mentioned",
  }));
  const assignee = task.assignee_email;
  if (assignee && assignee !== authorEmail && !mentionSet.has(assignee)) {
    out.push({ email: assignee, type: "commented" });
  }
  return out;
}

export async function insertNotifications(
  rows: {
    recipient_email: string;
    task_id: string;
    type: string;
    actor_email: string;
    comment_id?: string | null;
  }[]
): Promise<void> {
  if (rows.length === 0) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("task_notifications").insert(
    rows.map((r) => ({
      recipient_email: r.recipient_email,
      task_id: r.task_id,
      type: r.type,
      actor_email: r.actor_email,
      comment_id: r.comment_id ?? null,
    }))
  );
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/tasks/notifications.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/notifications.ts src/lib/tasks/notifications.test.ts
git commit -m "feat(tasks): add comment-notification resolver + insert helper"
```

---

### Task 3: Wire activity + assignment notifications into task routes

**Files:**
- Modify: `src/app/api/tasks/route.ts` (POST → log "created")
- Modify: `src/app/api/tasks/[id]/route.ts` (PATCH → log activity + notify on assign; DELETE → log "archived")

**Interfaces:**
- Consumes: `buildActivityEntries`, `insertNotifications`.

- [ ] **Step 1: Log "created" in POST /api/tasks**

In `src/app/api/tasks/route.ts`, after the successful insert (right before the final `return NextResponse.json({ task: data })`), add:

```typescript
  await supabase.from("task_activity").insert({
    task_id: (data as { id: string }).id,
    actor_email: email,
    type: "created",
    meta: assignment.assignee_email ? { to: assignment.assignee_email } : null,
  });
```

- [ ] **Step 2: Log activity + notify on assign in PATCH /api/tasks/[id]**

In `src/app/api/tasks/[id]/route.ts`, add imports at the top:

```typescript
import { buildActivityEntries } from "@/lib/tasks/activity";
import { insertNotifications } from "@/lib/tasks/notifications";
```

In `PATCH`, after the successful update (right before `return NextResponse.json({ task: data })`), add:

```typescript
  const entries = buildActivityEntries(
    { status: r.task.status, assignee_email: r.task.assignee_email },
    resolved.patch
  );
  if (entries.length > 0) {
    await r.supabase.from("task_activity").insert(
      entries.map((e) => ({
        task_id: id,
        actor_email: r.actor.email,
        type: e.type,
        meta: e.meta,
      }))
    );
  }

  // Notify a newly assigned person (not when assigning to self).
  const newAssignee = resolved.patch.assignee_email as string | null | undefined;
  if (
    newAssignee &&
    newAssignee !== r.task.assignee_email &&
    newAssignee !== r.actor.email
  ) {
    await insertNotifications([
      { recipient_email: newAssignee, task_id: id, type: "assigned", actor_email: r.actor.email },
    ]);
  }
```

- [ ] **Step 3: Log "archived" in DELETE**

In `DELETE`, after the successful update and before `return NextResponse.json({ ok: true })`, add:

```typescript
  await r.supabase.from("task_activity").insert({
    task_id: id,
    actor_email: r.actor.email,
    type: "archived",
    meta: null,
  });
```

- [ ] **Step 4: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add "src/app/api/tasks/route.ts" "src/app/api/tasks/[id]/route.ts"
git commit -m "feat(tasks): log activity and notify on assignment"
```

---

### Task 4: Members endpoint (mentionable users)

**Files:**
- Create: `src/app/api/tasks/members/route.ts`

**Interfaces:**
- Consumes: `auth`, `buildTaskActor`, `canAccessBoard`, `fetchTaskAssignees`.
- Produces: `GET` → `{ members: { email, name }[] }` (any board user).

- [ ] **Step 1: Implement**

Create `src/app/api/tasks/members/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildTaskActor, canAccessBoard } from "@/lib/tasks/access";
import { fetchTaskAssignees } from "@/lib/tasks/assignees";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email);
  if (!canAccessBoard(actor))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const members = await fetchTaskAssignees();
  return NextResponse.json({ members });
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add src/app/api/tasks/members/route.ts
git commit -m "feat(tasks): add GET /api/tasks/members for mentions"
```

---

### Task 5: Comments API — list / create (with mentions)

**Files:**
- Create: `src/app/api/tasks/[id]/comments/route.ts`

**Interfaces:**
- Consumes: `auth`, `buildTaskActor`, `canViewTask`, `getSupabaseAdmin`, `fetchTaskAssignees`, `resolveCommentRecipients`, `insertNotifications`.
- Produces:
  - `GET` → `{ comments: CommentRow[] }` ordered oldest-first (`id, task_id, parent_id, author_email, body, created_at, updated_at, deleted_at`).
  - `POST` body `{ body: string, parentId?: string, mentions?: string[] }` → `{ comment }`.

- [ ] **Step 1: Implement**

Create `src/app/api/tasks/[id]/comments/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canViewTask } from "@/lib/tasks/access";
import { fetchTaskAssignees } from "@/lib/tasks/assignees";
import { resolveCommentRecipients, insertNotifications } from "@/lib/tasks/notifications";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const COMMENT_COLUMNS =
  "id,task_id,parent_id,author_email,body,created_at,updated_at,deleted_at";

async function loadActorAndTask(id: string) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };
  const actor = buildTaskActor(session.user.permissions, email);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tasks")
    .select("id,status,assignee_email")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found", status: 404 };
  return { actor, task: data as unknown as Pick<TaskRow, "id" | "status" | "assignee_email">, supabase };
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!canViewTask(r.actor, r.task))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data, error } = await r.supabase
    .from("task_comments")
    .select(COMMENT_COLUMNS)
    .eq("task_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comments: data ?? [] });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!canViewTask(r.actor, r.task))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "Comment is empty." }, { status: 400 });

  // Validate parent: must be a top-level comment on THIS task (one-level threading).
  let parentId: string | null = null;
  if (typeof body?.parentId === "string" && body.parentId) {
    const { data: parent } = await r.supabase
      .from("task_comments")
      .select("id,task_id,parent_id")
      .eq("id", body.parentId)
      .maybeSingle();
    const p = parent as { task_id: string; parent_id: string | null } | null;
    if (!p || p.task_id !== id || p.parent_id !== null)
      return NextResponse.json({ error: "Invalid parent comment." }, { status: 400 });
    parentId = body.parentId;
  }

  const { data: comment, error } = await r.supabase
    .from("task_comments")
    .insert({ task_id: id, parent_id: parentId, author_email: r.actor.email, body: text })
    .select(COMMENT_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Log activity.
  await r.supabase.from("task_activity").insert({
    task_id: id,
    actor_email: r.actor.email,
    type: "comment_added",
    meta: null,
  });

  // Validate mentions against board members, then notify.
  const rawMentions = Array.isArray(body?.mentions)
    ? (body.mentions as unknown[]).filter((m): m is string => typeof m === "string")
    : [];
  const memberEmails = new Set((await fetchTaskAssignees()).map((m) => m.email));
  const validMentions = rawMentions.filter((m) => memberEmails.has(m));
  const recipients = resolveCommentRecipients(r.task, r.actor.email, validMentions);
  await insertNotifications(
    recipients.map((rec) => ({
      recipient_email: rec.email,
      task_id: id,
      type: rec.type,
      actor_email: r.actor.email,
      comment_id: (comment as { id: string }).id,
    }))
  );

  return NextResponse.json({ comment });
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add "src/app/api/tasks/[id]/comments/route.ts"
git commit -m "feat(tasks): add task comments list/create with mentions"
```

---

### Task 6: Comment edit / delete (author only)

**Files:**
- Create: `src/app/api/tasks/[id]/comments/[cid]/route.ts`

**Interfaces:**
- Produces: `PATCH` body `{ body }` → `{ comment }`; `DELETE` → `{ ok: true }` (soft delete). Author only.

- [ ] **Step 1: Implement**

Create `src/app/api/tasks/[id]/comments/[cid]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; cid: string }> };
const COMMENT_COLUMNS =
  "id,task_id,parent_id,author_email,body,created_at,updated_at,deleted_at";

async function loadAuthorContext(cid: string) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("task_comments")
    .select("id,author_email")
    .eq("id", cid)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found", status: 404 };
  const comment = data as { id: string; author_email: string };
  if (comment.author_email !== email)
    return { error: "Forbidden", status: 403 };
  return { supabase, email };
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { cid } = await params;
  const ctx = await loadAuthorContext(cid);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const body = await req.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "Comment is empty." }, { status: 400 });

  const { data, error } = await ctx.supabase
    .from("task_comments")
    .update({ body: text, updated_at: new Date().toISOString() })
    .eq("id", cid)
    .select(COMMENT_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comment: data });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { cid } = await params;
  const ctx = await loadAuthorContext(cid);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const { error } = await ctx.supabase
    .from("task_comments")
    .update({ deleted_at: new Date().toISOString(), body: "" })
    .eq("id", cid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add "src/app/api/tasks/[id]/comments/[cid]/route.ts"
git commit -m "feat(tasks): add comment edit/delete (author only)"
```

---

### Task 7: Activity list endpoint

**Files:**
- Create: `src/app/api/tasks/[id]/activity/route.ts`

**Interfaces:**
- Produces: `GET` → `{ activity: { id, actor_email, type, meta, created_at }[] }`, newest-first, viewable only if `canViewTask`.

- [ ] **Step 1: Implement**

Create `src/app/api/tasks/[id]/activity/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canViewTask } from "@/lib/tasks/access";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email);

  const supabase = getSupabaseAdmin();
  const { data: task } = await supabase
    .from("tasks")
    .select("id,assignee_email")
    .eq("id", id)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canViewTask(actor, task as Pick<TaskRow, "assignee_email">))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data, error } = await supabase
    .from("task_activity")
    .select("id,actor_email,type,meta,created_at")
    .eq("task_id", id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ activity: data ?? [] });
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add "src/app/api/tasks/[id]/activity/route.ts"
git commit -m "feat(tasks): add task activity list endpoint"
```

---

### Task 8: Notifications API — list + mark read

**Files:**
- Create: `src/app/api/tasks/notifications/route.ts`
- Create: `src/app/api/tasks/notifications/read/route.ts`

**Interfaces:**
- Produces:
  - `GET /api/tasks/notifications` → `{ notifications: Row[]; unread: number }` (recipient = current email; newest-first, capped at 30).
  - `POST /api/tasks/notifications/read` body `{ ids?: string[] }` → `{ ok: true }` (no ids = mark all read).

- [ ] **Step 1: Implement the list endpoint**

Create `src/app/api/tasks/notifications/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("task_notifications")
    .select("id,task_id,type,actor_email,comment_id,is_read,created_at")
    .eq("recipient_email", email)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const notifications = data ?? [];
  const unread = notifications.filter((n) => !(n as { is_read: boolean }).is_read).length;
  return NextResponse.json({ notifications, unread });
}
```

- [ ] **Step 2: Implement the mark-read endpoint**

Create `src/app/api/tasks/notifications/read/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.ids)
    ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string")
    : null;

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("task_notifications")
    .update({ is_read: true })
    .eq("recipient_email", email);
  if (ids && ids.length > 0) query = query.in("id", ids);

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add src/app/api/tasks/notifications
git commit -m "feat(tasks): add notifications list + mark-read endpoints"
```

---

### Task 9: Comment thread UI (replies + mention picker)

**Files:**
- Create: `src/app/(authed)/tasks/_components/CommentThread.tsx`

**Interfaces:**
- Consumes: `TaskAssignee` from `@/lib/tasks/assignees`.
- Produces: `CommentThread({ taskId, currentEmail })` — self-contained: fetches comments + members, posts comments/replies with mentions, edits/deletes own.

- [ ] **Step 1: Implement**

Create `src/app/(authed)/tasks/_components/CommentThread.tsx`:

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { AtSign, Reply } from "lucide-react";
import type { TaskAssignee } from "@/lib/tasks/assignees";

type Comment = {
  id: string;
  parent_id: string | null;
  author_email: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
};

export function CommentThread({
  taskId,
  currentEmail,
}: {
  taskId: string;
  currentEmail: string;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [members, setMembers] = useState<TaskAssignee[]>([]);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/tasks/${taskId}/comments`);
    if (res.ok) setComments((await res.json()).comments as Comment[]);
  }, [taskId]);

  useEffect(() => {
    void load();
    void fetch("/api/tasks/members")
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => setMembers(d.members as TaskAssignee[]));
  }, [load]);

  async function post(body: string, mentions: string[], parentId: string | null) {
    const res = await fetch(`/api/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, mentions, parentId }),
    });
    if (res.ok) {
      setReplyTo(null);
      await load();
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/tasks/${taskId}/comments/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  const topLevel = comments.filter((c) => c.parent_id === null);
  const repliesOf = (id: string) => comments.filter((c) => c.parent_id === id);

  return (
    <div className="space-y-3">
      {topLevel.map((c) => (
        <div key={c.id} className="space-y-2">
          <CommentItem c={c} currentEmail={currentEmail} onDelete={remove} onReply={() => setReplyTo(c.id)} />
          <div className="ml-6 space-y-2 border-l border-slate-100 pl-3">
            {repliesOf(c.id).map((rc) => (
              <CommentItem key={rc.id} c={rc} currentEmail={currentEmail} onDelete={remove} />
            ))}
            {replyTo === c.id && (
              <Composer members={members} onSubmit={(b, m) => post(b, m, c.id)} placeholder="Reply…" />
            )}
          </div>
        </div>
      ))}
      <Composer members={members} onSubmit={(b, m) => post(b, m, null)} placeholder="Write a comment…" />
    </div>
  );
}

function CommentItem({
  c,
  currentEmail,
  onDelete,
  onReply,
}: {
  c: Comment;
  currentEmail: string;
  onDelete: (id: string) => void;
  onReply?: () => void;
}) {
  if (c.deleted_at) {
    return <p className="text-xs italic text-slate-300">comment deleted</p>;
  }
  return (
    <div className="rounded-lg bg-slate-50 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600">{c.author_email}</span>
        <div className="flex items-center gap-2">
          {onReply && (
            <button type="button" onClick={onReply} className="text-slate-400 hover:text-slate-600" aria-label="Reply">
              <Reply className="h-3.5 w-3.5" />
            </button>
          )}
          {c.author_email === currentEmail && (
            <button type="button" onClick={() => onDelete(c.id)} className="text-xs text-red-400 hover:underline">
              delete
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{c.body}</p>
    </div>
  );
}

function Composer({
  members,
  onSubmit,
  placeholder,
}: {
  members: TaskAssignee[];
  onSubmit: (body: string, mentions: string[]) => void;
  placeholder: string;
}) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  function addMention(m: TaskAssignee) {
    if (!mentions.includes(m.email)) {
      setMentions((cur) => [...cur, m.email]);
      setText((t) => `${t}@${m.name ?? m.email} `);
    }
    setPickerOpen(false);
  }

  function submit() {
    if (!text.trim()) return;
    onSubmit(text.trim(), mentions);
    setText("");
    setMentions([]);
  }

  return (
    <div className="rounded-lg border border-slate-200 p-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full resize-none bg-transparent text-sm focus:outline-none"
      />
      {mentions.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {mentions.map((m) => (
            <span key={m} className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-600">@{m}</span>
          ))}
        </div>
      )}
      <div className="relative flex items-center justify-between">
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
        >
          <AtSign className="h-3.5 w-3.5" /> Mention
        </button>
        {pickerOpen && (
          <div className="absolute bottom-7 left-0 z-10 max-h-40 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {members.map((m) => (
              <button
                key={m.email}
                type="button"
                onClick={() => addMention(m)}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
              >
                {m.name ?? m.email}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="rounded-lg bg-[#0f2849] px-3 py-1 text-xs text-white disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add "src/app/(authed)/tasks/_components/CommentThread.tsx"
git commit -m "feat(tasks): add comment thread with replies and mentions"
```

---

### Task 10: Activity feed UI + tabs in the drawer

**Files:**
- Create: `src/app/(authed)/tasks/_components/ActivityFeed.tsx`
- Modify: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`

**Interfaces:**
- Produces: `ActivityFeed({ taskId })`; drawer gains "Comments" / "Activity" tabs replacing the Phase 2 placeholder note.

- [ ] **Step 1: Create the ActivityFeed**

Create `src/app/(authed)/tasks/_components/ActivityFeed.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

type Activity = {
  id: string;
  actor_email: string;
  type: string;
  meta: Record<string, unknown> | null;
  created_at: string;
};

function describe(a: Activity): string {
  const to = a.meta && "to" in a.meta ? String((a.meta as { to: unknown }).to ?? "—") : "";
  switch (a.type) {
    case "created": return "created the task";
    case "status_changed": return `moved to ${to}`;
    case "reopened": return `reopened (${to})`;
    case "assigned": return `assigned to ${to}`;
    case "priority_changed": return `set priority ${to}`;
    case "due_changed": return `set due date ${to}`;
    case "category_changed": return "changed category";
    case "comment_added": return "commented";
    case "edited": return "edited the task";
    case "archived": return "archived the task";
    default: return a.type;
  }
}

export function ActivityFeed({ taskId }: { taskId: string }) {
  const [items, setItems] = useState<Activity[]>([]);

  useEffect(() => {
    void fetch(`/api/tasks/${taskId}/activity`)
      .then((r) => (r.ok ? r.json() : { activity: [] }))
      .then((d) => setItems(d.activity as Activity[]));
  }, [taskId]);

  if (items.length === 0) return <p className="text-xs text-slate-400">No activity yet.</p>;

  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li key={a.id} className="text-xs text-slate-500">
          <span className="font-medium text-slate-600">{a.actor_email}</span> {describe(a)}
          <span className="ml-1 text-slate-300">{new Date(a.created_at).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Add tabs to the drawer**

In `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`:

Add imports near the top:
```tsx
import { CommentThread } from "./CommentThread";
import { ActivityFeed } from "./ActivityFeed";
```

Add a `currentEmail` prop. Change the component signature to include it:
```tsx
export function TaskDetailDrawer({
  task,
  isManager,
  canEdit,
  assignees,
  currentEmail,
  onClose,
  onPatch,
  onArchive,
}: {
  task: TaskRow;
  isManager: boolean;
  canEdit: boolean;
  assignees: TaskAssignee[];
  currentEmail: string;
  onClose: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onArchive: () => Promise<void>;
}) {
```

Add a tab state at the top of the component body (after the existing `useState` calls):
```tsx
  const [tab, setTab] = useState<"details" | "comments" | "activity">("details");
```

Replace the placeholder paragraph (`<p className="rounded-lg bg-slate-50 ...">...later phases.</p>`) with:
```tsx
          <div className="border-t border-slate-100 pt-3">
            <div className="mb-3 flex gap-1">
              {(["details", "comments", "activity"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize ${
                    tab === t ? "bg-slate-100 text-[#0f2849]" : "text-slate-400"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            {tab === "comments" && <CommentThread taskId={task.id} currentEmail={currentEmail} />}
            {tab === "activity" && <ActivityFeed taskId={task.id} />}
            {tab === "details" && (
              <p className="text-xs text-slate-400">Use the fields above to edit task details.</p>
            )}
          </div>
```

- [ ] **Step 3: Pass `currentEmail` from the board client**

In `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`, update the `<TaskDetailDrawer ... />` usage to pass the prop:
```tsx
        <TaskDetailDrawer
          task={openTask}
          isManager={isManager}
          canEdit={canEditOpen}
          assignees={assignees}
          currentEmail={currentEmail}
          onClose={() => setOpenId(null)}
          onPatch={(patch) => patchTask(openTask.id, patch)}
          onArchive={() => archiveTask(openTask.id)}
        />
```

- [ ] **Step 4: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add "src/app/(authed)/tasks/_components/ActivityFeed.tsx" "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx" "src/app/(authed)/tasks/_components/TaskBoardClient.tsx"
git commit -m "feat(tasks): add comments/activity tabs to task drawer"
```

---

### Task 11: TopBar notification bell

**Files:**
- Create: `src/app/(authed)/_components/NotificationBell.tsx`
- Modify: `src/app/(authed)/_components/TopBar.tsx`
- Modify: `src/app/(authed)/layout.tsx`

**Interfaces:**
- Consumes: `/api/tasks/notifications`, `/api/tasks/notifications/read`.
- Produces: `NotificationBell()` client component; rendered in `TopBar` when `canUseTasks` is true.

- [ ] **Step 1: Create the bell**

Create `src/app/(authed)/_components/NotificationBell.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

type Notif = {
  id: string;
  task_id: string;
  type: "assigned" | "mentioned" | "commented";
  actor_email: string;
  is_read: boolean;
  created_at: string;
};

const LABEL: Record<Notif["type"], string> = {
  assigned: "assigned you a task",
  mentioned: "mentioned you",
  commented: "commented on your task",
};

const POLL_MS = 60000;

export function NotificationBell() {
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/tasks/notifications");
    if (!res.ok) return;
    const data = await res.json();
    setItems(data.notifications as Notif[]);
    setUnread(data.unread as number);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function openAndMarkRead() {
    setOpen((o) => !o);
    if (!open && unread > 0) {
      await fetch("/api/tasks/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setUnread(0);
      setItems((cur) => cur.map((n) => ({ ...n, is_read: true })));
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={openAndMarkRead}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-500">
            Notifications
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-slate-400">Nothing yet.</p>
            ) : (
              items.map((n) => (
                <Link
                  key={n.id}
                  href="/tasks"
                  onClick={() => setOpen(false)}
                  className={`block px-3 py-2 text-xs hover:bg-slate-50 ${n.is_read ? "text-slate-500" : "text-slate-800"}`}
                >
                  <span className="font-medium">{n.actor_email}</span> {LABEL[n.type]}
                  <span className="ml-1 text-slate-300">{new Date(n.created_at).toLocaleDateString()}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render the bell in TopBar**

In `src/app/(authed)/_components/TopBar.tsx`:

Add the import:
```tsx
import { NotificationBell } from "./NotificationBell";
```

Add `canUseTasks` to the props type and signature:
```tsx
type TopBarProps = {
  userName: string | null;
  userEmail: string;
  agentId: string | null;
  canUseTasks: boolean;
};

export default function TopBar({ userName, userEmail, agentId, canUseTasks }: TopBarProps) {
```

Render the bell just before the `menuWrap` div (inside the `<header>`, after the `userInfo` block):
```tsx
      {canUseTasks && (
        <div className="ml-auto mr-2">
          <NotificationBell />
        </div>
      )}
```

(If `styles.topbar` already uses `justify-between`, drop the `ml-auto`; keep `mr-2` for spacing.)

- [ ] **Step 3: Pass `canUseTasks` from the layout**

In `src/app/(authed)/layout.tsx`:

Add the import:
```tsx
import { canAny } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
```

Update the `<TopBar ... />` usage:
```tsx
        <TopBar
          userName={session.user.name ?? null}
          userEmail={session.user.email}
          agentId={session.user.agentId ?? null}
          canUseTasks={canAny(session.user.permissions, [
            PERMISSIONS.TASK_MANAGE,
            PERMISSIONS.TASK_WORK,
          ])}
        />
```

- [ ] **Step 4: Verify build + manual test**

Run: `npx tsc --noEmit` (Expected: No errors).
Run: `npx next build` (Expected: build succeeds).

Manual:
1. As Manager, assign a backlog task to CS → as CS, the bell shows a red "1" and lists "…assigned you a task". Opening the dropdown clears the badge.
2. As Manager, comment on a task assigned to CS and @mention CS → CS gets a `mentioned` (or `commented`) notification.
3. CS replies to a comment (one level); CS edits/deletes own comment; the Activity tab shows created/assigned/status/comment events.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authed)/_components/NotificationBell.tsx" "src/app/(authed)/_components/TopBar.tsx" "src/app/(authed)/layout.tsx"
git commit -m "feat(tasks): add notification bell to the top bar"
```

---

## Self-Review

**Spec coverage (Phase 3 portion):**
- Comments + one-level replies → Tasks 5, 6, 9 (parent validated top-level only). ✓
- @mention picker + validated mentions → Tasks 4, 5, 9. ✓
- Notifications on assigned / mentioned / commented(on my task), not on status change → Tasks 2, 3, 5, 8. ✓
- Activity log writes (created/assigned/status/edited/comment/archived) + Activity tab → Tasks 1, 3, 5, 7, 10. ✓
- TopBar notification bell with unread badge + mark-read + poll → Task 11. ✓
- Author-only comment edit/delete → Task 6. ✓

**Placeholder scan:** No TBD/TODO; every step has full code. The Phase 2 drawer placeholder note is explicitly replaced in Task 10. ✓

**Type consistency:** `resolveCommentRecipients(task, author, mentions)` defined Task 2, called Task 5 with the same shape. `insertNotifications` row shape consistent Tasks 2/3/5. `buildActivityEntries(before, patch)` defined Task 1, called Task 3 with `{status, assignee_email}` before-state. Drawer `currentEmail` prop added in Task 10 and supplied in Task 10 Step 3. ✓

**Deferred (not gaps):** attachments + category selector/manager — Phase 4.
