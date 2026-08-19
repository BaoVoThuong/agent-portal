# Enrollment — Attach Files While Creating a Record

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make attachments a field of the "New enrollment" form, exactly like Description — pick files while creating the record, drop any picked by mistake before submitting — and show the resulting files in the record drawer directly beneath the Description field.

**Architecture:** No new API endpoint. `enrollment_attachments.comment_id` is already nullable and NULL there already means "attached to the record itself"; `POST /api/enrollment/[id]/attachments` already creates that row when the `comment_id` form field is omitted. Since there is no record id until the record exists, the dialog holds the chosen files in browser memory, creates the record, then uploads them against the id that comes back. One small schema addition is proposed in Task 3 and is the only database change; it is optional and the trade-off is spelled out there.

**Tech Stack:** Next.js 16.2.4 App Router, React client components, Tailwind v4 (no config file — arbitrary values like `max-h-[58px]` are read straight from source), Supabase Storage, vitest 2.1.9.

## Prerequisites

**Do `2026-08-19-cs-task-attachments.md` first.** It creates `src/lib/tasks/pending-attachments.ts` and `src/app/(authed)/tasks/_components/AttachmentStrip.tsx`, which this plan reuses unchanged, and it exports `ATTACHMENT_ALLOWED_EXTENSIONS` from `src/lib/tasks/attachments.ts`. If it has not been done, build those three from that plan's Tasks 1 and 2 first.

**Do `2026-08-19-enrollment-drawer-fixes.md` first as well.** Its Task 4 caps the Description height. This plan stacks a file strip directly beneath that field in a fixed-height drawer; doing so above an uncapped, auto-growing Description reproduces the bug commit `ffb8c2b` fixed for CS.

## Scope

**In:** the create dialog gains a file field; the drawer shows the files under Description.

**Out:** uploading from the drawer after the record exists, and deleting anything after it exists. Files are set once, at creation, and are read-only thereafter.

## Global Constraints

- **UI copy is English only.** Code comments may stay Vietnamese; anything a user reads may not.
- **Test harness cannot render components.** `vitest.config.ts` sets `environment: "node"` and `include: ["src/**/*.test.ts"]`; there is no jsdom, and `.tsx` is not collected. All testable logic lives in `pending-attachments.ts`, already covered by the CS plan. This plan adds no new tests, which is a consequence of the harness, not an oversight.
- **`TASK_ATTACHMENT_MAX_BYTES` is 15MB** (`src/lib/tasks/attachments.ts:1`). `LIMITS.maxFiles` is 10 and `LIMITS.maxAggregateBytes` is 50MB.
- **Every logic change gets a `changelog.md` entry** in the same turn, newest at top.
- **Do not commit or push without being asked.** Each commit and each push is a separate request, and the remote must be named: `origin` is BaoVoThuong/agent-portal, `vercel` is the separate repo eps-portal.vercel.app deploys from.

## Verified starting state

Confirmed against commit `bc27874`.

| Thing | Where |
|---|---|
| `enrollment_attachments.comment_id` nullable; NULL = record-level | `supabase/schema.sql:5179` |
| `GET .../attachments` filters `.is("comment_id", null)` | `src/app/api/enrollment/[id]/attachments/route.ts:47` |
| `POST .../attachments` reads an optional `comment_id` | same file, 91 |
| Per-file 15MB check | same file, 84 |
| Plain `.insert({...})`, not an atomic RPC | same file, 168-170 |
| Notification fired only when `comment_id` is null | same file, 199-225 |
| `loadEnrollmentAttachments` — record-level, unconditional | `src/lib/enrollment/detail.ts:167-181`, called at 203 |
| `EnrollmentSignedAttachment` structurally identical to `SignedAttachment` | `src/lib/enrollment/types.ts` vs `src/lib/tasks/detail.ts:9-16` |
| `createRecord` | `EnrollmentClient.tsx:1132`, `setOpenId` at 1153 |
| Dialog mount + `onCreate` wrapper | `EnrollmentClient.tsx:1343-1360` |
| `NewEnrollmentDialog` | 3558, `onCreate` prop type 3583, submit body 3705-3728 |
| Description `<label>` in the drawer — **unconditional**, no `showDescription` ternary | 3153-3165, tab `<section>` opens at 3167 |

**Three things that differ from the CS side and drive this plan's design:**

