# Task Detail: Batched Loading + Tabbed Drawer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a task in one batched request — drawer fetches a single `/detail` endpoint, shows Comments instantly, with Activity/Attachments behind instant tabs and a per-task cache — instead of three slow per-section fetches.

**Architecture:** A shared read library (`lib/tasks/detail.ts`) gathers comments (+ their attachments), activity, and task-level attachments in parallel; a new `GET /api/tasks/[id]/detail` authorizes once and returns all three. The drawer fetches it once, caches it (stale-while-revalidate), passes data into now-controlled child components, and presents Comments/Activity/Attachments as tabs.

**Tech Stack:** Next.js App Router (`force-dynamic` routes), Supabase (`getSupabaseAdmin`, PostgREST), NextAuth, Vitest, ESLint, TypeScript.

## Global Constraints

- Work on a new branch off `main`: `feat/task-detail-batch`.
- Supabase only via `getSupabaseAdmin()`; identity by email.
- Reuse the existing view authorization (manager → all; CS → assignee OR agent member OR participant) — do not reimplement it differently.
- Activity is capped at the latest 200 rows (newest first).
- Verify from the `agent-portal/` directory: `npx tsc --noEmit`, `npx eslint <changed files>`, `npx vitest run src/lib/tasks`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Mutations (comment POST/DELETE, attachment POST/DELETE) and realtime (`taskRoomTopic`) are unchanged; only the read path moves to `/detail`.

---

## File Structure

- Create `src/lib/tasks/detail.ts` — shared read helpers + pure `groupCommentAttachments`; `loadTaskDetail`.
- Create `src/lib/tasks/detail.test.ts` — unit tests for the pure grouping + activity cap.
- Create `src/app/api/tasks/[id]/detail/route.ts` — GET, one authorize + `loadTaskDetail`.
- Modify `src/app/(authed)/tasks/_components/CommentThread.tsx` — controlled (`comments` + `onReload` props), keep composer/realtime.
- Modify `src/app/(authed)/tasks/_components/ActivityFeed.tsx` — controlled (`activity` prop).
- Modify `src/app/(authed)/tasks/_components/AttachmentPanel.tsx` — controlled (`attachments` + `onReload` props), keep upload/delete.
- Modify `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx` — fetch `/detail` once, per-task cache, `onReload`, pass data down; then tabbed UI + skeletons.

---

### Task 1: `detail.ts` read helpers + pure grouping (tested)

**Files:**
- Create: `src/lib/tasks/detail.ts`
- Test: `src/lib/tasks/detail.test.ts`

**Interfaces:**
- Produces:
  - `type SignedAttachment = { id: string; file_name: string; mime_type: string | null; size_bytes: number | null; url: string }`
  - `type CommentWithAttachments = Record<string, unknown> & { id: string; attachments: SignedAttachment[] }`
  - `type ActivityRow = { id: string; actor_email: string; type: string; meta: Record<string, unknown> | null; created_at: string }`
  - `type TaskDetail = { comments: CommentWithAttachments[]; activity: ActivityRow[]; attachments: SignedAttachment[] }`
  - `groupCommentAttachments(comments, signed): CommentWithAttachments[]` — pure.
  - `loadComments(supabase, taskId): Promise<CommentWithAttachments[]>`
  - `loadActivity(supabase, taskId): Promise<ActivityRow[]>`
  - `loadTaskAttachments(supabase, taskId): Promise<SignedAttachment[]>`
  - `loadTaskDetail(supabase, taskId): Promise<TaskDetail>`

- [ ] **Step 1: Write the failing test** — `src/lib/tasks/detail.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { groupCommentAttachments } from "@/lib/tasks/detail";

const att = (id: string) => ({
  id,
  file_name: `${id}.png`,
  mime_type: "image/png",
  size_bytes: 1,
  url: `https://x/${id}`,
});

