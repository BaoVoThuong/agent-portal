# Task Board Phase 4 — Attachments & Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** File attachments via a private Supabase Storage bucket (signed-URL downloads) and self-managed task categories (manager CRUD, everyone classifies).

**Architecture:** A `storage.ts` helper wraps the Supabase Storage client; attachment routes upload/sign/delete and store metadata rows. Category routes provide CRUD (manager-gated for writes). The board page threads the active category list to the new-task dialog, drawer, and card; a manager-only CategoryManager modal edits the list.

**Tech Stack:** Next.js 16, TypeScript, Supabase Storage (service role), Tailwind, lucide-react, vitest.

**Depends on:** Phases 1–3 (tables incl. `task_attachments`/`task_categories`, access helpers, task/drawer/board client).

## Global Constraints

- Identity by **email**; authorization server-side. Upload/delete attachments allowed where `canMutateTask` is true (manager any task; worker own task). View/download where `canViewTask` is true.
- Category writes (create/update/delete) require `canManageCategories` (manager). Reading categories is allowed for any board user. Delete is a **soft delete** (`is_active = false`) so existing tasks keep their reference.
- Storage bucket `task-attachments` is **private**; downloads use short-lived signed URLs generated server-side. Files are never public.
- Brand `#0f2849`; lucide-react; vitest with `@/` alias.

---

### Task 1: Create the Storage bucket

**Files:** none (Supabase dashboard / SQL — manual, idempotent).

- [ ] **Step 1: Create the private bucket**

In the Supabase SQL editor, run:

```sql
insert into storage.buckets (id, name, public)
values ('task-attachments', 'task-attachments', false)
on conflict (id) do nothing;
```

- [ ] **Step 2: Verify**

```sql
select id, public from storage.buckets where id = 'task-attachments';
-- Expected: one row, public = false
```

No app commit (infra step). Record completion in the execution log.

---

### Task 2: Storage helper + filename sanitizer

**Files:**
- Create: `src/lib/tasks/storage.ts`
- Test: `src/lib/tasks/storage.test.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin` from `@/lib/supabase`.
- Produces:
  - `TASK_BUCKET = "task-attachments"`
  - `sanitizeFileName(name: string): string` (pure — tested)
  - `buildStoragePath(taskId: string, fileName: string): string`
  - `uploadTaskFile(path: string, data: ArrayBuffer, contentType: string): Promise<void>`
  - `signTaskFile(path: string, expiresIn?: number): Promise<string>`
  - `removeTaskFile(path: string): Promise<void>`

- [ ] **Step 1: Write the failing tests (pure part)**

Create `src/lib/tasks/storage.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { sanitizeFileName, buildStoragePath } from "@/lib/tasks/storage";

describe("sanitizeFileName", () => {
  it("keeps word chars, dot and dash; replaces the rest with _", () => {
    expect(sanitizeFileName("My File (1).pdf")).toBe("My_File_1_.pdf");
  });
  it("collapses runs of unsafe chars to a single _", () => {
    expect(sanitizeFileName("a   b///c.png")).toBe("a_b_c.png");
  });
  it("falls back to 'file' for empty/space-only names", () => {
    expect(sanitizeFileName("   ")).toBe("file");
  });
});

describe("buildStoragePath", () => {
  it("nests under tasks/{taskId}/ and ends with the sanitized name", () => {
    const p = buildStoragePath("task-1", "Report 2.pdf");
    expect(p.startsWith("tasks/task-1/")).toBe(true);
    expect(p.endsWith("Report_2.pdf")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/tasks/storage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/tasks/storage.ts`:

```typescript
import { getSupabaseAdmin } from "@/lib/supabase";

export const TASK_BUCKET = "task-attachments";

export function sanitizeFileName(name: string): string {
  const cleaned = name.trim().replace(/[^\w.\-]+/g, "_");
  return cleaned.length > 0 ? cleaned : "file";
}

export function buildStoragePath(taskId: string, fileName: string): string {
  const uuid = globalThis.crypto.randomUUID();
  return `tasks/${taskId}/${uuid}-${sanitizeFileName(fileName)}`;
}

export async function uploadTaskFile(
  path: string,
  data: ArrayBuffer,
  contentType: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage
    .from(TASK_BUCKET)
    .upload(path, data, { contentType, upsert: false });
  if (error) throw new Error(error.message);
}

export async function signTaskFile(path: string, expiresIn = 3600): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(TASK_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error || !data) throw new Error(error?.message ?? "Could not sign file");
  return data.signedUrl;
}

export async function removeTaskFile(path: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(TASK_BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/tasks/storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/storage.ts src/lib/tasks/storage.test.ts
git commit -m "feat(tasks): add storage helper for attachments"
```