1. **The dialog does not close itself.** `EnrollmentClient.tsx:1354-1357`:
   ```tsx
             onCreate={async (payload) => {
               await createRecord(payload);
               setCreating(false);
             }}
   ```
   `NewEnrollmentDialog.submit()` (3705-3728) has no `onClose()` and no form resets — it just awaits `onCreate` and has `finally { setSaving(false) }`. So a `setFileError(...)` after `onCreate` would run on an unmounted component and show nothing. Task 4 moves closing into the dialog.
2. **The route has no `checkOperationLimits` at all.** Only the per-file 15MB check at line 84. The 10-file and 50MB caps exist nowhere on this server.
3. **The route has no `client_request_id`, and `enrollment_attachments` has no unique index for one.** The CS trick that makes a retry idempotent per file does not exist here. Task 3 addresses this.

## Design decisions

**Upload happens after create.** There is no record id until the row exists and the route requires one in its path. A staging bucket or a multipart create endpoint would both add server surface and a new class of orphaned-blob bug.

**Uploads are sequential** — not because the server serialises anything (it does not) but because ten parallel `fetch` calls each buffering up to 15MB is a lot of memory for no benefit, and "file 3 of 7 failed" only reads sensibly in order.

**Do not notify.** The route notifies on every record-level upload (199-225). Ten files at create time would mean ten notifications per recipient on top of the record's own, into a notification load already judged too noisy. Task 3 adds a `silent` flag.

**The Attachments field is not gated on any column config.** The drawer's Description `<label>` at 3153 is unconditional, so there is no `showDescription` equivalent to mirror here — unlike CS, where both call sites sit inside `{showDescription ? …}`.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/app/api/enrollment/[id]/attachments/route.ts` | modify | `silent` flag; enforce the caps; optionally accept `client_request_id`. |
| `supabase/rollouts/2026-08-19-enrollment-attachment-idempotency.sql` | **create**, optional | Column + partial unique index for per-file idempotency. |
| `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | modify | Render the strip; `createRecord` returns the record; the wrapper stops closing the dialog; `NewEnrollmentDialog` gains the file field. |
| `changelog.md` | modify | One entry. |

---

### Task 1: Show attachments under Description in the drawer

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` — insert at line 3166

**Interfaces:**
- Consumes: `AttachmentStrip` from the CS plan.

- [ ] **Step 1: Render the strip**

The Description `<label>` runs 3153-3165 and is **not** wrapped in a ternary, so inserting a sibling immediately after it is safe — no adjacent-JSX hazard. Between line 3165 (`</label>`) and 3167 (`<section>`), insert:

```tsx
                <AttachmentStrip attachments={detail?.attachments ?? []} />
```

Add the import beside the other component imports at the top of the file:

```tsx
import { AttachmentStrip } from "../../tasks/_components/AttachmentStrip";
```

Note the container is a `<label className={COMPACT_DETAIL_FIELD_CLASS}>`, not the `FieldBlock` component — `FieldBlock` is defined at 4418 and used in the right-hand `<aside>`. Do not go looking for it here.

`detail` is nullable while the drawer loads, hence `?? []`; the component returns `null` for an empty array, so a record with no files loses no vertical space.

**Type note:** `AttachmentStrip` declares `attachments: SignedAttachment[]` from `@/lib/tasks/detail`, but receives `EnrollmentSignedAttachment[]`. The two are structurally identical today so this compiles. If they ever diverge, this call site is what breaks, silently — if that bothers you, widen the prop to a local structural type rather than importing either name.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npm run build
```
Expected: both exit 0.

Then `npm run dev`, open a record that already has record-level attachments (created via the old Files tab, or seeded by hand), and confirm the chips appear under Description **and the comment list below still shows several comments**. That second half is the point of the strip's 58px cap and is the step most likely to be skipped.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"
git commit -m "feat(attachments): show enrollment attachments under the description field"
```

---

### Task 2: Route — skip notifications and enforce the caps

**Files:**
- Modify: `src/app/api/enrollment/[id]/attachments/route.ts`

- [ ] **Step 1: Read the `silent` flag**

Beside the existing `comment_id` read at line 91, add:

```ts
  // Files attached during create arrive one POST at a time, right after the
  // record's own notification. Ten files would mean ten more.
  const silent = form?.get("silent") === "1";
```

- [ ] **Step 2: Suppress only the notification, never the activity row**

The activity insert at 200-206 is a durable audit record and must keep running. Narrow the guard to the notification recipients — change:

```ts
    const recipients = uniqueEnrollmentNotificationRecipients(
      [context.record.caller_email, context.record.responsible_enroll_email],
      [context.actor.email]
    );
```

to:

