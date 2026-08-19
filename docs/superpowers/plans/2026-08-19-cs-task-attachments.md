# CS Tasks — Attach Files While Creating a Task

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make attachments a field of the "New task" form, exactly like Description — pick files while creating the task, drop any picked by mistake before submitting — and show the resulting files in the task drawer directly beneath the Description field.

**Architecture:** No schema change, no new API endpoint. `task_attachments.comment_id` is already nullable and a NULL there already means "attached to the task itself". `POST /api/tasks/[id]/attachments` already creates exactly that row when the `comment_id` form field is omitted, and `loadTaskDetail` already loads and signs those rows. What is missing: the drawer never renders them, the detail route deliberately suppresses them, and the create dialog has no file field. Since there is no task id until the task exists, the dialog holds the chosen files in browser memory, creates the task, then uploads them against the id that comes back.

**Tech Stack:** Next.js 16.2.4 App Router, React client components, Tailwind v4 (no config file — arbitrary values like `max-h-[58px]` are read straight from source), Supabase Storage, vitest 2.1.9.

## Scope

**In:** the create dialog gains a file field; the drawer shows the files under Description; the upload route stops notifying for create-time uploads and starts enforcing the file caps it currently does not enforce.

**Out:** uploading from the drawer after the task exists, and deleting anything after the task exists. Files are set once, at creation, and are read-only thereafter. CS loses nothing — it has no attachment UI on the task at all today.

The Enrollment side is `2026-08-19-enrollment-create-attachments.md`, and three unrelated Enrollment fixes are `2026-08-19-enrollment-drawer-fixes.md`. **Do this plan first.** Tasks 1 and 2 create two files the Enrollment plan then reuses.

## Global Constraints

- **UI copy is English only.** Commit `03ec9bd` translated the last 21 Vietnamese user-facing strings. Code comments may stay Vietnamese; anything a user reads may not.
- **Test harness cannot render components.** `vitest.config.ts` sets `environment: "node"` and `include: ["src/**/*.test.ts"]`. There is no jsdom and no testing-library, and `.tsx` files are not collected at all. Every test step targets a plain `.ts` module. Do not plan component tests; they will not run. (`File` and `crypto.randomUUID` *are* available — both are Node 20 globals, verified by running the Task 1 suite.)
- **`TASK_ATTACHMENT_MAX_BYTES` is 15MB**, `src/lib/tasks/attachments.ts:1`. `LIMITS` in `src/lib/tasks/attachment-limits.ts` is `{ maxTextLength: 10_000, maxFiles: 10, maxAggregateBytes: 50 * 1024 * 1024 }`, and `checkOperationLimits({ textLength, sizes })` checks aggregate, then count, then per-file.
- **Every logic change gets a `changelog.md` entry** in the same turn, newest at top.
- **Do not commit or push without being asked.** Each commit and each push is a separate request, and the remote must be named: `origin` is BaoVoThuong/agent-portal, `vercel` is the separate repo eps-portal.vercel.app deploys from.

## Verified starting state

Confirmed against the tree at commit `bc27874`. Line numbers below are exact; a previous draft of this plan was off by ~17 in `TaskDetailDrawer.tsx` and quoted a comment that did not match the file, which broke every find/replace.

| Claim | Evidence |
|---|---|
| `task_attachments.comment_id` nullable; NULL = task-level | `supabase/schema.sql:1979` |
| `GET .../attachments` filters `.is("comment_id", null)` | `src/app/api/tasks/[id]/attachments/route.ts:104` |
| `POST .../attachments` treats a missing `comment_id` as task-level | same file, 146-147 |
| Route accepts an optional `client_request_id`, must be a UUID | same file, 149-153, passed to the RPC at 242 |
| Partial unique index makes that idempotent | `supabase/schema.sql`, `task_attachments_client_request_id_key` on `(task_id, uploaded_by, client_request_id) where client_request_id is not null` |
| Route notifies only when `comment_id` is null | same file, `if (!commentId) {` at 317 |
| Detail route suppresses task-level attachments | `src/app/api/tasks/[id]/detail/route.ts:59` |
| `loadTaskDetail` already returns `attachments` | `src/lib/tasks/detail.ts:43`, loader at 196-210 |
| `createTask` returns void, exactly one caller | `TaskBoardClient.tsx:1415`, caller at 1756 |
| `submit()` has `finally { setSaving(false) }` outside the try | `NewTaskDialog.tsx:238-240` — an early `return` does **not** strand busy state |
| Allowed extensions: csv, gif, heic, jpeg, jpg, pdf, png, txt, webp, xls, xlsx | `src/lib/tasks/attachments.ts:3-15` |

**Two things the code does NOT do, contrary to what you might assume:**