---

### Task 3: Attachments API — list / upload

**Files:**
- Create: `src/app/api/tasks/[id]/attachments/route.ts`

**Interfaces:**
- Consumes: `auth`, `buildTaskActor`, `canViewTask`, `canMutateTask`, `getSupabaseAdmin`, `buildStoragePath`, `uploadTaskFile`, `signTaskFile`.
- Produces:
  - `GET` → `{ attachments: { id, file_name, mime_type, size_bytes, created_at, url }[] }` (url = signed).
  - `POST` (multipart form with `file`) → `{ attachment }` (includes signed `url`).

- [ ] **Step 1: Implement**

Create `src/app/api/tasks/[id]/attachments/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canViewTask, canMutateTask } from "@/lib/tasks/access";
import { buildStoragePath, uploadTaskFile, signTaskFile } from "@/lib/tasks/storage";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const MAX_BYTES = 15 * 1024 * 1024; // 15MB

async function loadActorAndTask(id: string) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };
  const actor = buildTaskActor(session.user.permissions, email);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tasks")
    .select("id,assignee_email")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found", status: 404 };
  return { actor, task: data as unknown as Pick<TaskRow, "id" | "assignee_email">, supabase };
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!canViewTask(r.actor, r.task))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data, error } = await r.supabase
    .from("task_attachments")
    .select("id,file_name,mime_type,size_bytes,storage_path,created_at")
    .eq("task_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const attachments = await Promise.all(
    (data ?? []).map(async (a) => {
      const row = a as {
        id: string;
        file_name: string;
        mime_type: string | null;
        size_bytes: number | null;
        storage_path: string;
        created_at: string;
      };
      return {
        id: row.id,
        file_name: row.file_name,
        mime_type: row.mime_type,
        size_bytes: row.size_bytes,
        created_at: row.created_at,
        url: await signTaskFile(row.storage_path),
      };
    })
  );
  return NextResponse.json({ attachments });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!canMutateTask(r.actor, r.task))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File))
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (file.size > MAX_BYTES)
    return NextResponse.json({ error: "File too large (max 15MB)." }, { status: 400 });

  const path = buildStoragePath(id, file.name);
  const contentType = file.type || "application/octet-stream";
  await uploadTaskFile(path, await file.arrayBuffer(), contentType);

  const { data, error } = await r.supabase
    .from("task_attachments")
    .insert({
      task_id: id,
      storage_path: path,
      file_name: file.name,
      mime_type: contentType,
      size_bytes: file.size,
      uploaded_by: r.actor.email,
    })
    .select("id,file_name,mime_type,size_bytes,created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await r.supabase.from("task_activity").insert({
    task_id: id,
    actor_email: r.actor.email,
    type: "attachment_added",
    meta: { file_name: file.name },
  });

  return NextResponse.json({
    attachment: { ...(data as object), url: await signTaskFile(path) },
  });
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add "src/app/api/tasks/[id]/attachments/route.ts"
git commit -m "feat(tasks): add attachment list/upload API"
```

---

### Task 4: Attachment delete

**Files:**
- Create: `src/app/api/tasks/[id]/attachments/[aid]/route.ts`

**Interfaces:**
- Produces: `DELETE` → `{ ok: true }`. Allowed for the uploader or a manager (and only on a task the actor can mutate).

- [ ] **Step 1: Implement**

Create `src/app/api/tasks/[id]/attachments/[aid]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canMutateTask } from "@/lib/tasks/access";
import { removeTaskFile } from "@/lib/tasks/storage";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; aid: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, aid } = await params;
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
  if (!canMutateTask(actor, task as Pick<TaskRow, "assignee_email">))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data: att } = await supabase
    .from("task_attachments")
    .select("id,task_id,storage_path,uploaded_by")
    .eq("id", aid)
    .maybeSingle();
  const attachment = att as
    | { task_id: string; storage_path: string; uploaded_by: string | null }
    | null;
  if (!attachment || attachment.task_id !== id)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Uploader or manager only.
  if (!actor.isManager && attachment.uploaded_by !== email)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await removeTaskFile(attachment.storage_path);
  const { error } = await supabase.from("task_attachments").delete().eq("id", aid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add "src/app/api/tasks/[id]/attachments/[aid]/route.ts"
git commit -m "feat(tasks): add attachment delete API"
```

---

### Task 5: Categories API — list / create / update / delete

**Files:**
- Create: `src/app/api/tasks/categories/route.ts`
- Create: `src/app/api/tasks/categories/[id]/route.ts`