```ts
    const recipients = silent
      ? []
      : uniqueEnrollmentNotificationRecipients(
          [context.record.caller_email, context.record.responsible_enroll_email],
          [context.actor.email]
        );
```

`insertEnrollmentNotifications` returns early on an empty array (`src/lib/enrollment/notifications.ts:18`), so this is a clean no-op rather than an empty insert. Confirm that early return still exists before relying on it; if it has changed, wrap the whole `try` in `if (!silent) { … }` instead and leave the activity insert outside.

- [ ] **Step 3: Enforce the file caps**

The route checks only per-file size (line 84). Add the count and aggregate checks that the CS route has, scoped by upload kind. After the per-file check and before the upload:

```ts
  {
    let query = context.supabase
      .from("enrollment_attachments")
      .select("size_bytes")
      .eq("record_id", id);
    // Comment uploads are capped per comment; record-level uploads are capped
    // across the record, which is the set the create dialog is filling.
    query = commentId
      ? query.eq("comment_id", commentId)
      : query.is("comment_id", null);
    const { data: existing, error: existingError } = await query;
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    const existingSizes = ((existing ?? []) as { size_bytes: number | null }[]).map(
      (row) => row.size_bytes ?? 0
    );
    const limits = checkOperationLimits({ textLength: 0, sizes: [...existingSizes, file.size] });
    if (!limits.ok) {
      return NextResponse.json({ error: limits.message }, { status: 400 });
    }
  }
```

Import `checkOperationLimits` from `@/lib/tasks/attachment-limits`. Check whether this table has a soft-delete column before writing the query — the CS equivalent filters `.is("deleted_at", null)`; if `enrollment_attachments` has no such column, omit that filter rather than inventing it.

**If this step is dropped**, the 10-file and 50MB caps stay client-side only and a direct API call can exceed them. Say so out loud rather than leaving the plan implying otherwise.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

---

### Task 3: Decide about per-file idempotency

**This task is a decision, not a fixed edit.** Read it before Task 4, because Task 4's retry behaviour depends on the answer.

**The problem.** On the CS side each staged file carries a UUID sent as `client_request_id`, and a partial unique index on `(task_id, uploaded_by, client_request_id)` makes a repeated upload a no-op. Enrollment has **neither** — no such column on `enrollment_attachments`, no such index, and the route never reads such a field. So if a file's upload commits on the server but the response is lost (a dropped connection, a timeout), the client records it as failed and a retry uploads it a second time, producing a duplicate row and a duplicate blob.

Task 4 keeps an `uploaded` set of files that returned `res.ok`, which covers the ordinary case — an HTTP 4xx/5xx, or the server never receiving the request. The gap is narrow: committed-but-unacknowledged.

**Option A — accept the gap.** No database change. Duplicates are possible only in that narrow window, and the remedy today would be manual. This keeps the plan free of schema changes.

**Option B — close it.** Add the column and index, and have the route read the field:

```sql
-- supabase/rollouts/2026-08-19-enrollment-attachment-idempotency.sql
alter table public.enrollment_attachments
  add column if not exists client_request_id uuid;

create unique index if not exists enrollment_attachments_client_request_id_key
  on public.enrollment_attachments (record_id, uploaded_by, client_request_id)
  where client_request_id is not null;
```

then in the route, mirror `src/app/api/tasks/[id]/attachments/route.ts:149-153` to read and UUID-validate the field, include it in the `.insert({...})` at 168, and treat a unique-violation (`23505`) as success rather than an error. Verify the SQL against the notes in `supabase/APPLIED.md` before running it — Supabase Studio wraps every submission in a transaction and never displays `RAISE NOTICE`.

**Recommended: Option B**, because Task 4 tells the user to "press Create again to retry" and that instruction is only safe if retrying is safe. If Option A is chosen, change Task 4's failure message to say the record was created without those files and must be recreated, and drop the retry wording.

- [ ] **Step 1: Choose A or B and record the choice here**
- [ ] **Step 2: If B, write and run the rollout, then update the route**
- [ ] **Step 3: If A, adjust the Task 4 failure copy accordingly**

---

### Task 4: The file field in the create dialog

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` — `createRecord` 1132-1158, the dialog mount 1343-1360, `onCreate` prop type 3583, `NewEnrollmentDialog` state and JSX, submit body 3705-3728

**Interfaces:**
- Consumes: `addPendingFiles`, `removePendingFile`, `summariseUploadResults`, `ATTACHMENT_ACCEPT_ATTRIBUTE`, `PendingFile`, `UploadResult` from `@/lib/tasks/pending-attachments`.

- [ ] **Step 1: Return the created record**

`createRecord` currently ends:

```ts
      updateRecords((current) => [data.record!, ...current]);
      setOpenId(data.record.id);
      writeEnrollmentDeepLink(data.record.id, "push");
    } finally {
      finishPendingMutation();
    }