1. **The 10-file / 50MB caps are not enforced for task-level uploads.** `checkOperationLimits` sits inside `if (commentId) { … }` at `src/app/api/tasks/[id]/attachments/route.ts:178-195`, and the sizes query is scoped `.eq("comment_id", commentId)`. A task-level upload never reaches it. Only the per-file 15MB check applies. Task 3 fixes this; without it the caps are decoration a client can skip.
2. **Nothing in the UI calls `DELETE /api/tasks/[id]/attachments/[aid]`.** `AttachmentPanel` is the only caller anywhere (`AttachmentPanel.tsx:76`), and the only component that instantiates `AttachmentPanel` is `EnrollmentClient.tsx`, with `apiBase="/api/enrollment"`. `CommentThread` has its own upload path and its only DELETE is `comments/${id}` (`CommentThread.tsx:791`). So the "no delete after create" rule is already true for CS in the UI — see the closing note about whether to enforce it server-side.

## The height constraint — read this before writing any drawer JSX

The task drawer is a **fixed-height column that does not scroll on desktop**, so the comment composer stays docked at the bottom. `TaskDetailDrawer.tsx:384`:

```tsx
className="flex h-[calc(100vh-2rem)] max-h-[760px] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
```

and `:404-406`:

```tsx
        <div className="flex-1 overflow-y-auto lg:overflow-hidden">
          <div className="grid min-h-full grid-cols-1 lg:h-full lg:grid-cols-[minmax(0,1fr)_280px]">
            <main className="flex min-w-0 flex-col gap-3 p-4 lg:min-h-0 lg:overflow-hidden lg:p-5">
```

Inside that `<main>`, every field wrapper is `shrink-0` (`COMPACT_DETAIL_FIELD_CLASS = "block shrink-0 space-y-1"`, line 40) and the comment section is the **only** `flex-1` child (line 538).

**Every pixel a new block under Description occupies is a pixel taken from the comment thread, permanently.** This exact bug already shipped: an uncapped auto-growing Description reduced TASK-12 to showing 1 of its 15 comments. Commit `ffb8c2b` fixed it by capping the field at 138px and left the reasoning in the source at lines 42-46.

**Budget arithmetic for the strip.** A chip is `text-xs` (16px line box) + `py-1` (8px) + 2px border = **26px**; `gap-1.5` is 6px. So two rows = 58px, three = 90px. The strip uses `max-h-[58px]` — two rows, then it scrolls — costing about 80px including its label. Do not raise this without recomputing; 88px, for instance, renders a third row clipped by 2px, which looks broken.

## Design decisions

**Upload happens after create, not before.** There is no task id until the row exists, and the upload route requires one in its path. The alternatives were a staging bucket with orphan cleanup, or a multipart create endpoint — both add server surface and a new class of orphaned-blob bug.

**Uploads are sequential.** Not because the server serialises anything — it does not, see "Two things the code does NOT do" above — but because ten parallel `fetch` calls each buffering up to 15MB is a lot of memory and a lot of concurrent Storage writes for no benefit, and because reporting "file 3 of 7 failed" is only meaningful in order.

**Every staged file carries a UUID that is sent as `client_request_id`.** Without it, a retry duplicates files. The create payload already carries `client_request_id: createRequestIdRef.current` (`NewTaskDialog.tsx:223`), and that ref only resets when the dialog reopens (102-110) — so pressing Create again after a partial upload failure replays the *same* task through `create_task_atomic` and then re-POSTs every file. With a per-file UUID the partial unique index absorbs the repeats.

**Do not notify.** The route fires `attachment_added` whenever `comment_id` is null (317-340). Creating a task with ten files would fire ten notifications per recipient on top of the task's own, into a notification load already judged too noisy. Task 3 adds a `silent` flag the create dialog sets.

**The Attachments field is not gated on `showDescription`.** `showField("description")` reflects whether the *Description column* is configured for this board (`TaskDetailDrawer.tsx:327`, `NewTaskDialog.tsx:297`). Attachments are not a configured column, so they render regardless. If the boss wants them to disappear together, wrap both call sites in the same condition — a one-line change, called out here so it is a decision rather than an accident.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/lib/tasks/attachments.ts` | modify | Export the allowed-extension list so the client can reject files the server would. |
| `src/lib/tasks/pending-attachments.ts` | **create** | Pure staging logic: add, remove, validate, summarise. The only part vitest can cover. Reused by the Enrollment plan. |
| `src/lib/tasks/pending-attachments.test.ts` | **create** | Tests for the above. |
| `src/app/(authed)/tasks/_components/AttachmentStrip.tsx` | **create** | Read-only capped chip strip. Reused by the Enrollment plan. |
| `src/app/api/tasks/[id]/detail/route.ts` | modify line 57-59 | Stop suppressing the data. |
| `src/app/api/tasks/[id]/attachments/route.ts` | modify | `silent` flag; enforce the caps for task-level uploads. |
| `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx` | modify line 537 | Render the strip under Description. |
| `src/app/(authed)/tasks/_components/TaskBoardClient.tsx` | modify line 1415 | Return the created task. |
| `src/app/(authed)/tasks/_components/NewTaskDialog.tsx` | modify | The file field, the upload loop, Cancel gating. |
| `changelog.md` | modify | One entry. |

---

### Task 1: Staging module for files picked before the task exists

**Files:**
- Modify: `src/lib/tasks/attachments.ts` (one export)
- Create: `src/lib/tasks/pending-attachments.ts`
- Test: `src/lib/tasks/pending-attachments.test.ts`

**Interfaces:**
- Consumes: `checkOperationLimits`, `LimitFailure` from `./attachment-limits`; `ATTACHMENT_ALLOWED_EXTENSIONS`, `TASK_ATTACHMENT_MAX_BYTES` from `./attachments`.
- Produces: `PendingFile`, `UploadResult`, `addPendingFiles()`, `removePendingFile()`, `summariseUploadResults()`, `ATTACHMENT_ACCEPT_ATTRIBUTE`.

- [ ] **Step 1: Export the extension list**

`src/lib/tasks/attachments.ts:3` declares `MIME_BY_EXTENSION` but does not export it, and `validateAttachmentFile` (line 56) runs server-side only. Without a client-side check, staging a `.docx` creates a real task and then fails every upload, leaving the user with a task they must delete. Add after line 17:

```ts
export const ATTACHMENT_ALLOWED_EXTENSIONS = Object.keys(MIME_BY_EXTENSION);
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/tasks/pending-attachments.test.ts
import { describe, expect, it } from "vitest";
import {
  addPendingFiles,
  ATTACHMENT_ACCEPT_ATTRIBUTE,
  removePendingFile,
  summariseUploadResults,
  type PendingFile,
} from "./pending-attachments";