**Interfaces:**
- Consumes: `auth`, `buildTaskActor`, `canAccessBoard`, `canManageCategories`, `getSupabaseAdmin`.
- Produces:
  - `GET /api/tasks/categories` → `{ categories: { id, name, color, position }[] }` (active, ordered).
  - `POST` body `{ name, color? }` → `{ category }` (manager).
  - `PATCH /api/tasks/categories/[id]` body `{ name?, color?, is_active? }` → `{ category }` (manager).
  - `DELETE /api/tasks/categories/[id]` → `{ ok: true }` (manager; soft delete `is_active=false`).

- [ ] **Step 1: Implement the collection route**

Create `src/app/api/tasks/categories/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canAccessBoard, canManageCategories } from "@/lib/tasks/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email);
  if (!canAccessBoard(actor))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("task_categories")
    .select("id,name,color,position")
    .eq("is_active", true)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ categories: data ?? [] });
}

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email);
  if (!canManageCategories(actor))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
  const color = typeof body?.color === "string" ? body.color.trim() : null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("task_categories")
    .insert({ name, color, created_by: email })
    .select("id,name,color,position")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ category: data });
}
```

- [ ] **Step 2: Implement the item route**

Create `src/app/api/tasks/categories/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canManageCategories } from "@/lib/tasks/access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function requireManager() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };
  const actor = buildTaskActor(session.user.permissions, email);
  if (!canManageCategories(actor)) return { error: "Unauthorized" as const, status: 401 };
  return { supabase: getSupabaseAdmin() };
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireManager();
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const body = await req.json().catch(() => null);
  const patch: Record<string, unknown> = {};
  if (typeof body?.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body?.color === "string") patch.color = body.color.trim() || null;
  if (typeof body?.is_active === "boolean") patch.is_active = body.is_active;
  if (Object.keys(patch).length === 0)
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  const { data, error } = await ctx.supabase
    .from("task_categories")
    .update(patch)
    .eq("id", id)
    .select("id,name,color,position")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ category: data });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireManager();
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  // Soft delete so tasks that reference it keep their (now-hidden) category.
  const { error } = await ctx.supabase
    .from("task_categories")
    .update({ is_active: false })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add src/app/api/tasks/categories
git commit -m "feat(tasks): add category CRUD API"
```

---

### Task 6: Accept category on task create

**Files:**
- Modify: `src/app/api/tasks/route.ts` (POST)

- [ ] **Step 1: Persist category_id on create**

In `src/app/api/tasks/route.ts` POST, add `category_id` to the insert object (after `due_date`):

```typescript
      category_id:
        typeof body?.category_id === "string" && body.category_id.trim() !== ""
          ? body.category_id.trim()
          : null,
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add "src/app/api/tasks/route.ts"
git commit -m "feat(tasks): accept category_id when creating a task"
```

---

### Task 7: Attachments panel UI

**Files:**
- Create: `src/app/(authed)/tasks/_components/AttachmentPanel.tsx`

**Interfaces:**
- Produces: `AttachmentPanel({ taskId, canEdit, currentEmail })` — lists attachments (download via signed url), uploads a file, deletes own/any (manager).

- [ ] **Step 1: Implement**