```

Two changes. Return the record, and **stop opening the drawer here** — lines 1153-1154 currently mount the drawer immediately, so with uploads running afterwards the user sees a drawer with no files until they reload by hand:

```ts
      updateRecords((current) => [data.record!, ...current]);
      // Opening the drawer moved to the dialog's caller: it must happen after
      // the staged attachments have uploaded, or the drawer mounts and fetches
      // its detail while the files are still in flight and shows none of them.
      return data.record;
    } finally {
      finishPendingMutation();
    }
```

Widen the signature to `Promise<EnrollmentRecordWithStats>`.

- [ ] **Step 2: Move closing and drawer-opening into the caller, after uploads**

The mount at 1343-1360 currently is:

```tsx
          onClose={() => setCreating(false)}
          onCreate={async (payload) => {
            await createRecord(payload);
            setCreating(false);
          }}
```

The `setCreating(false)` unmounts the dialog the instant `createRecord` resolves, so anything the dialog does afterwards — including reporting a failed upload — is invisible. Replace with:

```tsx
          onClose={() => setCreating(false)}
          onCreate={(payload) => createRecord(payload)}
          onCreated={(record) => {
            setCreating(false);
            setOpenId(record.id);
            writeEnrollmentDeepLink(record.id, "push");
          }}
```

The dialog now decides when it is finished, and only then does the drawer open.

- [ ] **Step 3: Update the dialog's props**

Line 3583. Change:

```ts
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
```

to:

```ts
  /** Resolves to the created record; its id is needed to upload staged files. */
  onCreate: (payload: Record<string, unknown>) => Promise<{ id: string }>;
  /** Called once creation AND attachment upload have both finished. */
  onCreated: (record: { id: string }) => void;
```

and add `onCreated` to the destructured parameter list.

- [ ] **Step 4: Add state and imports**

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

beside the dialog's other `useState` calls:

```tsx
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 5: Render the field under Description**

Place it directly beneath the dialog's Description control, and use the same wrapper class its siblings use rather than a bare `<div>` — grep the surrounding JSX for the field wrapper class in this dialog and match it, so the new field lines up with the rest of the column.

```tsx
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide text-[#6b778c]">
                    Attachments{pendingFiles.length > 0 ? ` (${pendingFiles.length})` : ""}
                  </span>
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
                    // Always clear: picking the same file twice in a row fires
                    // no change event otherwise.
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
```

**Do not add a third error surface.** This dialog already renders errors in two places — the header area and the main column. Route `fileError` into whichever of those the user actually looks at, via the existing `setError`, or render it directly under this field and accept that there are now two. Decide deliberately; the previous draft of this plan quietly created a third.

- [ ] **Step 6: Upload after create, in `submit()`**

The body at 3705-3728 ends:

```tsx
      await onCreate(payload);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create record.");
    } finally {
      setSaving(false);
    }
```

Replace the `await onCreate(payload);` line with:

```tsx
      const created = await onCreate(payload);

      if (pendingFiles.length > 0) {
        const results: UploadResult[] = [];
        const uploaded = new Set<string>();
        // Sequential: ten parallel fetches each buffering up to 15MB is a lot
        // of memory for no benefit, and partial reporting only reads in order.
        for (const [index, item] of pendingFiles.entries()) {
          setUploadingIndex(index);
          const form = new FormData();
          form.append("file", item.file);
          form.append("silent", "1");
          // Only meaningful if Task 3 Option B was taken; harmless otherwise.
          form.append("client_request_id", item.key);
          try {
            const res = await fetch(`/api/enrollment/${created.id}/attachments`, {
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
          // The record exists. Keep the dialog open, drop the files that landed
          // so a retry only re-sends the rest, and name the ones that failed.
          setPendingFiles((current) => current.filter((f) => !uploaded.has(f.key)));
          setFileError(summary.message);
          return;
        }
      }

      setPendingFiles([]);
      setFileError(null);
      onCreated(created);
```

`summariseUploadResults` says "The task was created…" — it is shared with the CS plan. Either parameterise the noun there, or accept the wording. Do not fork the function.

The early `return` is safe: `finally { setSaving(false) }` sits outside the `try` at 3725-3727 and still runs.

- [ ] **Step 7: Gate the dismiss controls while uploading**