describe("groupCommentAttachments", () => {
  it("attaches signed files to their comment, empty array otherwise", () => {
    const comments = [{ id: "c1", body: "a" }, { id: "c2", body: "b" }];
    const signed = [
      { comment_id: "c1", att: att("f1") },
      { comment_id: "c1", att: att("f2") },
    ];
    const out = groupCommentAttachments(comments, signed);
    expect(out[0]).toMatchObject({ id: "c1", body: "a" });
    expect(out[0].attachments.map((a) => a.id)).toEqual(["f1", "f2"]);
    expect(out[1].attachments).toEqual([]);
  });

  it("preserves comment order and all original fields", () => {
    const comments = [{ id: "c2", body: "second" }, { id: "c1", body: "first" }];
    const out = groupCommentAttachments(comments, []);
    expect(out.map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(out[0].body).toBe("second");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/lib/tasks/detail.test.ts`
Expected: FAIL — `groupCommentAttachments` not exported.

- [ ] **Step 3: Implement `src/lib/tasks/detail.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { signTaskFile } from "./storage";

export type SignedAttachment = {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  url: string;
};
export type CommentWithAttachments = Record<string, unknown> & {
  id: string;
  attachments: SignedAttachment[];
};
export type ActivityRow = {
  id: string;
  actor_email: string;
  type: string;
  meta: Record<string, unknown> | null;
  created_at: string;
};
export type TaskDetail = {
  comments: CommentWithAttachments[];
  activity: ActivityRow[];
  attachments: SignedAttachment[];
};

const COMMENT_COLUMNS =
  "id,task_id,parent_id,author_email,body,created_at,updated_at,deleted_at";
const ACTIVITY_LIMIT = 200;

// Pure: attach already-signed files to their comment (by comment_id), preserving
// comment order and all original comment fields.
export function groupCommentAttachments(
  comments: { id: string }[],
  signed: { comment_id: string; att: SignedAttachment }[]
): CommentWithAttachments[] {
  const byComment = new Map<string, SignedAttachment[]>();
  for (const { comment_id, att } of signed) {
    const list = byComment.get(comment_id) ?? [];
    list.push(att);
    byComment.set(comment_id, list);
  }
  return comments.map((c) => ({
    ...(c as Record<string, unknown>),
    id: c.id,
    attachments: byComment.get(c.id) ?? [],
  }));
}

export async function loadComments(
  supabase: SupabaseClient,
  taskId: string
): Promise<CommentWithAttachments[]> {
  const { data: comments } = await supabase
    .from("task_comments")
    .select(COMMENT_COLUMNS)
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  const { data: attData } = await supabase
    .from("task_attachments")
    .select("id,comment_id,file_name,mime_type,size_bytes,storage_path,created_at")
    .eq("task_id", taskId)
    .not("comment_id", "is", null)
    .order("created_at", { ascending: true });

  const signed = await Promise.all(
    (attData ?? []).map(async (a) => {
      const row = a as {
        id: string;
        comment_id: string;
        file_name: string;
        mime_type: string | null;
        size_bytes: number | null;
        storage_path: string;
      };
      return {
        comment_id: row.comment_id,
        att: {
          id: row.id,
          file_name: row.file_name,
          mime_type: row.mime_type,
          size_bytes: row.size_bytes,
          url: await signTaskFile(row.storage_path),
        } as SignedAttachment,
      };
    })
  );

  return groupCommentAttachments(
    (comments ?? []) as unknown as { id: string }[],
    signed
  );
}

export async function loadActivity(
  supabase: SupabaseClient,
  taskId: string
): Promise<ActivityRow[]> {
  const { data } = await supabase
    .from("task_activity")
    .select("id,actor_email,type,meta,created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
    .limit(ACTIVITY_LIMIT);
  return (data ?? []) as unknown as ActivityRow[];
}

export async function loadTaskAttachments(
  supabase: SupabaseClient,
  taskId: string
): Promise<SignedAttachment[]> {
  const { data } = await supabase
    .from("task_attachments")
    .select("id,file_name,mime_type,size_bytes,storage_path,created_at")
    .eq("task_id", taskId)
    .is("comment_id", null)
    .order("created_at", { ascending: true });
  return Promise.all(
    (data ?? []).map(async (a) => {
      const row = a as {
        id: string;
        file_name: string;
        mime_type: string | null;
        size_bytes: number | null;
        storage_path: string;
      };
      return {
        id: row.id,
        file_name: row.file_name,
        mime_type: row.mime_type,
        size_bytes: row.size_bytes,
        url: await signTaskFile(row.storage_path),
      };
    })
  );
}

export async function loadTaskDetail(
  supabase: SupabaseClient,
  taskId: string
): Promise<TaskDetail> {
  const [comments, activity, attachments] = await Promise.all([
    loadComments(supabase, taskId),
    loadActivity(supabase, taskId),
    loadTaskAttachments(supabase, taskId),
  ]);
  return { comments, activity, attachments };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/lib/tasks/detail.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify typecheck**

Run: `npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tasks/detail.ts src/lib/tasks/detail.test.ts
git commit -m "feat(tasks): batched task-detail read helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `GET /api/tasks/[id]/detail` route

**Files:**
- Create: `src/app/api/tasks/[id]/detail/route.ts`

**Interfaces:**
- Consumes: `loadTaskDetail` (Task 1); `canViewTask` + `fetchAgentsForCs` + `isTaskParticipant` (existing).
- Produces: `GET /api/tasks/[id]/detail` → `200 { comments, activity, attachments }` or `401`/`403`/`404`.

- [ ] **Step 1: Implement the route**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canViewTask } from "@/lib/tasks/access";
import { fetchAgentsForCs } from "@/lib/tasks/membership";
import { isTaskParticipant } from "@/lib/tasks/participants";
import { loadTaskDetail } from "@/lib/tasks/detail";
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
    .select("id,assignee_email,agent_email")
    .eq("id", id)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const t = task as Pick<TaskRow, "assignee_email" | "agent_email">;
  if (!actor.isManager) {
    const [isParticipant, agents] = await Promise.all([
      isTaskParticipant(id, actor.email),
      fetchAgentsForCs(actor.email),
    ]);
    const isAgentMember = Boolean(t.agent_email && agents.includes(t.agent_email));
    if (!canViewTask(actor, t, { isParticipant, isAgentMember }))
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const detail = await loadTaskDetail(supabase, id);
  return NextResponse.json(detail);
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npx eslint "src/app/api/tasks/[id]/detail/route.ts"` → clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/tasks/[id]/detail/route.ts"
git commit -m "feat(tasks): batched GET /api/tasks/[id]/detail (one authorize)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Controlled children + drawer fetches `/detail` (stacked layout, cache, onReload)

**Files:**
- Modify: `src/app/(authed)/tasks/_components/ActivityFeed.tsx`
- Modify: `src/app/(authed)/tasks/_components/AttachmentPanel.tsx`
- Modify: `src/app/(authed)/tasks/_components/CommentThread.tsx`
- Modify: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`

**Interfaces:**
- Consumes: `GET /api/tasks/[id]/detail` (Task 2), `TaskDetail`/`CommentWithAttachments`/`SignedAttachment`/`ActivityRow` types (Task 1).
- Produces (new component prop shapes):
  - `ActivityFeed({ activity: ActivityRow[]; personLabelByEmail })`
  - `AttachmentPanel({ attachments: SignedAttachment[]; canEdit; taskId; onReload })`
  - `CommentThread({ comments: CommentWithAttachments[]; members; currentEmail; taskId; onReload })`

- [ ] **Step 1: `ActivityFeed` → controlled.** Remove its `useEffect`/`useState`/fetch; accept `activity: ActivityRow[]` prop and render it. Import `ActivityRow` from `@/lib/tasks/detail`. Keep `describe`/`formatEmailAsName` helpers.

```tsx
export function ActivityFeed({
  activity,
  personLabelByEmail,
}: {
  activity: ActivityRow[];
  personLabelByEmail?: Map<string, string>;
}) {
  const personLabel = (email: string) =>
    personLabelByEmail?.get(email) ?? formatEmailAsName(email);
  if (activity.length === 0)
    return <p className="text-xs text-[#6b778c]">No activity yet.</p>;
  return (
    <ul className="space-y-2">
      {activity.map((a) => (/* existing <li> markup, using `a` */))}
    </ul>
  );
}
```

- [ ] **Step 2: `AttachmentPanel` → controlled.** Remove its fetch/`items` state; accept `attachments: SignedAttachment[]` + `onReload: () => void`. After a successful `upload`/`remove`, call `onReload()` instead of its own `load()`. Render `attachments` from props. Keep the file input + upload/delete POST/DELETE calls.

```tsx
export function AttachmentPanel({
  attachments,
  canEdit,
  taskId,
  onReload,
}: {
  attachments: SignedAttachment[];
  canEdit: boolean;
  taskId: string;
  onReload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: form });
      if (res.ok) onReload();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  async function remove(aid: string) {
    const res = await fetch(`/api/tasks/${taskId}/attachments/${aid}`, { method: "DELETE" });
    if (res.ok) onReload();
  }
  /* render `attachments` (was `items`) with the existing list + button markup */
}
```

- [ ] **Step 3: `CommentThread` → controlled.** Accept `comments: CommentWithAttachments[]` + `onReload`. Remove the comments-fetch `useEffect`/`load` and the `comments` state; use the `comments` prop. After `post`/`remove`, call `onReload()`. Keep the realtime subscription, but its handler now calls `onReload()` (debounced) instead of a local `load`. Keep the `Composer`, mention autocomplete, and attachment rendering (the comment shape already carries `attachments`).

```tsx
export function CommentThread({
  taskId,
  currentEmail,
  members,
  comments,
  onReload,
}: {
  taskId: string;
  currentEmail: string;
  members: TaskAssignee[];
  comments: CommentWithAttachments[];
  onReload: () => void;
}) {
  // ...post(body, files, parentId): after success -> onReload()
  // ...remove(id): after success -> onReload()
  // realtime effect: on "changed" ping -> debounced onReload()
  // render top-level/replies from the `comments` prop (cast rows to the local Comment shape)
}
```

- [ ] **Step 4: `TaskDetailDrawer` → fetch `/detail` once + cache + onReload.** Add a module-level cache and a `detail` state. On open (and `task.id` change), seed from cache if present, then fetch `/detail` and update cache+state. Pass `detail.comments/activity/attachments` to the children and `reload` to the mutating ones. Keep the current stacked layout for now (tabs come in Task 4).

```tsx
const detailCache = new Map<string, TaskDetail>();

// inside the component:
const [detail, setDetail] = useState<TaskDetail | null>(
  () => detailCache.get(task.id) ?? null
);
const reload = useCallback(async () => {
  try {
    const res = await fetch(`/api/tasks/${task.id}/detail`);
    if (!res.ok) return;
    const data = (await res.json()) as TaskDetail;
    detailCache.set(task.id, data);
    setDetail(data);
  } catch {
    /* ignore; next action/ping retries */
  }
}, [task.id]);
useEffect(() => {
  setDetail(detailCache.get(task.id) ?? null);
  void reload();
}, [task.id, reload]);
```

Render: where `AttachmentPanel`/`ActivityFeed`/`CommentThread` are used, pass
`attachments={detail?.attachments ?? []}`, `activity={detail?.activity ?? []}`,
`comments={detail?.comments ?? []}`, `onReload={reload}`, plus the existing
`taskId`/`members`/`currentEmail`/`canEdit`. (Skeleton states added in Task 4.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npx vitest run src/lib/tasks` → PASS.
Run: `npx eslint "src/app/(authed)/tasks/_components/ActivityFeed.tsx" "src/app/(authed)/tasks/_components/AttachmentPanel.tsx" "src/app/(authed)/tasks/_components/CommentThread.tsx" "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx"` → clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(authed)/tasks/_components/ActivityFeed.tsx" "src/app/(authed)/tasks/_components/AttachmentPanel.tsx" "src/app/(authed)/tasks/_components/CommentThread.tsx" "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx"
git commit -m "feat(tasks): drawer loads one batched /detail; children controlled + cached

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Tabbed drawer UI + skeletons

**Files:**
- Modify: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`

**Interfaces:**
- Consumes: drawer `detail` state + `reload` (Task 3).

- [ ] **Step 1: Add a tab state + tab bar.** Replace the always-stacked Comments (main) / Attachments+Activity (sidebar) sections with a single tab group in the main column: `const [tab, setTab] = useState<"comments" | "activity" | "attachments">("comments");` and a 3-button tab bar (reuse the existing pill/button styling in the file). Show a count next to each label from `detail` (e.g. `Comments ({detail?.comments.length ?? 0})`).

- [ ] **Step 2: Render the active tab only** (data already loaded, so switching is instant):

```tsx
{tab === "comments" && (
  <CommentThread taskId={task.id} currentEmail={currentEmail} members={assignees}
    comments={detail?.comments ?? []} onReload={reload} />
)}
{tab === "activity" && (
  <ActivityFeed activity={detail?.activity ?? []} personLabelByEmail={personLabelByEmail} />
)}
{tab === "attachments" && (
  <AttachmentPanel attachments={detail?.attachments ?? []} canEdit={canEdit}
    taskId={task.id} onReload={reload} />
)}
```

- [ ] **Step 3: Skeleton while first load is pending.** When `detail === null` (no cache yet and fetch in flight), render a lightweight skeleton in the tab body instead of empty content:

```tsx
{detail === null ? (
  <div className="space-y-2">
    <div className="h-4 w-1/3 animate-pulse rounded bg-[#f1f2f4]" />
    <div className="h-16 w-full animate-pulse rounded bg-[#f1f2f4]" />
  </div>
) : ( /* the active tab block above */ )}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npx eslint "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx"` → clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx"
git commit -m "feat(tasks): tabbed task drawer (Comments/Activity/Attachments) + skeleton

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: Manual check.** Open a task → exactly one `/api/tasks/<id>/detail` request in the Network tab (no /comments, /activity, /attachments GETs). Switching tabs issues no new request. Posting a comment / uploading a file triggers one `/detail` refetch. Re-opening a recently-opened task renders instantly, then refreshes.

---

## Self-Review

**Spec coverage:**
- B endpoint (one authorize + parallel) → Task 2 ✓; shared helpers `detail.ts` → Task 1 ✓.
- A: drawer one fetch + cache + onReload → Task 3 ✓; controlled children → Task 3 ✓; tabs (Comments default) + skeletons → Task 4 ✓.
- Activity cap 200 → Task 1 (`ACTIVITY_LIMIT`) ✓. View authorization reused → Task 2 ✓. Mutations/realtime unchanged → Tasks 3 (onReload wraps them) ✓.

**Placeholder scan:** Task 3 steps reference "existing markup" for the list/`<li>` rendering rather than repeating every line — intentional: the implementer is editing those exact files and the markup is preserved verbatim, only the data source (prop vs state) changes. Core new logic (props, upload/remove→onReload, drawer fetch/cache, route, helpers) has complete code. No silent TODOs.

**Type consistency:** `TaskDetail`, `CommentWithAttachments`, `SignedAttachment`, `ActivityRow`, `loadTaskDetail`, `groupCommentAttachments`, and the child prop shapes (`comments`/`activity`/`attachments`/`onReload`) are consistent across Tasks 1→4.

## Notes for the implementer
- The local `Comment` type inside `CommentThread` should be replaced by / aligned with `CommentWithAttachments` (it already expected an `attachments` field).
- Keep the comment realtime subscription (`taskRoomTopic`); only its callback changes to `onReload`.
- Do not remove the individual GET routes in this plan (optional later cleanup once `/detail` is verified in production).