Create `src/app/(authed)/tasks/_components/AttachmentPanel.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, Trash2 } from "lucide-react";

type Attachment = {
  id: string;
  file_name: string;
  size_bytes: number | null;
  created_at: string;
  url: string;
};

export function AttachmentPanel({
  taskId,
  canEdit,
}: {
  taskId: string;
  canEdit: boolean;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/tasks/${taskId}/attachments`);
    if (res.ok) setItems((await res.json()).attachments as Attachment[]);
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: form });
      if (res.ok) await load();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(aid: string) {
    const res = await fetch(`/api/tasks/${taskId}/attachments/${aid}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {items.map((a) => (
          <li key={a.id} className="flex items-center gap-2 text-sm">
            <Paperclip className="h-3.5 w-3.5 text-slate-400" />
            <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-[#0f2849] hover:underline">
              {a.file_name}
            </a>
            {canEdit && (
              <button type="button" onClick={() => remove(a.id)} aria-label="Delete attachment" className="text-slate-400 hover:text-red-500">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="text-xs text-slate-400">No attachments.</li>}
      </ul>
      {canEdit && (
        <div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <Paperclip className="h-3.5 w-3.5" /> {busy ? "Uploading…" : "Attach file"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add "src/app/(authed)/tasks/_components/AttachmentPanel.tsx"
git commit -m "feat(tasks): add attachment panel UI"
```

---

### Task 8: Category manager modal (manager)

**Files:**
- Create: `src/app/(authed)/tasks/_components/CategoryManager.tsx`

**Interfaces:**
- Consumes: category API.
- Produces: `CategoryManager({ open, onClose, onChanged })` — list + add + soft-delete; calls `onChanged()` after mutations so the board refetches.

- [ ] **Step 1: Implement**

Create `src/app/(authed)/tasks/_components/CategoryManager.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";

type Category = { id: string; name: string; color: string | null };

export function CategoryManager({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Category[]>([]);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/tasks/categories");
    if (res.ok) setItems((await res.json()).categories as Category[]);
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function add() {
    if (!name.trim()) return;
    const res = await fetch("/api/tasks/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (res.ok) {
      setName("");
      await load();
      onChanged();
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/tasks/categories/${id}`, { method: "DELETE" });
    if (res.ok) {
      await load();
      onChanged();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#0f2849]">Categories</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="mt-4 space-y-1">
          {items.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
              <span>{c.name}</span>
              <button type="button" onClick={() => remove(c.id)} aria-label="Delete category" className="text-slate-400 hover:text-red-500">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="text-xs text-slate-400">No categories yet.</li>}
        </ul>
        <div className="mt-4 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New category"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          />
          <button type="button" onClick={add} disabled={!name.trim()} className="rounded-lg bg-[#0f2849] px-3 py-1.5 text-sm text-white disabled:opacity-40">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` (Expected: No errors).
```bash
git add "src/app/(authed)/tasks/_components/CategoryManager.tsx"
git commit -m "feat(tasks): add category manager modal"
```

---

### Task 9: Thread categories + attachments through the board

**Files:**
- Modify: `src/app/(authed)/tasks/page.tsx` (fetch categories, pass down)
- Modify: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx` (hold categories, "Manage categories" button for managers, pass to dialog/drawer/card)
- Modify: `src/app/(authed)/tasks/_components/NewTaskDialog.tsx` (category select)
- Modify: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx` (category select + AttachmentPanel)
- Modify: `src/app/(authed)/tasks/_components/TaskCard.tsx` (category chip)

**Interfaces:**
- Produces: a shared `TaskCategory = { id: string; name: string; color: string | null }` type used across these components. Define it in `src/lib/tasks/types.ts`.

- [ ] **Step 1: Add the shared category type**

In `src/lib/tasks/types.ts`, append:

```typescript
export type TaskCategory = { id: string; name: string; color: string | null };
```

- [ ] **Step 2: Fetch categories in the page and pass down**

In `src/app/(authed)/tasks/page.tsx`, add the import and fetch, then pass `categories`:

```tsx
import { getSupabaseAdmin } from "@/lib/supabase";
import type { TaskCategory } from "@/lib/tasks/types";
```

After computing `assignees`, add:
```tsx
  const { data: categoryRows } = await getSupabaseAdmin()
    .from("task_categories")
    .select("id,name,color")
    .eq("is_active", true)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  const categories = (categoryRows ?? []) as TaskCategory[];
```

Pass it to the client:
```tsx
    <TaskBoardClient
      initialTasks={tasks}
      isManager={actor.isManager}
      currentEmail={email}
      assignees={assignees}
      initialCategories={categories}
    />
```

- [ ] **Step 3: Hold categories in the board client**

In `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`:

Add imports:
```tsx
import type { TaskCategory } from "@/lib/tasks/types";
import { CategoryManager } from "./CategoryManager";
import { Tag } from "lucide-react";
```

Add `initialCategories` to props (type + destructure) and state:
```tsx
  initialCategories,
```
```tsx
  initialCategories: TaskCategory[];
```
```tsx
  const [categories, setCategories] = useState<TaskCategory[]>(initialCategories);
  const [managingCategories, setManagingCategories] = useState(false);

  const reloadCategories = async () => {
    const res = await fetch("/api/tasks/categories");
    if (res.ok) setCategories((await res.json()).categories as TaskCategory[]);
  };
```

In the header actions (next to "New task"), add a manager-only button:
```tsx
        {isManager && (
          <button
            type="button"
            onClick={() => setManagingCategories(true)}
            className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600"
          >
            <Tag className="h-4 w-4" /> Categories
          </button>
        )}
```

Pass `categories` to `KanbanBoard` (for the card chip), `NewTaskDialog`, and `TaskDetailDrawer`, and render the manager modal:
```tsx
      <CategoryManager
        open={managingCategories}
        onClose={() => setManagingCategories(false)}
        onChanged={reloadCategories}
      />
```
Update the existing usages to include `categories={categories}` on `KanbanBoard`, `NewTaskDialog`, and `TaskDetailDrawer`.

- [ ] **Step 4: Category chip on the card**

In `src/app/(authed)/tasks/_components/TaskCard.tsx`, accept an optional category name and render a chip. Change the signature and body:

```tsx
import type { TaskRow } from "@/lib/tasks/types";
import { PriorityDot, DueBadge, WaitingTag, Initials } from "./board-ui";

export function TaskCard({
  task,
  categoryName,
  onOpen,
}: {
  task: TaskRow;
  categoryName?: string | null;
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
        {categoryName && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
            {categoryName}
          </span>
        )}
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

In `src/app/(authed)/tasks/_components/KanbanBoard.tsx`, thread `categories` to a name lookup and pass `categoryName` to each `TaskCard`/`SortableCard`. Add `categories` to `KanbanBoard` props, build `const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? null;`, and pass `categoryName={categoryName(task.category_id)}` where cards render (`SortableCard` should accept and forward `categoryName` to `TaskCard`).

- [ ] **Step 5: Category select in NewTaskDialog**

In `src/app/(authed)/tasks/_components/NewTaskDialog.tsx`:
- Add `categories: TaskCategory[]` to props (and import `TaskCategory`).
- Add `const [categoryId, setCategoryId] = useState("");` and a select:
```tsx
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
```
- Add `category_id: categoryId || undefined` to the `NewTaskPayload` (extend the type) and to the `onCreate` payload; reset it in the success branch.

- [ ] **Step 6: Category select + attachments in the drawer**

In `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`:
- Add `categories: TaskCategory[]` to props (import the type) and `import { AttachmentPanel } from "./AttachmentPanel";`.
- Add a category select in the details grid that calls `onPatch({ category_id: value || null })`:
```tsx
            <label className="space-y-1">
              <span className="text-xs text-slate-500">Category</span>
              <select
                value={task.category_id ?? ""}
                disabled={!canEdit}
                onChange={(e) => onPatch({ category_id: e.target.value || null })}
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 disabled:bg-slate-50"
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
```
- In the "details" tab content, render attachments:
```tsx
            {tab === "details" && (
              <div className="space-y-2">
                <span className="text-xs font-medium text-slate-500">Attachments</span>
                <AttachmentPanel taskId={task.id} canEdit={canEdit} />
              </div>
            )}
```

- [ ] **Step 7: Verify build + manual test**

Run: `npx tsc --noEmit` (Expected: No errors).
Run: `npx next build` (Expected: build succeeds).

Manual:
1. As Manager: open "Categories", add "Renewal" and "Claim"; create a task and pick a category → chip shows on the card. Delete a category → it disappears from pickers; existing tasks keep showing nothing (soft-deleted).
2. In a task drawer (details tab): attach a PDF → it lists with a working download link (signed URL). Delete it (uploader/manager). As CS on your own task: attach + delete your own file works; the file is not publicly accessible (open the storage path without signing → denied).

- [ ] **Step 8: Commit**

```bash
git add "src/app/(authed)/tasks" "src/lib/tasks/types.ts"
git commit -m "feat(tasks): thread categories and attachments through the board"
```

---

## Self-Review

**Spec coverage (Phase 4 portion):**
- Private Storage bucket + signed-URL downloads → Tasks 1, 2, 3. ✓
- Attachment upload/list/delete with mutate/view scope, uploader-or-manager delete → Tasks 3, 4. ✓
- Attachment activity log entry → Task 3 (`attachment_added`). ✓
- Self-managed categories: CRUD (manager), read for all, soft delete → Tasks 5, 8. ✓
- Category on create + edit + card chip → Tasks 6, 9. ✓
- Category selector in new-task + drawer; manager CategoryManager → Tasks 8, 9. ✓

**Placeholder scan:** No TBD/TODO; all steps carry full code or precise edit instructions with the exact code to insert. ✓

**Type consistency:** `TaskCategory` defined once in `types.ts` (Task 9 Step 1) and imported everywhere. `canMutateTask`/`canViewTask`/`canManageCategories` reused from Phase 1 with their original signatures. Attachment row shape (`id,file_name,mime_type,size_bytes,created_at,url`) consistent between API (Task 3) and UI (Task 7). `buildStoragePath`/`signTaskFile`/`removeTaskFile` signatures consistent across Tasks 2–4. ✓

**Whole-feature check:** With Phases 1–4 complete, the spec's MVP is fully covered: schema, permissions, scope, Kanban + backlog, comments/replies, mentions, notifications, activity, attachments, categories. Out-of-scope items (realtime, custom columns, Review column, sprints, reports, email, reactions, swimlanes, SLA) remain deferred as designed.