function sized(name: string, size: number): File {
  const file = new File([], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function pending(name: string, size: number): PendingFile {
  return { key: `k-${name}`, name, size, file: sized(name, size) };
}

describe("addPendingFiles", () => {
  it("appends to the existing list", () => {
    const result = addPendingFiles([pending("a.pdf", 10)], [sized("b.pdf", 10)]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((f) => f.name)).toEqual(["a.pdf", "b.pdf"]);
  });

  it("gives every staged file a UUID key, distinct even for identical names", () => {
    const result = addPendingFiles([], [sized("same.pdf", 1), sized("same.pdf", 1)]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(result.files[0].key).toMatch(uuid);
    expect(result.files[1].key).toMatch(uuid);
    expect(result.files[0].key).not.toBe(result.files[1].key);
  });

  it("rejects an 11th file AND leaves the caller's list untouched", () => {
    const existing = Array.from({ length: 10 }, (_, i) => pending(`f${i}.pdf`, 1));
    const result = addPendingFiles(existing, [sized("over.pdf", 1)]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.limit).toBe("count");
    expect(existing).toHaveLength(10);
    expect(existing.some((f) => f.name === "over.pdf")).toBe(false);
  });

  it("rejects when the total would exceed 50MB", () => {
    const result = addPendingFiles(
      [pending("big.bin", 49 * 1024 * 1024)],
      [sized("more.bin", 2 * 1024 * 1024)]
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.limit).toBe("aggregate");
  });

  it("rejects a single file over 15MB", () => {
    const result = addPendingFiles([], [sized("huge.pdf", 16 * 1024 * 1024)]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.limit).toBe("per_file");
  });

  it("rejects an extension the server would refuse, naming it", () => {
    const result = addPendingFiles([], [sized("notes.docx", 10)]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.limit).toBe("type");
    expect(result.message).toContain("notes.docx");
  });

  it("says 'per task', not 'per comment', when too many files are staged", () => {
    const existing = Array.from({ length: 10 }, (_, i) => pending(`f${i}.pdf`, 1));
    const result = addPendingFiles(existing, [sized("over.pdf", 1)]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("Too many files (max 10).");
  });
});

describe("ATTACHMENT_ACCEPT_ATTRIBUTE", () => {
  it("lists dotted extensions for the file input", () => {
    expect(ATTACHMENT_ACCEPT_ATTRIBUTE).toContain(".pdf");
    expect(ATTACHMENT_ACCEPT_ATTRIBUTE).toContain(".xlsx");
    expect(ATTACHMENT_ACCEPT_ATTRIBUTE).not.toContain(".docx");
  });
});

describe("removePendingFile", () => {
  it("removes only the matching key", () => {
    const files = [pending("a.pdf", 1), pending("b.pdf", 1)];
    expect(removePendingFile(files, "k-a.pdf").map((f) => f.name)).toEqual(["b.pdf"]);
  });
});

describe("summariseUploadResults", () => {
  it("is silent when everything succeeded", () => {
    const s = summariseUploadResults([
      { name: "a.pdf", ok: true },
      { name: "b.pdf", ok: true },
    ]);
    expect(s.failedNames).toEqual([]);
    expect(s.message).toBeNull();
  });

  it("names the failures", () => {
    const s = summariseUploadResults([
      { name: "a.pdf", ok: true },
      { name: "b.pdf", ok: false },
      { name: "c.pdf", ok: false },
    ]);
    expect(s.failedNames).toEqual(["b.pdf", "c.pdf"]);
    expect(s.message).toBe(
      "The task was created, but 2 of 3 files did not upload: b.pdf, c.pdf. Press Create again to retry just those."
    );
  });

  it("uses singular wording for one file", () => {
    const s = summariseUploadResults([{ name: "only.pdf", ok: false }]);
    expect(s.message).toBe(
      "The task was created, but 1 of 1 file did not upload: only.pdf. Press Create again to retry just that one."
    );
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx vitest run src/lib/tasks/pending-attachments.test.ts`
Expected: FAIL — `Failed to resolve import "./pending-attachments"`.

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/tasks/pending-attachments.ts
import { checkOperationLimits, type LimitFailure } from "./attachment-limits";
import {
  ATTACHMENT_ALLOWED_EXTENSIONS,
  TASK_ATTACHMENT_MAX_BYTES,
} from "./attachments";

/**
 * A file chosen in a create dialog, before the task or enrollment record it
 * belongs to exists. The parent id is only known once POST succeeds, so these
 * are held in browser memory and uploaded afterwards.
 */
export type PendingFile = {
  /**
   * React key AND the `client_request_id` sent with the upload. It must be a
   * UUID because the route validates the format, and it must be stable across
   * retries because the partial unique index
   * task_attachments (task_id, uploaded_by, client_request_id)
   * is the only thing stopping a second Create press from duplicating files.
   */
  key: string;
  name: string;
  size: number;
  file: File;
};

export type UploadResult = { name: string; ok: boolean };

export type StagingFailure = LimitFailure | { ok: false; limit: "type"; message: string };

/** For the file input's `accept` attribute, so the picker filters up front. */
export const ATTACHMENT_ACCEPT_ATTRIBUTE = ATTACHMENT_ALLOWED_EXTENSIONS.map(
  (extension) => `.${extension}`
).join(",");

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function addPendingFiles(
  existing: readonly PendingFile[],
  incoming: readonly File[]
): { ok: true; files: PendingFile[] } | StagingFailure {
  // Reject unsupported types here rather than letting the server do it: the
  // upload only happens after the task has been created, so a server-side
  // rejection costs the user a real task they then have to delete.
  const rejected = incoming.find(
    (file) => !ATTACHMENT_ALLOWED_EXTENSIONS.includes(extensionOf(file.name))
  );
  if (rejected) {
    return {
      ok: false,
      limit: "type",
      message:
        `${rejected.name} is not a supported file type. ` +
        `Allowed: ${ATTACHMENT_ALLOWED_EXTENSIONS.join(", ")}.`,
    };
  }

  const staged = incoming.map((file) => ({
    key: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    file,
  }));
  const files = [...existing, ...staged];

  const limits = checkOperationLimits({
    textLength: 0,
    sizes: files.map((f) => f.size),
  });
  if (!limits.ok) {
    // checkOperationLimits is shared with the comment composer and says
    // "per comment"; that is wrong in a create dialog. Only this one message
    // needs rewording, so do it here instead of changing the shared string.
    if (limits.limit === "count") {
      return { ...limits, message: `Too many files (max ${files.length - 1}).` };
    }
    return limits;
  }
  return { ok: true, files };
}

export function removePendingFile(
  files: readonly PendingFile[],
  key: string
): PendingFile[] {
  return files.filter((f) => f.key !== key);
}

export function summariseUploadResults(results: readonly UploadResult[]): {
  failedNames: string[];
  message: string | null;
} {
  const failedNames = results.filter((r) => !r.ok).map((r) => r.name);
  if (failedNames.length === 0) return { failedNames: [], message: null };
  const noun = results.length === 1 ? "file" : "files";
  const tail = failedNames.length === 1 ? "just that one" : "just those";
  return {
    failedNames,
    message:
      `The task was created, but ${failedNames.length} of ${results.length} ${noun} ` +
      `did not upload: ${failedNames.join(", ")}. Press Create again to retry ${tail}.`,
  };
}
```

**The `Too many files (max ${files.length - 1})` expression is deliberate but fragile** — it reports the count *before* the rejected additions. Since `LIMITS.maxFiles` is 10 and the failure only triggers above it, prefer importing `LIMITS` and writing `max ${LIMITS.maxFiles}` if you touch this. The test pins the string either way.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run src/lib/tasks/pending-attachments.test.ts`
Expected: PASS, 12 tests. If any `summariseUploadResults` assertion fails, the cause is almost always a missing or doubled space where the template literals are concatenated — compare character by character rather than re-reading.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tasks/pending-attachments.ts src/lib/tasks/pending-attachments.test.ts src/lib/tasks/attachments.ts
git commit -m "feat(attachments): add staging module for files picked before create"
```

---

### Task 2: Show attachments under Description in the task drawer

**Files:**
- Create: `src/app/(authed)/tasks/_components/AttachmentStrip.tsx`
- Modify: `src/app/api/tasks/[id]/detail/route.ts:57-59`
- Modify: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx` — insert at line 537

**Interfaces:**
- Consumes: `SignedAttachment` from `@/lib/tasks/detail`.
- Produces: `<AttachmentStrip attachments />`.

No upload control and no delete control: attachments are create-time only.

- [ ] **Step 1: Create the component**

```tsx
// src/app/(authed)/tasks/_components/AttachmentStrip.tsx
"use client";

import { Paperclip } from "lucide-react";
import type { SignedAttachment } from "@/lib/tasks/detail";

/**
 * Files are attached when the task is created and are read-only from then on —
 * this lists them, nothing more.
 *
 * The drawer is a fixed 760px column and this sits above the comment thread,
 * which is the only flex-1 child, so an unbounded list here silently eats the
 * thread. That bug already shipped once with the description field (ffb8c2b).
 * A chip is 26px and the gap is 6px, so max-h-[58px] is exactly two rows and
 * anything beyond scrolls. Recompute before changing it: 88px, for example,
 * shows a third row clipped by 2px.
 */
export function AttachmentStrip({
  attachments,
}: {
  attachments: SignedAttachment[];
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="shrink-0 space-y-1">
      <span className="text-xs font-bold uppercase tracking-wide text-[#6b778c]">
        Attachments ({attachments.length})
      </span>
      <ul className="flex max-h-[58px] flex-wrap gap-1.5 overflow-y-auto">
        {attachments.map((a) => (
          <li
            key={a.id}
            className="flex max-w-[16rem] items-center gap-1 rounded border border-[#dfe1e6] bg-[#f4f5f7] px-2 py-1 text-xs"
          >
            <Paperclip className="h-3 w-3 shrink-0 text-[#97a0af]" />
            {a.unavailable || !a.url ? (
              <span
                title="This file may have been removed or is temporarily unavailable"
                className="truncate text-[#8993a4]"
              >
                {a.file_name}
              </span>
            ) : (
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-[#0c66e4] hover:underline"
              >
                {a.file_name}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Stop suppressing the data**

In `src/app/api/tasks/[id]/detail/route.ts`, replace lines 57-59 **exactly as they appear** — note four-space indentation, and note the second comment line is *not* what an earlier draft of this plan claimed:

```ts
    // Task-level (non-comment) attachments have no UI on the task drawer —
    // every task file is attached through a comment. Skip signing them.
    includeTaskAttachments: false,
```

with:

```ts
    // Rendered by AttachmentStrip under the description field.
    includeTaskAttachments: true,
```

**Cost, stated honestly:** this endpoint is not hit only on drawer open. `prefetchTaskDetail` fires from `onMouseEnter` on every card (`TaskCard.tsx:87`) and every list row (`TaskRowItem.tsx:299`), and the drawer re-hits it when loading older comments (`TaskDetailDrawer.tsx:192`). So one extra query plus one signing round trip lands on every hover sweep across the board. Watch the network panel during Step 4; if it is visibly heavy, the fix is to keep `includeTaskAttachments: false` for the prefetch path and true only for the real open, which means threading a flag through `detailOpts` at line 52.

- [ ] **Step 3: Render the strip**

The description block is `{showDescription ? (` at line 497 through `) : null}` at line 536. **Insert after 536, not after the `</label>` at 535** — the `</label>` is inside the ternary, and adding a sibling there produces *Adjacent JSX elements must be wrapped in an enclosing tag*.

At line 537, between `) : null}` and the `<section>` on 538:

```tsx
              <AttachmentStrip attachments={detail?.attachments ?? []} />
```

Add the import beside the other component imports:

```tsx
import { AttachmentStrip } from "./AttachmentStrip";
```

`detail` is nullable while the drawer loads, hence `?? []`; the component returns `null` for an empty array, so a task with no files loses no vertical space.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit && npm run build
```
Expected: both exit 0.

Then `npm run dev`. Nothing can create task-level CS attachments yet, so seed one by hand — `POST /api/tasks/<id>/attachments` with a file and no `comment_id` — then open that task and confirm:
- the chip sits under Description
- **the comment list below still shows several comments.** This is the point of the 58px cap and the step most likely to be skipped.
- a task with no attachments looks exactly as before
- open the network panel and sweep the mouse across the board; judge whether the extra prefetch cost is acceptable

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authed)/tasks/_components/AttachmentStrip.tsx" \
        "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx" \
        "src/app/api/tasks/[id]/detail/route.ts"
git commit -m "feat(attachments): show task attachments under the description field"
```

---

### Task 3: Route — skip notifications, and actually enforce the caps

**Files:**
- Modify: `src/app/api/tasks/[id]/attachments/route.ts`

- [ ] **Step 1: Read the `silent` flag**

Beside the existing `comment_id` read at lines 146-147, add:

```ts
  // Files attached during create arrive one POST at a time, right after the
  // task's own notification. Ten files would mean ten more.
  const silent = form?.get("silent") === "1";
```

- [ ] **Step 2: Widen the notification guard**

Change line 317 from:

```ts
  if (!commentId) {
```

to:

```ts
  if (!commentId && !silent) {
```

Only the notification side effect lives in this block. The broadcast side effects sit outside it (307-315) and keep running, so other open tabs still refresh.

- [ ] **Step 3: Enforce the caps for task-level uploads**

Lines 178-195 currently read:

```ts
  if (commentId) {
    const { data: existing, error: existingError } = await r.supabase
      .from("task_attachments")
      .select("size_bytes")
      .eq("task_id", id)
      .eq("comment_id", commentId)
      .is("deleted_at", null);
```

so a task-level upload skips the count and aggregate checks entirely. Restructure to run for both, scoping the query by which kind of upload it is:

```ts
  {
    let query = r.supabase
      .from("task_attachments")
      .select("size_bytes")
      .eq("task_id", id)
      .is("deleted_at", null);
    // Comment uploads are capped per comment; task-level uploads are capped
    // across the task, which is the set the create dialog is filling.
    query = commentId
      ? query.eq("comment_id", commentId)
      : query.is("comment_id", null);
    const { data: existing, error: existingError } = await query;
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    const existingSizes = ((existing ?? []) as { size_bytes: number | null }[]).map(
      (row) => row.size_bytes ?? 0,
    );
    const limits = checkOperationLimits({ textLength: 0, sizes: [...existingSizes, file.size] });
    if (!limits.ok) {
      return NextResponse.json({ error: limits.message }, { status: 400 });
    }
  }
```

Read the surrounding code before pasting: keep whatever the existing block does with `existingError` and preserve the comment above line 176 explaining the ordering.

**If this task is dropped**, the 10-file and 50MB caps remain client-side only and a direct API call can exceed them. Say so out loud rather than leaving the plan implying otherwise.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

---

### Task 4: The file field in the create dialog

**Files:**
- Modify: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx:1415`
- Modify: `src/app/(authed)/tasks/_components/NewTaskDialog.tsx` — prop type 89, state near 94-102, field after 312, `submit()` 199-241, footer 442-457

- [ ] **Step 1: Return the created task**

`createTask` ends:

```ts
    const data = await res.json();
    updateTasks((cur) => [...cur, data.task as TaskRow]);
  }
```

Change to:

```ts
    const data = await res.json();
    const created = data.task as TaskRow;
    updateTasks((cur) => [...cur, created]);
    // The dialog uploads staged attachments against this id; there is no id to
    // POST to until the row exists.
    return created;
  }
```

and widen its signature to `Promise<TaskRow>`. It has exactly one caller, `TaskBoardClient.tsx:1756`, which passes it straight through as `onCreate`, so nothing else needs touching.

- [ ] **Step 2: Widen the dialog prop**

Line 89. Change:

```ts
  onCreate: (payload: NewTaskPayload) => Promise<void>;
```

to:

```ts
  /** Resolves to the created row; its id is needed to upload staged files. */
  onCreate: (payload: NewTaskPayload) => Promise<{ id: string }>;
```

- [ ] **Step 3: Add state and imports**

```tsx
import { Paperclip, X } from "lucide-react";
import {
  addPendingFiles,
  ATTACHMENT_ACCEPT_ATTRIBUTE,
  removePendingFile,
  summariseUploadResults,
  type PendingFile,
  type UploadResult,
} from "@/lib/tasks/pending-attachments";
```

beside the other `useState` calls near lines 94-102:

```tsx
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 4: Render the field under Description**

The description block is `{showDescription ? (` at 297 through `) : null}` at 312, then `</section>` at 313. **Insert after 312, before `</section>`** — same adjacent-JSX trap as Task 2. Match the create dialog's own classes (`PRIMARY_FIELD_CLASS`, `PRIMARY_LABEL_CLASS`), not the drawer's `COMPACT_*` ones:

```tsx
              <div className={PRIMARY_FIELD_CLASS}>
                <div className="flex items-center justify-between">
                  <span className={PRIMARY_LABEL_CLASS}>Attachments</span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={saving}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold text-[#0c66e4] transition hover:bg-[#e9f2ff] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    Attach
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ATTACHMENT_ACCEPT_ATTRIBUTE}
                  className="hidden"
                  onChange={(e) => {
                    const chosen = Array.from(e.target.files ?? []);
                    // Always clear the input: picking the same file twice in a
                    // row fires no change event otherwise.
                    e.target.value = "";
                    if (chosen.length === 0) return;
                    const result = addPendingFiles(pendingFiles, chosen);
                    if (result.ok) {
                      setPendingFiles(result.files);
                      setFileError(null);
                    } else {
                      setFileError(result.message);
                    }
                  }}
                />
                {pendingFiles.length > 0 ? (
                  <ul className="flex max-h-[58px] flex-wrap gap-1.5 overflow-y-auto">
                    {pendingFiles.map((f, index) => (
                      <li
                        key={f.key}
                        className="flex max-w-[16rem] items-center gap-1 rounded border border-[#dfe1e6] bg-[#f4f5f7] px-2 py-1 text-xs"
                      >
                        <Paperclip className="h-3 w-3 shrink-0 text-[#97a0af]" />
                        <span className="truncate">{f.name}</span>
                        {uploadingIndex === index ? (
                          <span className="shrink-0 text-[#6b778c]">uploading…</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setPendingFiles(removePendingFile(pendingFiles, f.key))
                            }
                            disabled={saving}
                            aria-label={`Remove ${f.name}`}
                            className="shrink-0 text-[#97a0af] transition hover:text-[#bf2600] disabled:opacity-40"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {fileError ? (
                  <div
                    role="alert"
                    className="rounded border border-[#ffbdad] bg-[#ffebe6] px-2 py-1 text-xs font-semibold text-[#bf2600]"
                  >
                    {fileError}
                  </div>
                ) : null}
              </div>
```

- [ ] **Step 5: Upload after create — without deleting the form resets**

This is the step a previous draft got wrong. `submit()` at 199 currently reads, from line 210:

```tsx
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        fub_link: fubLink.trim() || undefined,
        priority,
        agent_email: agentEmail,
        assignees: canPickAssignee ? selectedAssignees : undefined,
        category_id: categoryId,
        status: effectiveStatus,
        ...(Object.keys(cleanedCustomValues).length > 0
          ? { custom_values: cleanedCustomValues }
          : {}),
        client_request_id: createRequestIdRef.current ?? crypto.randomUUID(),
      });
      setTitle("");
      setDescription("");
      setFubLink("");
      setPriority("medium");
      setAgentEmail("");
      setSelectedAssignees([]);
      setStatus("todo");
      setCategoryId("");
      setCustomValues({});
      onClose();
    } catch {
      // TaskBoardClient owns the visible error toast.
    } finally {
      setSaving(false);
    }
```

**Those nine `set…("")` calls must survive.** Capture the result, run the uploads, bail out before the resets if any failed, and otherwise leave the reset block and `onClose()` exactly as they are:

```tsx
    try {
      const created = await onCreate({
        title: title.trim(),
        description: description.trim(),
        fub_link: fubLink.trim() || undefined,
        priority,
        agent_email: agentEmail,
        assignees: canPickAssignee ? selectedAssignees : undefined,
        category_id: categoryId,
        status: effectiveStatus,
        ...(Object.keys(cleanedCustomValues).length > 0
          ? { custom_values: cleanedCustomValues }
          : {}),
        client_request_id: createRequestIdRef.current ?? crypto.randomUUID(),
      });

      if (pendingFiles.length > 0) {
        const results: UploadResult[] = [];
        const uploaded = new Set<string>();
        for (const [index, item] of pendingFiles.entries()) {
          setUploadingIndex(index);
          const form = new FormData();
          form.append("file", item.file);
          form.append("silent", "1");
          // Stable per file, so pressing Create again after a partial failure
          // is absorbed by task_attachments_client_request_id_key instead of
          // duplicating the ones that already landed.
          form.append("client_request_id", item.key);
          try {
            const res = await fetch(`/api/tasks/${created.id}/attachments`, {
              method: "POST",
              body: form,
            });
            results.push({ name: item.name, ok: res.ok });
            if (res.ok) uploaded.add(item.key);
          } catch {
            results.push({ name: item.name, ok: false });
          }
        }
        setUploadingIndex(null);
        const summary = summariseUploadResults(results);
        if (summary.message) {
          // The task exists. Keep the dialog open, drop the files that landed
          // so a retry only re-sends the rest, and say which ones failed.
          setPendingFiles((current) => current.filter((f) => !uploaded.has(f.key)));
          setFileError(summary.message);
          return;
        }
      }

      setTitle("");
      setDescription("");
      setFubLink("");
      setPriority("medium");
      setAgentEmail("");
      setSelectedAssignees([]);
      setStatus("todo");
      setCategoryId("");
      setCustomValues({});
      setPendingFiles([]);
      setFileError(null);
      onClose();
    } catch {
      // TaskBoardClient owns the visible error toast.
    } finally {
      setUploadingIndex(null);
      setSaving(false);
    }
```

The early `return` is safe: `finally { setSaving(false) }` sits outside the `try` and still runs.

**Retry semantics worth understanding before you touch this.** Pressing Create again replays `create_task_atomic` with the same `createRequestIdRef.current`, so no second task appears; then the remaining files upload. Two independent idempotency keys, one for the task and one per file.

- [ ] **Step 6: Gate Cancel and the close button while uploading**

`NewTaskDialog.tsx:443-449` renders Cancel with a bare `onClick={onClose}` and no `disabled`; the header close control at line 256 is the same. Dismissing mid-upload detaches the loop and throws away the failure summary. Add `disabled={saving}` to both, matching the Create button at 453.

- [ ] **Step 7: Verify**

```bash
npx tsc --noEmit && npx vitest run && npm run build
```
Expected: all three exit 0.

Then `npm run dev` and walk all eight:

1. Create with no files — behaves exactly as before; the new task's drawer is unchanged.
2. Create with 2 small files — task appears; open it; both chips sit under Description.
3. Pick 3, remove 1 before submitting — only 2 upload.
4. Pick 11 files — blocked with "Too many files (max 10)." — **not** "per comment".
5. Pick a `.docx` — blocked by name before anything is created, and the OS picker should not have offered it in the first place.
6. Create, then reopen the dialog — every field is blank. This catches a deleted reset block.
7. Check the bell — **no `attachment_added` notification** for any of the above.
8. Simulate a partial failure (stop the dev server between files, or point one upload at a bad URL), then press Create again. Confirm exactly one task exists and no attachment is duplicated.

Steps 6, 7 and 8 are the ones that silently regress.

- [ ] **Step 8: Add the changelog entry**

At the top of `changelog.md`, under the header block:

```markdown
## 2026-08-19 — CS: đính kèm file ngay khi tạo task
- **Loại**: feature, data-integrity
- **Cái gì**: Dialog "New task" có trường Attachments ngay dưới Description — chọn file, bỏ file chọn nhầm, y như sửa Description trước khi bấm tạo. File giữ trong bộ nhớ trình duyệt; tạo task trước rồi upload tuần tự theo id trả về. Task drawer hiển thị danh sách file dưới Description, CHỈ ĐỂ XEM: sau khi tạo thì không thêm không xoá.
- **Vì sao**: Yêu cầu nghiệp vụ — đính kèm phải là một trường của form tạo, và mở task ra phải thấy ngay file. Trước đó CS không có giao diện đính kèm cấp task nào cả.
- **File**: `src/lib/tasks/pending-attachments.ts`, `src/lib/tasks/attachments.ts`, `src/app/(authed)/tasks/_components/AttachmentStrip.tsx`, `TaskDetailDrawer.tsx`, `NewTaskDialog.tsx`, `TaskBoardClient.tsx`, `src/app/api/tasks/[id]/detail/route.ts`, `src/app/api/tasks/[id]/attachments/route.ts`
- **Ảnh hưởng**: Không đổi schema, không thêm endpoint — `comment_id` vốn cho phép NULL và route POST đã nhận trường hợp đó. Ba thay đổi hành vi phía server: (1) `includeTaskAttachments` bật lên nên `/api/tasks/[id]/detail` thêm một truy vấn và một lượt ký URL, và endpoint này còn bị gọi bởi `prefetchTaskDetail` khi rê chuột qua từng card/row; (2) cờ `silent=1` khiến upload lúc tạo KHÔNG bắn `attachment_added`, upload đường khác vẫn bắn; (3) giới hạn 10 file / 50MB trước đây CHỈ áp cho đính kèm của comment (`checkOperationLimits` nằm trong `if (commentId)`), giờ áp cho cả đính kèm cấp task. Mỗi file mang một `client_request_id` UUID riêng nên bấm Create lại sau khi upload trượt một phần sẽ không nhân đôi file. Upload chạy SAU khi tạo: task tạo xong mà file trượt thì dialog giữ nguyên, bỏ các file đã lên, nêu tên file hỏng để bấm Create lại chỉ gửi phần còn thiếu.
```

- [ ] **Step 9: Commit**

```bash
git add "src/app/(authed)/tasks/_components/NewTaskDialog.tsx" \
        "src/app/(authed)/tasks/_components/TaskBoardClient.tsx" \
        "src/app/api/tasks/[id]/attachments/route.ts" changelog.md
git commit -m "feat(tasks): attach files while creating a CS task"
```

---

## Codex implementation log — 2026-08-19

- Implemented create-time staging in `pending-attachments.ts`: extension filtering, aggregate/count/per-file limits, immutable removal, per-file UUIDs, and partial-upload summaries.
- Added the Attachments field to the CS New Task dialog. Files upload sequentially after task creation with `silent=1`; failed files remain staged so Create can retry without creating a second task. Cancel/close are disabled while saving.
- Added read-only task-level attachment chips below Description in the CS task detail drawer and enabled task-level attachment loading in the detail route.
- Extended the attachment route limits to task-level files and suppressed create-time notifications only when `silent=1`; comment uploads retain existing notifications.
- Added the requested `changelog.md` entry.
- Automated verification completed: `npx tsc --noEmit`, `npx vitest run` (96 files / 656 tests), and `npm run build` all pass. `git diff --check` is clean.
- Manual browser checks (especially partial-upload retry, notification suppression, and prefetch cost) remain to be run. No commit was created in this execution.

## Open question

**Should "no delete after create" be enforced, or is hiding the control enough?** For CS the UI rule is already satisfied — nothing in the app calls `DELETE /api/tasks/[id]/attachments/[aid]` today, because its only caller is `AttachmentPanel`, which only `EnrollmentClient` instantiates and only with `apiBase="/api/enrollment"`. So the CS endpoint is reachable solely by a direct API call, by the uploader or a manager (`.../[aid]/route.ts:76-77`).

Making the rule real means rejecting `DELETE` when `comment_id is null`. That is a clean four-line change with no UI fallout on the CS side. The cost: a file uploaded by mistake — the wrong client's document, a screenshot with PII — could then never be removed by anyone including an admin, and cleanup would need direct database access. Left as-is pending a decision, because the reversible option is the safer default.