Cancel and the header close control call `onClose` with no `disabled`. Dismissing mid-upload detaches the loop and discards the failure summary. Add `disabled={saving}` to both, matching the Create button.

- [ ] **Step 8: Verify**

```bash
npx tsc --noEmit && npx vitest run && npm run build
```
Expected: all three exit 0.

Then `npm run dev` and walk all nine, on **both** an ACA record and a Medicare record — `submit()` strips Medicare-inapplicable fields at 3710-3721 and that path must not regress:

1. Create with no files — behaves exactly as before, and the drawer opens as it always did.
2. Create with 2 small files — record appears, drawer opens, **both chips are visible under Description without a manual reload**. This is the whole point of moving `setOpenId` in Step 1.
3. Pick 3, remove 1 before submitting — only 2 upload.
4. Pick 11 files — blocked with "Too many files (max 10)."
5. Pick a `.docx` — blocked by name before anything is created; the OS picker should not have offered it.
6. Check the bell — **no `attachment_added` notification** for any of the above.
7. Cancel mid-upload — the button is disabled; it cannot be done.
8. Simulate a partial failure, then press Create again. Confirm exactly one record exists and no attachment is duplicated. If Task 3 Option A was chosen, confirm the message tells the user to recreate rather than retry.
9. Post a comment with a file attached — the comment path still works and is unaffected by the route changes.

Steps 2, 6 and 8 are the ones that silently regress.

- [ ] **Step 9: Add the changelog entry**

At the top of `changelog.md`, under the header block:

```markdown
## 2026-08-19 — Enrollment: đính kèm file ngay khi tạo record
- **Loại**: feature, data-integrity
- **Cái gì**: Dialog "New enrollment" có trường Attachments ngay dưới Description — chọn file, bỏ file chọn nhầm, y như sửa Description trước khi bấm Create. File giữ trong bộ nhớ trình duyệt; tạo record trước rồi upload tuần tự theo id trả về. Drawer hiển thị danh sách file dưới Description, CHỈ ĐỂ XEM: sau khi tạo thì không thêm không xoá.
- **Vì sao**: Yêu cầu nghiệp vụ — đính kèm phải là một trường của form tạo, và mở record ra phải thấy ngay file.
- **File**: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, `src/app/api/enrollment/[id]/attachments/route.ts`, dùng lại `src/lib/tasks/pending-attachments.ts` và `AttachmentStrip.tsx` từ phần CS
- **Ảnh hưởng**: Ba thay đổi hành vi phía server: (1) cờ `silent=1` khiến upload lúc tạo KHÔNG bắn `attachment_added`, upload đường khác vẫn bắn, dòng activity vẫn ghi bình thường; (2) giới hạn 10 file / 50MB trước đây KHÔNG tồn tại ở route này (chỉ có kiểm tra 15MB mỗi file), giờ đã áp cho cả đính kèm cấp record lẫn cấp comment; (3) nếu chọn Option B ở Task 3 thì thêm cột `client_request_id` và chỉ số duy nhất để bấm Create lại không nhân đôi file. Phía client: `createRecord` không còn tự mở drawer — việc đó dời xuống sau khi upload xong, nếu không drawer mở ra lúc file còn đang bay và hiển thị rỗng. Upload chạy SAU khi tạo: record tạo xong mà file trượt thì dialog giữ nguyên, bỏ các file đã lên, nêu tên file hỏng.
```

- [ ] **Step 10: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx" \
        "src/app/api/enrollment/[id]/attachments/route.ts" changelog.md
git commit -m "feat(enrollment): attach files while creating a record"
```

---

## Open question

**Should "no delete after create" be enforced, or is hiding the control enough?** After `2026-08-19-enrollment-drawer-fixes.md` removes the Files tab, **nothing in the app calls `DELETE /api/enrollment/[id]/attachments/[aid]`**. Its only caller was `AttachmentPanel.remove()` (`AttachmentPanel.tsx:76`), and `EnrollmentClient` was the only component that instantiated it. `CommentThread` never did — its only DELETE is `comments/${id}` (`CommentThread.tsx:791`).

So the endpoint is reachable solely by direct API call, by the uploader or a manager (`.../[aid]/route.ts:42`). Making the rule real means rejecting `DELETE` when `comment_id is null` — a clean four-line change with no UI fallout on either module. The cost: a file uploaded by mistake — the wrong client's document, a screenshot with PII — could then never be removed by anyone including an admin, and cleanup would need direct database access. Left as-is pending a decision, because the reversible option is the safer default.
