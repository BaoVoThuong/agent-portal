# Task Comments, Attachments, and Activity Hardening Plan

> **Handoff context:** This is an audit and implementation plan, not authorization to start
> changing code. It was written against `HEAD 78208aa` on 2026-08-09. Before execution, re-read
> the current source and preserve unrelated worktree changes. Execute one task at a time, make
> one focused commit per task, and record the commit ID plus verification result in the Execution
> Log. The shared comment UI work specified in this document is in scope; do not combine it with
> unrelated permission, Enrollment business-rule, or architecture work.

> **[[Claude] — Review verdict, 2026-08-09]**
> I independently re-verified this audit against the working tree at `HEAD 78208aa` (the commit
> this plan names — it is still `HEAD`). I spot-checked 20 of the 24 findings down to the exact
> source lines. **No finding was found to be wrong.** F1, F2, F3, F5, F7, F8, F9, F10, F11, F13,
> F15, F16, F19, F20, F21, F22, and F23 reproduce exactly as written, including the cited
> behaviour. F4's *code* claim is confirmed (no in-flight guard, no request ID); its *data* claim
> (two duplicate groups) comes from a read-only DB query I cannot re-run here — treat it as a
> point-in-time observation and re-confirm before acting on it. F6, F12, F17, F18 were checked
> only for consistency with the surrounding code, not line-by-line.
>
> One finding I deliberately tried to break: **F14's severity.** I suspected the activity types
> the renderer handles but the `task_activity_type_check` constraint forbids (`field_changed`,
> `people_changed`, `archived`, `qc_needed`, `due_soon`, `stale`, `stage_changed`) were actually
> being inserted and silently failing — which would make F14 a live P1, not a P3. They are not:
> those writers target `enrollment_activity` and `task_notifications`, never `task_activity`.
> **F14's P3 rating is correct.** The renderer branches are dead code, not a live failure.
>
> The §5 severity arithmetic also checks out: P1=2, P2=13 (F3–F13 = 11, plus F19, F20), P3=9
> (F14–F18 = 5, plus F21–F24 = 4), total 24.
>
> The remaining `[[Claude]]` comments in this document mark **defects in the plan itself**, not in
> the audit. The one that changes scope is the Enrollment gap at Task 3 — read that before
> starting.

## 1. Objective and product context

The reviewed subsystem is the Health Customer Service task collaboration flow:

```text
Task drawer
  -> comment/reply/edit/delete
  -> optional one-or-many attachment uploads
  -> task_comments / task_comment_edits / task_attachments
  -> task_activity + task last-activity/version fields
  -> participant visibility + notifications
  -> room/global realtime broadcasts
  -> task list counters and "last activity by"
```

The production requirement is stronger than “the UI eventually refreshes.” Once the server has
committed a comment or file, the API must not report the whole action as failed. A retry must not
create a duplicate. A storage failure must not leave a metadata row that prevents the task drawer
from opening. The activity trail must describe the canonical change, be written atomically with
that change where possible, and agree with the list's last-activity fields.

`CommentThread.tsx` is shared by Tasks and Enrollment. Client-side changes in this plan must be
regression-tested in ACA and Medicare. The display-name and edit-history response contracts must
also be implemented consistently by both Task and Enrollment detail APIs, because a shared UI
cannot guarantee name-only rendering when either API returns email-only identities. This plan does
not authorize a rewrite of Enrollment business rules or Enrollment activity storage. The Task API
and Task schema remain the primary correctness scope.

## 2. Audit method and evidence

### 2.1 Code paths reviewed

- `src/app/(authed)/tasks/_components/CommentThread.tsx`
- `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`
- `src/app/(authed)/tasks/_components/ActivityFeed.tsx`
- `src/app/(authed)/tasks/_components/AttachmentPanel.tsx`
- `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- `src/app/api/tasks/[id]/comments/route.ts`
- `src/app/api/tasks/[id]/comments/[cid]/route.ts`
- `src/app/api/tasks/[id]/comments/[cid]/edits/route.ts`
- `src/app/api/tasks/[id]/attachments/route.ts`
- `src/app/api/tasks/[id]/attachments/[aid]/route.ts`
- `src/app/api/tasks/[id]/detail/route.ts`
- `src/app/api/tasks/[id]/activity/route.ts`
- `src/app/api/enrollment/[id]/detail/route.ts`
- `src/app/api/enrollment/[id]/comments/[cid]/edits/route.ts`
- `src/app/api/tasks/[id]/route.ts`
- `src/app/api/tasks/[id]/assignees/[email]/route.ts`
- `src/app/api/tasks/route.ts`
- `src/app/api/cron/check-overdue/route.ts`
- `src/lib/tasks/detail.ts`
- `src/lib/tasks/storage.ts`
- `src/lib/tasks/attachments.ts`
- `src/lib/tasks/activity.ts`
- `src/lib/tasks/last-activity.ts`
- `src/lib/tasks/notifications.ts`
- `src/lib/tasks/participants.ts`
- `src/lib/tasks/queries.ts`
- `src/lib/tasks/detail-cache.ts`
- `src/lib/tasks/people.ts`
- `src/lib/tasks/assignees.ts`
- `src/lib/enrollment/detail.ts`
- `src/lib/enrollment/types.ts`
- `src/lib/ui/option-search.ts`
- relevant tables, functions, constraints, and indexes in `supabase/schema.sql`

> **[[Claude]]** `src/lib/ui/option-search.ts` is not part of this subsystem — it was created by a
> *different* plan (`2026-08-09-searchable-dynamic-dropdowns.md`) that landed just before this one.
> Listing it here as a reviewed path hides the fact that **F21 and Task 12 have a hard cross-plan
> dependency on it**. Verified present at `HEAD 78208aa`, exporting `normalizeOptionSearchText`,
> `filterSearchableChoices`, `initialEnabledChoiceIndex`, and `moveEnabledChoiceIndex` — so the
> dependency is currently satisfiable. Declare it explicitly: if that module is reverted or
> renamed, Task 12 stops compiling.

### 2.2 Read-only database/storage audit

The audit used the configured Supabase service client only for read operations. No rows, files,
or bucket settings were changed.

| Measure | Observed |
|---|---:|
| Task comments | 31 |
| Active/deleted comments | 31 / 0 |
| Comment edit-history rows | 1 |
| Task attachment metadata rows | 1 |
| Storage objects in the Task bucket | 1 |
| Current metadata/object orphans | 0 / 0 |
| Task activity rows | 836 |
| Task notification rows | 8,592 |
| Maximum comments on one task | 5 |
| Maximum activity rows on one task | 14 |
| Tasks whose latest activity row is a system overdue event while `last_activity_at` refers to another event | 11 |
| Tasks marked overdue | 110 |
| Overdue-marked tasks missing `went_overdue` activity | 11 |
| Overdue-marked tasks missing `task_overdue_events` history | 8 |

Two groups of active comments contain the exact same task, author, parent, and body. The two rows
in each group were created only **0.647 seconds** and **1.175 seconds** apart. This is direct
evidence that duplicate submission has already occurred; it is not only a theoretical race.

Current data is otherwise internally clean in the checked set:

- all 31 comments currently have a corresponding `comment_added` activity count per task;
- there are no current cross-task reply parents or cross-task comment attachments;
- the one attachment has a matching private storage object;
- no current attachment exceeds 15 MiB or lacks `uploaded_by`;
- no task currently reaches the 200-row activity response cap.

These clean results do not remove the failure modes below. Several routes can create divergence
only when a downstream DB/storage call fails, and those failure branches are not covered by the
existing tests.

### 2.3 Existing automated verification

The following baseline suite passed during the audit:

```text
npm test -- --run \
  src/lib/tasks/activity.test.ts \
  src/lib/tasks/detail.test.ts \
  src/lib/tasks/storage.test.ts \
  src/lib/tasks/notifications.test.ts \
  src/lib/tasks/mentions.test.ts

5 test files passed; 31 tests passed.
```

There are no route-level tests for comment create/edit/delete, attachment upload/delete, partial
storage failure, idempotency, or post-commit side-effect failure. Existing detail tests cover
grouping and the 200-row cap, but not a failed signed URL.

### 2.4 Shared comment UI audit matrix

The second review pass inspected the rendered-state logic in the shared `CommentThread`, both
drawer call sites, both detail loaders, both edit-history APIs, the active people/assignee sources,
and the existing shared searchable-list normalization. No browser automation was claimed in this
planning pass; the observations below come from the concrete render/API paths and must become
regression tests during implementation.

| Surface | Current behavior | Required direction |
|---|---|---|
| Author/editor identity | Email-only API plus active-roster lookup and guessed email-local-part fallback | Batched canonical name in Task + Enrollment response; name-only visible UI |
| Normal comment | Avatar, name, relative time, body, reply/action | Keep compact structure; strengthen wrapping, status, hover/focus, exact time |
| Deleted comment | Avatar plus `comment deleted`; no visible owner/time | Preserve owner name/time and thread geometry without body |
| Rendered tag | Stored token label in a plain blue highlight | Subtle chip using canonical current name; email stays internal |
| Create/reply tag picker | Name-only rows, email-aware search, no zero-result UI, partial listbox semantics | Avatar/name/role, empty/result state, normalized Vietnamese search, full keyboard/ARIA |
| Edit comment | Plain textarea; only pre-existing decoded mentions can re-encode | Same structured searchable tagging as create/reply; inline 409/error |
| Edit history | Failure collapses to empty; editor resolved from active roster | Distinct loading/empty/error; canonical editor name; no visible email |
| Send/upload | Optimistic preview; whole comment can become failed after a file/reload failure | Durable comment state separated from per-file state, retry-safe feedback |
| Failed send | Error text plus Remove only | Preserve draft/content and offer idempotent Retry/Discard |
| Delete | Immediate menu action, silent failure | Author-only accessible confirmation and adjacent error/warning |
| Attachments | Cropped image thumbnail or truncated filename | Type/size/status, responsive layout, unavailable placeholder, per-file action |
| Image preview | Click/backdrop close only | Accessible dialog, Escape/focus lifecycle, load error, open/download |
| Thread scrolling | Any new row ID snaps to bottom | Follow only near-bottom/own-send; otherwise New comments affordance |
| Comment count | Raw detail array can include deleted rows while metadata excludes them | One canonical active-message count including replies, excluding deleted |
| Responsive layout | Fixed picker width, fixed reply indentation, unbroken body can overflow | Viewport-safe menu, responsive rail/spacing, `overflow-wrap:anywhere` |
| Accessibility | Some labels/roles exist; live operation state and combobox/dialog relationships incomplete | Keyboard, focus, status/error announcements, complete combobox/dialog semantics |

## 3. Current lifecycle and transaction boundaries

### 3.1 Comment with attachments

```text
Composer clears immediately
  -> optimistic comment + local blob previews
  -> POST comment
       -> insert task_comments                         COMMITTED
       -> insert task_activity (error ignored)
       -> add mentioned participants (error ignored)
       -> insert notifications (may throw)
       -> update task timestamps/version (may throw)
       -> broadcasts
  -> upload file 1                                    SEPARATE COMMIT
  -> upload file 2                                    SEPARATE COMMIT
  -> reload entire detail
  -> remove optimistic row
```

There is no transaction spanning the canonical comment, required activity row, participant
visibility, and task version. Storage cannot participate in a Postgres transaction, so file
upload requires an explicit saga/compensation contract rather than pretending the whole sequence
is atomic.

### 3.2 Attachment upload

```text
parse multipart body into memory
  -> resolve comment/task permission
  -> read file into ArrayBuffer
  -> validate extension/signature
  -> upload private storage object                    COMMITTED
  -> insert task_attachments metadata                 COMMITTED
  -> optional activity/notification
  -> sign URL
  -> response
```

Task upload currently has no cleanup when metadata insert or signing fails. A failure after the
metadata commit is returned as a retryable 500 even though the file is durable.

### 3.3 Attachment deletion

```text
remove private storage object                         IRREVERSIBLE
  -> delete task_attachments metadata
  -> response
```

If the metadata delete fails, the remaining row points to a missing object. Detail loading signs
all attachment paths with one `Promise.all`; one broken row rejects the entire task detail load.

### 3.4 Activity and last-activity state

Task field mutations use `patch_task_atomic`, which correctly commits canonical task state,
assignment state, stage state, and required activity rows in one database transaction. Comments,
attachments, comment edits/deletes, and initial task creation do not yet follow the same commit
contract.

`tasks.last_activity_at` and `tasks.updated_at` are stored on the task. In contrast,
`last_activity_by_email` is derived from the newest `task_activity` row. System overdue rows can
therefore change the displayed actor without changing the displayed last-activity time.

## 4. Findings

### F1 — Storage-first attachment deletion can make a task drawer unusable

**Issue:** Attachment deletion removes the object before deleting metadata; detail loading fails
as one unit when any stored path cannot be signed.

**Severity:** P1 — CRITICAL

**Location:**

- `src/app/api/tasks/[id]/attachments/[aid]/route.ts:77-80`
- `src/lib/tasks/detail.ts:103-115`
- `src/lib/tasks/detail.ts:180-189`

**Affected Module:** Tasks — Attachments / Detail drawer

**Trigger:** Storage deletion succeeds, then the metadata delete fails or the request terminates.
The next user opens the affected task.

**Expected:** A failed cleanup may leave an inaccessible orphan object, but visible metadata must
never point at a missing object, and one damaged attachment must not hide comments/activity.

**Actual:** The metadata row survives with a missing path. `Promise.all` rejects while signing,
`/detail` returns 500, and the drawer silently retains stale data or remains on a skeleton.

**Root Cause:** Destructive operations are ordered for storage consistency instead of UI/data
availability, with no compensation or per-file error isolation.

**Impact:** The collaboration drawer for one task can become unusable. Comments and activity are
unavailable because an unrelated attachment cannot be signed.

**Fix:** Delete/soft-delete metadata atomically with its audit row first; perform storage cleanup
after commit as best-effort and return a non-retryable warning. Load signed URLs independently and
render a per-file “unavailable” state rather than rejecting the whole detail payload.

**Regression Risk:** File objects can remain orphaned when cleanup fails. Mitigate with a dry-run
reconciliation command and operational warning, never by restoring broken visible metadata.

**Verification:** Inject storage-delete failure and DB-delete failure independently; the API must
have deterministic committed/not-committed responses and the drawer must still open.

**Status:** Confirmed by code path; current single attachment is healthy.

### F2 — Comment timestamp update can move the task version backwards

**Issue:** Comment POST captures `nowIso` before multiple asynchronous calls and later writes it
unconditionally into `last_activity_at` and `updated_at`.

**Severity:** P1 — CRITICAL

**Location:**

- `src/app/api/tasks/[id]/comments/route.ts:112`
- `src/app/api/tasks/[id]/comments/route.ts:145-179`
- `src/lib/tasks/last-activity.ts:8-23`
- optimistic concurrency check in `src/app/api/tasks/[id]/route.ts:177-193`

**Affected Module:** Tasks — Comments / task editing / concurrency control

**Trigger:** Comment A starts, Task PATCH B commits a newer `updated_at`, then Comment A reaches
`touchLastActivity` and writes its earlier timestamp.

**Expected:** Every committed task version is strictly monotonic. A comment must receive and
return the canonical timestamp produced at the moment its parent touch commits.

**Actual:** The delayed comment can move the version backwards. A client holding the returned
older token may pass a future conflict check even though its draft predates PATCH B.

**Root Cause:** Application-clock timestamp is selected before the transaction and parent update
has neither a row lock nor an expected-version/monotonic guard.

**Impact:** The optimistic-concurrency contract can be defeated, chronological fields regress,
and a stale field edit can overwrite a newer user edit.

**Fix:** Move comment creation, required activity, participant inserts, and parent touch into one
database command. Lock the task and generate a canonical timestamp with `clock_timestamp()` and
`greatest(clock_timestamp(), current_updated_at + interval '1 microsecond')`. Return the actual
committed parent timestamp from the database.

**Regression Risk:** Commenting intentionally changes the task version today. Preserve that
behavior and ensure the client receives the new token; do not remove the parent touch.

> **[[Claude]]** The fix is under-specified in the one place it matters. `patch_task_atomic`
> already exists and already writes `tasks.updated_at` — with its own timestamp strategy (it takes
> `p_now` from the route). If the new comment command computes
> `greatest(clock_timestamp(), current_updated_at + interval '1 microsecond')` while
> `patch_task_atomic` keeps writing a route-supplied `p_now`, **the version can still go backwards
> through the PATCH path** — you have only fixed one of the two writers. The monotonic guard has to
> be a property of the column, not of one command: either move both writers onto the same helper
> (`task_bump_version(task_id)`), or add a `BEFORE UPDATE` trigger that clamps `updated_at` to
> `greatest(new, old + 1µs)`. Decide this before Task 2, because Task 7 then builds
> `last_activity_by_email` on top of the same write path.

**Verification:** Run two controlled requests where PATCH B commits between Comment A start and
finish. Assert final `updated_at` is later than both prior versions and a stale PATCH receives 409.

**Status:** Confirmed race in code; requires concurrency injection to reproduce deterministically.

### F3 — A committed comment can be returned as a failed request

**Issue:** Notification and task-touch failures occur after `task_comments` commits and are still
allowed to turn the route into a 500 response. Required activity and participant failures are
silently ignored instead.

**Severity:** P2 — HIGH

**Location:**

- `src/app/api/tasks/[id]/comments/route.ts:128-188`
- `src/lib/tasks/notifications.ts:79-91`
- `src/lib/tasks/participants.ts:45-61`

**Affected Module:** Tasks — Comments / notifications / audit / permissions

**Trigger:** Notification insert or parent touch fails after comment insert, or activity/
participant insert fails silently.

**Expected:** Required canonical state commits atomically. Non-authoritative notification and
realtime failures produce warnings after a successful response, never “Failed to send.”

**Actual:** The comment may exist while the UI marks it failed. Conversely, the API can return
success while its activity or participant visibility is missing.

**Root Cause:** One route mixes required writes and best-effort side effects without an explicit
commit boundary.

**Impact:** Retrying can create duplicate comments; a mentioned user can receive a notification
but still get 403; audit counts can diverge from comments.

**Fix:** Put comment, activity, participant, and parent version writes in one command. Run
notifications and broadcasts after commit with `Promise.allSettled`, log structured warnings,
and return the committed comment plus warnings.

**Regression Risk:** Realtime is already best-effort and clients self-heal through reload. Ensure
warning handling does not present a canonical success as a failure.

**Verification:** Force each post-commit dependency to fail. The response remains 2xx with a
canonical comment for best-effort failures; required DB failures roll back every required row.

**Status:** Confirmed by code path; current comment/activity counts happen to match.

### F4 — Duplicate comment submission is already occurring

**Issue:** The composer has no synchronous in-flight lock and the server has no idempotency key.

**Severity:** P2 — HIGH

**Location:**

- `src/app/(authed)/tasks/_components/CommentThread.tsx:335-435`
- `src/app/(authed)/tasks/_components/CommentThread.tsx:1134-1147`
- `src/app/(authed)/tasks/_components/CommentThread.tsx:1322-1329`
- `src/app/api/tasks/[id]/comments/route.ts:98-188`

**Affected Module:** Shared CommentThread; Task comment API

**Trigger:** Double-click Send, press Enter repeatedly before React renders, reconnect/retry after
an ambiguous response, or submit from two tabs.

**Expected:** One user intent produces one canonical comment and one required activity row.

**Actual:** Each request inserts a new UUID row. Read-only data audit found two exact duplicate
groups created less than 1.2 seconds apart.

**Root Cause:** UI state clears immediately and always returns `true`; no ref/state submission
guard exists. The API cannot recognize a replay of the same client operation.

**Impact:** Duplicate comments and notifications, misleading activity counts, and manual cleanup.

**Fix:** Generate a stable client request UUID per submission, persist it through retries, add a
partial unique key on the comment command, and return the existing canonical result on replay.
Also add a synchronous `submittingRef` plus visible disabled/sending state in the composer.

**Regression Risk:** A new submission with identical text must still be allowed when it has a new
request UUID. Never deduplicate based on body text.

**Verification:** Double-click, repeated Enter, identical text submitted deliberately twice, and
network replay of the same request ID. The first three scenarios must produce 1, 1, 2 rows
respectively; replay must return the first row.

**Status:** Confirmed in current data and code.

### F5 — Comment plus files has misleading partial-success semantics

**Issue:** The real comment is created first and files upload sequentially. Any later file failure
marks the entire optimistic comment as failed even when the comment and earlier files exist.

**Severity:** P2 — HIGH

**Location:** `src/app/(authed)/tasks/_components/CommentThread.tsx:371-435`

**Affected Module:** Shared CommentThread / Task attachments

**Trigger:** Upload two files; file 1 succeeds and file 2 fails, or detail reload fails after all
writes succeed.

**Expected:** The durable comment remains successful. Every file has its own pending/success/
failed state and retry action. Reload failure is not treated as mutation failure.

**Actual:** The server comment is hidden behind a failed optimistic row. Attachment-only comments
can leave an empty real comment. There is no file-level retry; only “Remove” for the local failed
row. Earlier successful files remain committed.

**Root Cause:** One client `try/catch` models multiple independent commits as a single operation.

**Impact:** Users resubmit content, create duplicates, lose track of which files succeeded, and
can leave empty comments or partial attachment sets.

**Fix:** Split comment status from attachment status. Once comment POST succeeds, replace the
optimistic identity with the real ID permanently. Track each file by stable client upload ID,
show per-file failure/retry, and treat reload as reconciliation rather than mutation commit.
Use bounded upload concurrency (maximum two) only after independent status handling exists.

**Regression Risk:** Shared client behavior affects ACA and Medicare. Verify response compatibility
with `/api/enrollment` and do not assume Task-only warning fields.

**Verification:** Slow network, first/middle/last upload failure, reload failure, close drawer
during upload, attachment-only comment, and retry one failed file.

**Status:** Confirmed by code path.

### F6 — Task attachment upload can leak objects or return a false 500

**Issue:** Storage is committed before metadata; metadata/signing failures have no compensation.
Standalone activity and notification failures can also turn a durable upload into 500.

**Severity:** P2 — HIGH

**Location:** `src/app/api/tasks/[id]/attachments/route.ts:118-222`

**Affected Module:** Tasks — Attachment API / storage

**Trigger:** Metadata insert fails after upload, URL signing fails after metadata, notification
insert fails for a standalone attachment, or the client retries an ambiguous response.

**Expected:** Pre-commit failure removes the just-uploaded object. After metadata commits, the API
returns the canonical attachment even if audit/notification/realtime has warnings. Replay returns
the same attachment.

**Actual:** Orphan objects, durable metadata behind a 500, duplicate retry uploads, and ignored
activity insert errors are possible.

**Root Cause:** No upload idempotency key, no compensation, and no explicit commit boundary.

**Impact:** Storage cost/leak, duplicate files, incorrect UI failure, incomplete audit.

**Fix:** Add stable client upload IDs, sign before metadata creation, clean storage on any
pre-metadata failure, make metadata plus required activity atomic, and downgrade notifications/
broadcast/reload failures to warnings. Use the already-hardened Enrollment upload ordering as a
behavioral reference, not as authorization to merge the modules.

**Regression Risk:** Retried requests must not delete the first request's valid object. Cleanup
must target only the newly generated path owned by the failing attempt.

**Verification:** Fault-inject upload, sign, metadata, activity, notification, and response loss.
Run storage/metadata reconciliation after every case.

**Status:** Confirmed by code path; current bucket has no detected orphan.

### F7 — Comment edit history is not atomic and concurrent edits lose information

**Issue:** The previous body snapshot and current body update are separate unguarded operations.

**Severity:** P2 — HIGH

**Location:** `src/app/api/tasks/[id]/comments/[cid]/route.ts:91-120`

**Affected Module:** Tasks — Comment editing / audit

**Trigger:** Two tabs edit the same comment, history insert fails, or update fails after history
insert.

**Expected:** Edit checks the comment's expected `updated_at`; history and canonical edit commit
together; conflict returns 409 without losing either version.

**Actual:** Last write wins. History can be missing, duplicated, or record a version that never
became canonical. The edit does not touch task last activity, emit activity, update mentions, or
notify a newly mentioned person.

**Root Cause:** Route-level multi-step mutation without transaction or compare-and-swap.

**Impact:** Lost user text and an unreliable audit trail.

**Fix:** Add an atomic edit command accepting expected comment version. Insert history and
`comment_edited` activity with `comment_id`, update the comment, update task last activity/version,
and return canonical versions. Support mention parsing in edit; only newly mentioned users get a
notification, while existing participant access is never removed automatically.

**Regression Risk:** The current edit UI cannot add structured mentions. Reuse the composer
mention behavior without rewriting stored mention syntax.

**Verification:** Two-tab same-version edit, history-insert failure, unchanged edit, new mention,
removed mention, and edit followed immediately by task PATCH.

**Status:** Confirmed by code path; current data contains only one edit-history row.

### F8 — Comment deletion leaves hidden files, wrong counters, and no audit event

**Issue:** Soft-delete clears only comment body. Attachments remain stored/indexed/countable but
are hidden because the deleted-comment UI returns before rendering files.

**Severity:** P2 — HIGH

**Location:**

- `src/app/api/tasks/[id]/comments/[cid]/route.ts:123-136`
- `src/app/(authed)/tasks/_components/CommentThread.tsx:686-693`
- `supabase/schema.sql:1697-1710` (`task_list_metadata`)
- `src/lib/tasks/search.ts:370-388`

**Affected Module:** Tasks — Comments / files / list metadata / search / activity

**Trigger:** Author deletes a comment that has attachments.

**Expected:** Deletion has one documented retention contract. Hidden files are excluded from
signing, search, and list counts, cleanup is scheduled, and an immutable deletion audit remains.

**Actual:** Files disappear from the thread but remain in storage, global search, and attachment
count. Only the room is broadcast; other list tabs can retain stale counters. No
`comment_deleted` or `attachment_deleted` activity exists.

**Root Cause:** Comment, attachment, metadata, audit, and realtime deletion semantics were
implemented independently.

**Impact:** Privacy/retention ambiguity, misleading counters, inaccessible storage consumption,
and missing audit evidence.

**Fix:** Make comment deletion an atomic DB command that soft-deletes the comment, removes or
soft-deletes linked attachment metadata according to the approved retention rule, inserts
`comment_deleted` plus attachment-count metadata, and returns storage paths for post-commit
cleanup. Exclude deleted attachment metadata from detail, search, and counts. Broadcast room and
global list after commit.

**Regression Risk:** Replies currently remain visible under a deleted parent placeholder. Preserve
that behavior. Do not cascade-delete replies.

**Verification:** Delete parent with replies, comment with one/multiple files, cleanup failure,
multi-tab list counters, search by deleted filename, and notification deep-link.

**Status:** Confirmed by code path; current data contains no deleted task comments.

### F9 — Mention participation failure is hidden but notification still proceeds

**Issue:** `addParticipants` intentionally ignores all upsert errors, but notification creation
does not know that visibility failed.

**Severity:** P2 — HIGH

**Location:**

- `src/lib/tasks/participants.ts:45-61`
- `src/app/api/tasks/[id]/comments/route.ts:142-177`

**Affected Module:** Tasks — Mentions / permissions / notifications

**Trigger:** Participant upsert fails because of DB outage, rollout mismatch, constraint, or bad
data.

**Expected:** A mention that promises access either commits participant visibility with the
comment or fails the required command. Notification is sent only for a canonical accessible
mention.

**Actual:** Comment and notification can succeed while the mentioned user receives 403 opening
the task.

**Root Cause:** Participant visibility is treated as best-effort even though it is part of mention
business semantics.

**Impact:** Broken notification links and inconsistent authorization.

**Fix:** Move valid participant upserts into the atomic comment/edit command and stop swallowing
errors for mutation paths. Keep tolerant read fallbacks only for explicitly supported additive
schema rollout, not for a committed mention.

**Regression Risk:** Ensure only active eligible roster emails become participants and preserve
one-level reply validation.

**Verification:** Participant insert failure, invalid/inactive mention, repeated mention, and
mentioned user opening the task immediately after response.

**Status:** Confirmed failure mode; no current broken participant link was asserted.

### F10 — “Last activity” time and actor disagree for real tasks

**Issue:** Time is read from `tasks.last_activity_at`; actor is independently derived from newest
`task_activity`, including system-only events.

**Severity:** P2 — HIGH

**Location:**

- `supabase/schema.sql:1678-1711`
- `src/lib/tasks/queries.ts:226-259`
- `src/app/api/cron/check-overdue/route.ts:188-213`
- `src/app/(authed)/tasks/_components/TaskRowItem.tsx:506-529`

**Affected Module:** Tasks — List metadata / activity

**Trigger:** Cron inserts `went_overdue` as actor `system` without changing human last-activity
fields.

**Expected:** Last-activity time and actor describe the same substantive event.

**Actual:** Current data has 11 tasks where the list displays the time of an earlier human action
and the actor of a later system overdue event.

**Root Cause:** The two halves of one display concept have separate sources of truth.

**Impact:** Users cannot tell who actually last touched the task; stale-reminder interpretation is
misleading.

**Fix:** Store `last_activity_by_email` on `tasks` and update it in the same atomic command as
`last_activity_at`. Backfill from the latest substantive non-system event. System reminders and
overdue bookkeeping remain in activity but do not replace human last activity. Do not update
last activity for position-only reorder; add an `edited` event for substantive custom-field
patches so they remain visible.

**Regression Risk:** Sorting/export/list metadata depend on current names. Preserve external
response keys while changing the internal source. Confirm stale reminder semantics with product.

**Verification:** Human comment then overdue cron, overdue cron then human patch, position reorder,
custom field edit, list sort/export, and read-only backfill comparison.

**Status:** Confirmed in current data.

### F11 — Assignee removal is logged as assignment

**Issue:** Removing an assignee writes activity type `assigned` with `{ removed, to }`, while the
notification correctly uses `unassigned`.

**Severity:** P2 — HIGH

**Location:**

- `src/app/api/tasks/[id]/assignees/[email]/route.ts:95-105`
- `src/app/(authed)/tasks/_components/ActivityFeed.tsx:17-18`

**Affected Module:** Tasks — Assignment activity audit

**Trigger:** Remove any assigned worker.

**Expected:** Activity says who was removed and keeps the new primary assignee as separate metadata.

**Actual:** Feed renders “assigned to [remaining person/—].” Current data contains 175 `assigned`
rows and zero `unassigned` activity rows even though five `unassigned` notifications exist.

**Root Cause:** Route reused the assignment activity type; renderer ignores `meta.removed`.

**Impact:** Audit trail states the opposite action.

**Fix:** Emit `unassigned` with `{ removed, next_primary }`; update typed metadata and feed renderer.
Do not rewrite historical rows automatically unless a deterministic migration can identify them
from `meta.removed`.

**Regression Risk:** Historical malformed `assigned` rows should still render sensibly via a
compatibility branch.

**Verification:** Remove sole assignee and one of multiple assignees; inspect DB row and UI copy.

**Status:** Confirmed in code and current aggregate data.

### F12 — Initial task creation can commit without its required audit and return 500

**Issue:** Task row, assignees, queue rotation, created activity, history, and notifications are
written in separate steps. Several later failures return 500 after the task already exists.

**Severity:** P2 — HIGH

**Location:** `src/app/api/tasks/route.ts:253-373`

**Affected Module:** Tasks — Creation / assignment / activity

**Trigger:** Assignee insert, queue rotation, history, activity, or notification fails after the
task insert.

**Expected:** Canonical task, initial assignees/stage, and required `created` audit commit together.
Best-effort queue/notification work cannot make a committed task look retryable. Replaying the same
create request returns the first task.

**Actual:** The task can exist without required related state, or the route can return 500 after
creation. A user retry can create a duplicate task. Activity insert errors are not inspected.

**Root Cause:** Initial creation predates the atomic command pattern used by Task PATCH.

**Impact:** Duplicate tasks, missing `created` activity/history, and assignment inconsistency.

**Fix:** Add an idempotent atomic create command for task + canonical assignees + initial stage/
assignment cycles + required created activity/history. Move queue rotation and notifications after
commit with structured warnings or include rotation only if it can safely share the transaction.

**Regression Risk:** Fair-assignment rotation affects operational ordering. If moved after commit,
add reconciliation and never silently skip it.

**Verification:** Fault-inject every step; canonical failure rolls back all required rows, and
post-commit warning returns the same task. Replay one request ID produces one task/activity.

**Status:** Confirmed failure path; current data happens to have 431 tasks and 431 `created` rows.

### F13 — Cron overdue state, event history, and activity are not atomic

**Issue:** Cron updates the task overdue marker, opens an overdue event, and inserts
`went_overdue` in separate calls. The activity insert result is ignored.

**Severity:** P2 — HIGH

**Location:** `src/app/api/cron/check-overdue/route.ts:188-243`

**Affected Module:** Tasks — SLA overdue / activity / KPI history

**Trigger:** Event or activity insert fails after `overdue_flagged_at` commits, concurrent cron
runs race, or an older path marked overdue without creating all history rows.

**Expected:** First overdue transition atomically updates task KPI state, opens exactly one event,
and writes exactly one `went_overdue` activity. Notification failure is warning-only.

**Actual:** Current data contains 110 overdue-marked tasks but only 99 tasks with a
`went_overdue` activity, and eight overdue-marked tasks have no overdue-event history.

**Root Cause:** Cron uses route-level orchestration without a conditional atomic command and does
not check required insert errors.

**Impact:** Incomplete SLA audit/KPI evidence and disagreement between task flags, overdue log, and
activity feed.

**Fix:** Add idempotent `mark_task_overdue_atomic`: lock/conditionally update the task, open the
event, and insert required activity in one transaction; return whether this invocation performed
the transition. Notify/broadcast only after successful canonical commit. Produce a reviewed
backfill for existing mismatches without fabricating exact timestamps.

**Regression Risk:** Concurrent cron and user status change must not double-count or reopen an
already resolved event. Preserve existing overdue-count semantics.

**Verification:** Two concurrent cron calls, status change during cron, injected event/activity
failure, and post-migration counts across all three sources.

**Status:** Confirmed in code and current data.

### F14 — Activity vocabulary and display contract have drifted

**Issue:** Database constraints, server writers, and `ActivityFeed` do not share one typed event
contract. The UI handles disallowed types, omits `attachment_added`, and discards useful category
metadata. Comment edit/delete and attachment delete have no event types.

**Severity:** P3 — MEDIUM

**Location:**

- `supabase/schema.sql:1713-1746`
- `src/lib/tasks/activity.ts`
- `src/app/(authed)/tasks/_components/ActivityFeed.tsx:7-38`

**Affected Module:** Tasks — Activity audit/UI

**Trigger:** Display `attachment_added`, inspect category changes, introduce a type in only one
layer, or archive a task.

**Expected:** Every allowed event has documented metadata, atomic writer, renderer, and test.

**Actual:** Unknown events render raw snake_case; some renderer cases can never be inserted under
the DB check; task archive preserves old activity but does not log `archived`.

**Root Cause:** Event names and metadata are free-form strings duplicated across SQL, routes, and
React.

**Impact:** Low-quality audit text and high regression risk when adding events.

**Fix:** Define a TypeScript discriminated union and event metadata contract, align SQL check,
writers, and renderer, add compatibility rendering for historical rows, and add the required
comment/file lifecycle types without storing comment bodies or signed URLs in activity metadata.

**Regression Risk:** SQL check is currently `NOT VALID`, so historical unexpected rows may exist.
Audit distinct types before validating a replacement constraint.

**Verification:** Fixture test for every allowed type, unknown historical fallback, and schema
type inventory after migration.

**Status:** Confirmed contract drift; current rows themselves all use currently allowed types.

### F15 — Detail loading performs expensive privileged work before authorization completes

**Issue:** For non-managers, scope checks and full detail loading/signing run concurrently.

**Severity:** P3 — MEDIUM

**Location:** `src/app/api/tasks/[id]/detail/route.ts:67-103`

**Affected Module:** Tasks — Detail API / permissions / performance

**Trigger:** An authenticated but unauthorized user requests arbitrary task IDs repeatedly.

**Expected:** Resolve access before reading comments/activity and generating signed URLs.

**Actual:** Service-role reads and URL signing execute, then the response is discarded as 403.

**Root Cause:** Latency optimization parallelized authorization with privileged data work.

**Impact:** Avoidable DB/storage load and a wider timing side channel. No data is directly returned.

**Fix:** Parallelize only the independent scope predicates, decide authorization, then load the
minimum permitted detail. Skip activity entirely for users who cannot view it.

**Regression Risk:** Authorized drawer latency may increase by one network wave. Measure before/
after and retain hover prefetch only after authorization.

**Verification:** Unauthorized request must produce no comment/activity/storage-sign calls in
instrumented tests; authorized role matrix remains unchanged.

**Status:** Confirmed by code path.

### F16 — Signed URL cache can serve expired attachment links

**Issue:** Signed URLs expire after one hour, while the module-level detail cache has no TTL or
explicit invalidation.

**Severity:** P3 — MEDIUM

**Location:**

- `src/lib/tasks/storage.ts:77-83`
- `src/lib/tasks/detail-cache.ts:7-30`
- `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx:129-150`

**Affected Module:** Tasks — Attachment display / client cache

**Trigger:** Keep the application open over one hour, then reopen a prefetched/cached task while
the reconciliation request is slow or fails.

**Expected:** Cached detail expires before signed URLs and mutation/realtime events invalidate it.

**Actual:** Expired image/link URLs can flash or remain indefinitely when reload errors are
silently swallowed.

**Root Cause:** Cache lifetime is unrelated to credential lifetime and reload has no error state.

**Impact:** Broken downloads/previews and stale comments/activity.

**Fix:** Store cache timestamps, use a short TTL well below signed URL expiry (for example five
minutes), invalidate on room mutation, and expose reload failure without discarding committed
optimistic state.

**Regression Risk:** More detail requests. Current data is small; correctness takes precedence.

**Verification:** Fake time past TTL/URL expiry, offline reload, realtime invalidation, and reopen.

**Status:** Confirmed by code path.

### F17 — Input/resource limits and file validation are incomplete

**Issue:** Comment text has no explicit length limit, one comment can queue unlimited 15 MiB files,
and authenticated upload parsing occurs before full view authorization. HEIC has no signature
check; XLSX validation checks only ZIP magic; there is no malware scanning policy.

**Severity:** P3 — MEDIUM (raise to P2 if untrusted external users gain upload access)

**Location:**

- `src/app/api/tasks/[id]/comments/route.ts:105-111`
- `src/app/api/tasks/[id]/attachments/route.ts:118-160`
- `src/lib/tasks/attachments.ts`
- `src/app/(authed)/tasks/_components/CommentThread.tsx:1101-1111`

**Affected Module:** Tasks — API/resource security

**Trigger:** Very large comment body, many files, malformed HEIC/Office file, or repeated large
requests from an authenticated account.

**Expected:** Explicit server-enforced limits, early authorization, documented accepted content,
and an operational malware decision.

**Actual:** Per-file size and common magic checks are good, but total operation size/count and
text length are unbounded at the application contract level.

**Root Cause:** Validation was designed per file, not per collaboration operation/threat model.

**Impact:** Memory/storage pressure and malware-handling ambiguity.

**Fix:** Default contract: 10,000 comment characters, maximum 10 files per comment, maximum 50 MiB
aggregate per comment, with matching client/server messages. Resolve base task view permission
before multipart parsing. Add HEIC structural validation where reliable; document that authenticated
Office/PDF files are not malware-scanned and obtain a go-live risk decision before adding an
external scanning service.

**Regression Risk:** Existing legitimate workflows may exceed proposed limits. Query production
sizes before applying DB checks and make limits configurable if evidence requires it.

> **[[Claude]]** The three proposed limits are not mutually consistent with §8 and the plan never
> says which one wins. §8 fixes the per-file maximum at 15 MiB; ten files at that maximum is
> 150 MiB, which is three times the proposed 50 MiB aggregate. That is not a contradiction, but it
> does mean **the aggregate cap is the binding constraint in every realistic case** and a user can
> hit it with four files while the UI still advertises "10 files". State the precedence explicitly
> (aggregate > count > per-file) and make the client message name the limit that actually tripped,
> otherwise the error reads as arbitrary.

**Verification:** Boundary tests, unauthorized large upload, many-file selection, spoofed files,
and accepted real samples for every extension.

**Status:** Confirmed gap; current attachment data does not violate proposed limits.

### F18 — Cross-row database invariants rely only on application code

**Issue:** DB foreign keys ensure referenced rows exist but do not ensure reply parent and comment
attachment belong to the same task, or that replies are only one level deep.

**Severity:** P3 — MEDIUM

**Location:** `supabase/schema.sql:1628-1665`

**Affected Module:** Tasks — Comment/attachment data integrity

**Trigger:** Future route, admin script, import, or bug bypasses current application validation.

**Expected:** Invariants that can break authorization/detail semantics are enforced at the DB
command boundary.

**Actual:** Separate `task_id` and `comment_id`/`parent_id` foreign keys permit cross-task links.

**Root Cause:** PostgreSQL cannot express these cross-row checks with a simple CHECK; no trigger or
atomic command owns them globally.

**Impact:** Wrong-task file/comment exposure through a service-role query if a bad row is created.

**Fix:** Enforce same-task and top-level-parent validation inside the only atomic comment/file
commands; optionally add narrow constraint triggers if any other writer must remain supported.

**Regression Risk:** Validate current data first. The read-only audit currently found zero invalid
links.

**Verification:** Direct invalid command attempts must fail; valid top-level replies and comment
attachments continue working.

**Status:** Latent integrity risk; current rows are clean.

### F19 — Comment authors and editors do not have a reliable display-name contract

**Issue:** Comments and edit-history responses expose identity only as email. The shared UI then
tries to find a name in the currently active picker roster and otherwise fabricates a name from
the email local part.

**Severity:** P2 — HIGH

**Location:**

- `src/lib/tasks/detail.ts:40-41,79-119`
- `src/lib/enrollment/detail.ts:12-13,32-78`
- `src/app/api/tasks/[id]/comments/[cid]/edits/route.ts:68-74`
- `src/app/api/enrollment/[id]/comments/[cid]/edits/route.ts:40-47`
- `src/app/(authed)/tasks/_components/CommentThread.tsx:318-321,704,761`
- `src/lib/tasks/assignees.ts:77-84`
- `src/lib/enrollment/queries.ts:245-253`

**Affected Module:** Shared comment UI — Tasks, ACA Enrollment, Medicare Enrollment

**Trigger:** View a comment or edit made by an inactive account, an account outside the current
role-based assignee roster, or an account whose display name is absent from `members`.

**Expected:** Comment cards, deleted placeholders, edit forms, and edit history show the canonical
person name. Email remains an internal identity key and is never the visible fallback on these
surfaces.

**Actual:** Tasks builds `mentionMembers` from active task assignees; Enrollment builds it from
active `portal_account` rows. `nameOf()` falls back to `formatEmailAsName()`, which turns an email
local part into a guessed label rather than resolving an authoritative name. The edit-history APIs
return `edited_by` only, so the same problem exists in the “view edits” UI.

**Root Cause:** The picker roster was reused as a historical identity directory, and the detail
response has no typed `author_name`/`edited_by_name` contract.

**Impact:** The UI can show the wrong person name, change how a historical person is identified
depending on current role/active status, and expose an email-shaped fallback where the product
requires a name. This weakens trust in the audit trail.

**Fix:** Batch-resolve every distinct author/editor email through `portal_account`, including
inactive accounts, and return typed display names from both Task and Enrollment APIs. Render the
current canonical name; do not create a new name snapshot column in this work. If an account is
truly missing or has no name, show the neutral product label `Unknown user` rather
than raw or prettified email. Keep email in the response only for identity, permission checks,
avatar color, and mention encoding—not visible text.

**Regression Risk:** Existing snapshots/tests may expect email-only shapes. A person can change
their account name, so historical comments will intentionally show the latest canonical name; if
immutable historical names are later required, that is a separate schema/product decision.

**Verification:** Active/inactive/missing/renamed user fixtures on Task and Enrollment; comment,
deleted placeholder, edit mode, and edit history contain no raw email and resolve the same name.

**Status:** Confirmed shared API/UI contract gap.

### F20 — Editing a comment cannot create a real mention and can silently miss notification

**Issue:** The create/reply composer has mention autocomplete and structured token encoding, but
the edit form is a plain textarea. Typing `@Name` during edit looks like a tag to the user but is
saved as ordinary text and does not identify or notify the person.

**Severity:** P2 — HIGH

**Location:**

- `src/app/(authed)/tasks/_components/CommentThread.tsx:874-949`
- `src/app/(authed)/tasks/_components/CommentThread.tsx:957-1260`
- `src/app/api/tasks/[id]/comments/[cid]/route.ts`
- `src/app/api/enrollment/[id]/comments/[cid]/route.ts`

**Affected Module:** Shared comment edit/tag flow — Tasks and Enrollment

**Trigger:** Edit an existing comment, type a new `@person`, save, and expect the tagged person to
become a participant and receive a mention notification.

**Expected:** Create, reply, and edit use the same searchable mention interaction and structured
identity token. A visibly styled tag always has a real selected account behind it.

**Actual:** Edit only decodes mentions that existed before editing and re-encodes those known
labels. A newly typed `@Name` remains plain text. Renaming or partially changing an existing label
can also sever the stored identity without feedback.

**Root Cause:** Mention composition is embedded in `Composer` instead of a reusable draft model/
editor used by `EditCommentForm`.

**Impact:** Users believe they tagged a teammate, while no mention participant/notification is
created. This is a real collaboration failure rather than only a visual inconsistency.

**Fix:** Extract the mention draft/token/search/keyboard model and reuse it in create, reply, and
edit. Only a selected roster result becomes a structured tag; arbitrary `@text` remains visibly
plain. On edit, diff canonical mention emails and add/notify only newly selected people through
the atomic edit contract in Task 5.

**Regression Risk:** Stored historical tokens can contain archived or renamed labels. Decode them
without data loss, resolve visible labels from canonical names, and preserve the email identity
until the user explicitly removes the tag.

**Verification:** Add/remove/retain/rename text around a mention in create/reply/edit; keyboard and
mouse selection; notification only for newly added canonical mention; Task/ACA/Medicare parity.

**Status:** Confirmed functional inconsistency.

### F21 — Mention/tag UI is visually and accessibly incomplete

**Issue:** Rendered mentions are plain blue text highlights, and the picker disappears when no
person matches. The picker lacks a complete combobox relationship and cannot reliably distinguish
same-name users without exposing email.

**Severity:** P3 — MEDIUM

**Location:** `src/app/(authed)/tasks/_components/CommentThread.tsx:616-635,1004-1174,1215-1251`

**Affected Module:** Shared comment UI — tag rendering and picker

**Trigger:** Type an unmatched name, use a screen reader, search a Vietnamese name without its
accents, choose between duplicate names, use a viewport narrower than the fixed 288 px menu, or
view a tag after the account name changes.

**Expected:** A compact, polished tag chip and a predictable searchable person menu: canonical
name, avatar, role/team secondary label, selected/highlight state, “No matching people” state,
accent-insensitive search, and complete keyboard/ARIA behavior. Comment/read/edit surfaces show
names, not emails.

**Actual:** Tags render the stale label stored inside `@[Label](email)`; the menu only shows the
name, silently vanishes at zero results, fixes its width at 288 px, and has listbox options without
an owning combobox/`aria-activedescendant`. Matching is case-insensitive only and does not reuse
the existing Vietnamese-aware option normalization.

**Root Cause:** Mention UI grew as composer-local behavior instead of a shared, tested interaction
contract.

**Impact:** The feature feels unfinished, keyboard/screen-reader feedback is weak, and users can
select the wrong same-name person or fail to find a valid Vietnamese name.

**Fix:** Use `normalizeOptionSearchText()` from `src/lib/ui/option-search.ts`; render a caret-
anchored panel with avatar, canonical name, non-email role/team context, empty state, active option
and result count. Add stable option IDs plus combobox/listbox ARIA wiring. Constrain width to the
viewport. Render selected mentions as subtle rounded chips using the canonical response name; the
stored token label remains backward-compatible data, not the display source.

**Regression Risk:** Do not replace stored mention syntax or broaden who can be mentioned. Search
may still match email internally for fast lookup, but email must not appear in comment/edit
history and should not be required to distinguish picker rows.

**Verification:** Keyboard-only, VoiceOver, zero-result, duplicate-name, inactive historical tag,
Vietnamese accent/`đ`, 320 px viewport, and renamed-account cases.

**Status:** Confirmed UI/accessibility gap.

### F22 — Comment mutations hide failure and deletion has no safety affordance

**Issue:** Edit/delete/history requests suppress error details, failed sends cannot be retried, and
Delete executes immediately without confirmation or undo.

**Severity:** P3 — MEDIUM (the durable/partial-success portions remain P2 under F3-F8)

**Location:** `src/app/(authed)/tasks/_components/CommentThread.tsx:375-447,673-683,726-765,850-864,874-949`

**Affected Module:** Shared comment UI — operation feedback

**Trigger:** Network/API failure while editing, deleting, loading history, or uploading; delete a
comment containing files or replies; retry a failed optimistic comment.

**Expected:** Each operation has explicit pending/success/error state, preserves recoverable user
input, and exposes Retry where replay is safe. Destructive delete requires confirmation that
describes retained replies/file behavior (or a short undo if product chooses that pattern).

**Actual:** Failed edit leaves the form open with no explanation; failed delete does nothing;
history failure is shown as “No previous versions”; failed send offers only Remove; delete fires
from the menu immediately.

**Root Cause:** Boolean/void callbacks collapse transport, validation, committed-with-warning, and
failed states into one UI path.

**Impact:** Users repeat actions, lose confidence, or delete content accidentally. Support cannot
distinguish empty history from a load failure.

**Fix:** Consume typed mutation results from Tasks 2-5. Add inline non-blocking status text with
`role=status`/`role=alert`, Retry for idempotent failed send/file/reconciliation actions, and a
focused confirmation dialog for durable comment deletion. Do not use global toasts as the only
error location.

**Regression Risk:** Avoid duplicate requests: Retry must reuse the same request ID where the
operation may have committed. Delete confirmation must not change author-only authorization.

**Verification:** Every route failure class, post-commit warning, retry, double-click, Escape/
focus restoration in confirmation, comment with replies/files, and offline/online transition.

**Status:** Confirmed UI feedback gap; correctness dependencies are already covered by F3-F8.

### F23 — Thread navigation, counters, and relative time can present stale or disruptive UI

**Issue:** Any change to the row ID signature scrolls the thread to the bottom, tab counters can
include deleted rows while list metadata excludes them, and relative timestamps update only when
another render happens.

**Severity:** P3 — MEDIUM

**Location:**

- `src/app/(authed)/tasks/_components/CommentThread.tsx:457-486`
- `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx:480-520`
- `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx:2974-3013`

**Affected Module:** Shared comment thread/navigation

**Trigger:** Read an older comment while realtime adds a new one; delete a comment; leave a drawer
open as “just now” becomes minutes old.

**Expected:** Auto-scroll only when the reader is already near the bottom or when their own send
succeeds; otherwise show a “New comments” affordance. One documented active-message count is used
in list and drawer. Relative time refreshes on a low-frequency shared clock while exact time
remains available.

**Actual:** New row IDs force `scrollTop = scrollHeight`; `detail.comments.length` counts deleted
placeholder rows while metadata queries count active comments; time labels can remain stale.

**Root Cause:** Chat-like behavior was implemented without tracking reader position or defining
counter semantics.

**Impact:** Realtime activity pulls users away from what they are reading and visible counts can
disagree between list/drawer.

**Fix:** Track “near bottom,” new-unread count, and last locally submitted comment. Define comment
count as active messages including replies but excluding deleted rows; return/use canonical
metadata rather than deriving from raw array length. Refresh relative labels at a one-minute
interval shared per thread, not per comment.

**Regression Risk:** Deep-link highlighting must still take precedence over bottom anchoring.
Deleted parent placeholders with surviving replies must remain visible even though the deleted
parent is excluded from the active count.

**Verification:** Realtime while scrolled top/bottom, local send, deep link, delete with replies,
list/drawer count reconciliation, and fake-time timestamp test.

**Status:** Confirmed interaction/consistency gap.

### F24 — Attachment/comment presentation is not resilient on small screens or failure states

**Issue:** Long unbroken comment text can overflow, reply indentation consumes narrow drawer width,
and image preview lacks Escape/focus management, load failure, file metadata, and open/download
actions.

**Severity:** P3 — MEDIUM

**Location:** `src/app/(authed)/tasks/_components/CommentThread.tsx:507-558,575-609,689-830,1180-1315`

**Affected Module:** Shared comment/attachment UI

**Trigger:** Long URL/token, 320-375 px viewport, deep reply with files, expired/broken signed URL,
keyboard-only image preview, unsupported file chosen from the native picker, or duplicate files.

**Expected:** Thread content wraps safely; mobile retains readable width; file chips show name,
size/type and status; chooser filters documented formats; preview is a complete accessible dialog
with loading/error, Escape, focus trap/restore, and open/download action.

**Actual:** Comment body lacks `break-words`/`overflow-wrap:anywhere`; replies always use fixed
indentation; the file input has no `accept`; image modal closes only by click and has no failure
UI; non-image links show only a truncated name.

**Root Cause:** Attachment UI handles the success-path visual but not the credential, responsive,
and dialog lifecycle contracts.

**Impact:** Broken layout, inaccessible preview, unclear upload state, and poor recovery from
expired/unavailable files.

**Fix:** Add safe wrapping and responsive indentation, format/size/status file rows, client-side
duplicate/format feedback consistent with server validation, and an accessible preview dialog.
Consume Task 9's typed unavailable state without hiding healthy comments/files.

**Regression Risk:** `accept` is guidance only; keep server validation authoritative. Do not add a
new image-processing library or change private signed-link policy.

**Verification:** Mobile widths, long URL/Unicode, all supported formats, duplicate/unsupported
selection, expired URL, image load error, Escape/Tab/focus restoration, and Task/Enrollment parity.

**Status:** Confirmed responsive/accessibility gap.

## 5. Severity summary and go-live gate

| Severity | Count | Gate |
|---|---:|---|
| P0 | 0 | None found |
| P1 | 2 | F1 and F2 must be fixed before Go Live |
| P2 | 13 | F3-F13 plus F19-F20 should be completed before Go Live; any deferral needs owner/workaround |
| P3 | 9 | F14-F18 plus F21-F24 follow correctness work; F15/F17 need explicit risk acceptance if deferred |

Subsystem recommendation: **NOT READY** until storage-first deletion/detail isolation and the
comment version race are fixed. The current low attachment volume reduces likelihood but does not
reduce impact. Duplicate comments are already present, so idempotency is not optional cleanup.
The name-only identity requirement is also not satisfied until F19 is complete; visual polish must
not mask guessed names or plain-text pseudo-mentions.

## 6. Target contracts

### 6.1 Required versus best-effort state

Required state must commit or roll back together:

- canonical comment create/edit/delete;
- corresponding required activity row;
- mentioned participant visibility;
- parent task monotonic version and last-human-activity pair;
- attachment metadata create/delete plus required attachment activity;
- comment edit-history snapshot plus canonical body edit;
- initial task, assignees/stage, and required `created` audit;
- first overdue task flag, overdue event, and `went_overdue` audit.

Best-effort after commit:

- notification delivery row/broadcast, provided notification insert is idempotent;
- room/global realtime ping;
- canonical detail/list reconciliation fetch;
- physical storage cleanup after metadata deletion.

A best-effort failure returns `warnings` with 2xx after canonical commit. It must never convert a
durable mutation into a retryable 5xx.

### 6.2 Idempotency

- One composer submission owns one stable UUID until it either commits or is explicitly discarded.
- One selected file owns one stable upload UUID across retries.
- Same UUID replay returns the existing canonical row and does not add activity twice.
- Same text or same filename under a new UUID remains a legitimate new operation.
- Notification for a comment is unique per `(recipient_email, comment_id)`; “mentioned” wins over
  “commented” before insertion.

### 6.3 Activity semantics

Required event contract:

| Event | Required metadata | Affects last human activity |
|---|---|---|
| `created` | optional initial assignee IDs/emails | yes |
| `comment_added` | `comment_id`, optional `parent_id`, `attachment_count` reconciled later | yes |
| `comment_edited` | `comment_id` | yes |
| `comment_deleted` | `comment_id`, `attachment_count` | yes |
| `attachment_added` | `attachment_id`, optional `comment_id`; no signed URL | no when part of the same just-created comment; yes for standalone legacy upload |
| `attachment_deleted` | `attachment_id`, optional `comment_id` | yes when it is a separate user action |
| `assigned` | `to` | yes |
| `unassigned` | `removed`, optional `next_primary` | yes |
| system overdue/reminder events | due/reminder metadata | no |

Never store comment body, file contents, signed URLs, or credentials in `task_activity.meta`.
File names may contain customer information; prefer attachment ID and count unless the UI has a
documented need to display the name.

### 6.4 Delete/retention decision

Default plan decision:

- comments remain soft-deleted so replies and audit references survive;
- comment bodies are cleared as today;
- linked attachment metadata is removed from active queries/counts/search in the same DB command;
- physical objects are deleted after commit;
- cleanup failure creates a structured operational warning and an orphan that can be safely
  removed later;
- activity records only IDs/counts needed to prove the deletion.

If compliance requires retaining deleted attachment objects, stop before Task 5 and document the
retention/access policy. Do not keep the current accidental state where files are hidden in one UI
but searchable/countable elsewhere.

### 6.5 Shared comment UI and identity contract

The same contract applies in Health Customer Service, ACA Enrollment, and Medicare Enrollment.
Do not fork a second Enrollment comment UI.

**Identity:**

- APIs retain normalized email as the identity key but also return an authoritative
  `display_name` for every author/editor referenced by the response.
- Read, deleted-placeholder, edit, and edit-history surfaces render `display_name`, never raw
  email and never `formatEmailAsName()` as a historical identity source.
- Resolve names from all matching `portal_account` rows, including inactive accounts. Missing/
  nameless identities render the neutral label `Unknown user` consistently.
- This plan uses the latest canonical account name. It does not add immutable display-name
  snapshots or rewrite old mention-token labels.

**Comment visual hierarchy:**

- use one 28-32 px avatar, semibold author name, muted relative time, exact-time tooltip, and a
  compact action menu aligned on one header row;
- body text uses readable line height, preserves newlines, and safely wraps long URLs/tokens;
- replies retain one visual thread rail but reduce indentation on narrow viewports;
- deleted comments retain author name, timestamp, and a subdued `Comment deleted` placeholder so
  surviving replies keep clear ownership without exposing deleted content;
- action/status/error text stays adjacent to the affected comment; color is not the only signal.

**Tags and picker:**

- a visible tag is always backed by a selected account email; arbitrary `@text` remains plain;
- render tags as subtle blue-tint pills with `@` plus current canonical name, medium weight, and
  sufficient contrast—do not use a loud table-style status badge;
- the caret-anchored picker shows avatar, canonical name, role/team secondary text, keyboard
  highlight, result/empty state, and never uses visible email as the ordinary label;
- search is case/whitespace/accent/`Đ` insensitive through the existing shared normalization;
- create, reply, and edit share one mention-draft model and keyboard contract.

**Composer and operation state:**

- use a clean bordered composer with auto-growing text area, attachment strip, clear keyboard hint,
  and one primary Send action; do not clear recoverable content before canonical commit;
- sending, committed-with-warning, failed, retrying, and file-specific upload states are visible
  and screen-reader announced;
- edit keeps the same tag experience, preserves text on 409/failure, and shows the reason inline;
- durable delete has an accessible confirmation; retries reuse idempotency identity.

**Thread navigation and files:**

- only follow new messages when the reader is near the bottom or just sent one; otherwise show a
  `New comments` control;
- count active top-level comments plus replies, excluding deleted rows, consistently in list and
  drawer metadata;
- image preview supports Escape, initial focus, focus trap/restore, loading/error, and open/
  download; unavailable files do not break the remaining thread;
- file rows show recognizable type icon, safely truncated name, formatted size, and operation
  status. Server validation remains authoritative even when the input has `accept` guidance.

## 7. Implementation tasks

### 7.1 Deployment and rollback order

This repository keeps additive database definitions in `supabase/schema.sql`, while application
deploy and schema application may not be one atomic release. Use this order:

1. Apply additive nullable columns, indexes, allowed activity types, and new RPC commands first.
2. Verify commands directly in the target environment with rollback-only/synthetic records before
   deploying callers.
3. Deploy API code that calls the new commands. Missing required RPC/column is a visible 503/deploy
   error; do not silently fall back to the unsafe multi-step mutation.
4. Deploy shared client behavior after both Task and Enrollment compatibility checks pass.
5. Run dry-run audits and reviewed backfills.
6. Validate constraints only after the post-backfill audit is clean.

Rollback application code before removing any database function/column. Additive nullable schema
may safely remain during rollback. Never roll back by deleting comments, activity, metadata, or
storage objects created during the new path. Idempotency request IDs and warning logs must remain
safe when old and new clients overlap during a rolling browser deployment.

### Task 1 — Add characterization tests and typed mutation/result contracts

**Files:**

- create route-level test helpers under `src/app/api/tasks/[id]/.../*.test.ts` or the repository's
  established API test location;
- `src/lib/tasks/activity.ts`
- `src/lib/tasks/detail.ts`
- `src/lib/tasks/notifications.ts`

**Work:**

1. Add fixtures for comment/file mutation phases: not started, required DB rollback, committed with
   warnings, and idempotent replay.
2. Add a typed activity event/meta union for existing and planned event types; retain an unknown
   historical row shape for rendering only.
3. Add green characterization tests for the stable behavior that must not regress. For every later
   fix, write the failing regression/fault-injection case inside that task, then commit test and fix
   together so no focused commit leaves the branch red.
4. Add a pure client submission/file-state reducer if component DOM tests remain unavailable.
5. Do not alter production behavior in this commit beyond type-safe extraction needed by tests.

**Verification:** Targeted Vitest suite and typecheck pass. Planned bug cases are documented in the
test matrix but are not committed as permanently failing tests.

**Commit:** `test(tasks): cover comment attachment activity failure boundaries`

> **[[Claude]]** Steps 4 and 5 contradict each other. Step 5 says "do not alter production
> behavior"; step 4 says add a client submission/file-state reducer. Extracting that reducer out of
> `CommentThread` **is** a production change — unless it is written as dead code nothing imports,
> which is worse. Resolve one way: either (a) Task 1 stays test-and-types only and the reducer is
> born inside Task 3 where its first caller lives, or (b) Task 1 explicitly owns a pure
> extract-and-rewire refactor whose contract is "identical rendered behaviour, proven by the
> characterization tests written in the same commit". Option (a) is simpler and keeps the "no
> behaviour change" promise honest.
>
> Also note `vitest.config.ts` runs `environment: "node"` with `include: ["src/**/*.test.ts"]` —
> **`.tsx` files are not collected and there is no DOM harness.** Every test this plan promises for
> client behaviour must therefore be a pure `.ts` reducer/helper test, or the task needs to add a
> jsdom project first. Do not write a task whose verification silently never runs.

### Task 2 — Make Task comment creation atomic, monotonic, and idempotent

**Files:**

- `supabase/schema.sql`
- `src/app/api/tasks/[id]/comments/route.ts`
- `src/lib/tasks/participants.ts`
- new small Task comment command helper if needed

**Schema/command:**

1. Add nullable `client_request_id uuid` to `task_comments`.
2. Add a partial unique index over `(task_id, author_email, client_request_id)` where request ID is
   not null.
3. Add one `create_task_comment_atomic` command that:
   - locks the task;
   - validates parent belongs to the task and is top-level;
   - inserts or returns the replayed comment;
   - inserts `comment_added` exactly once with `comment_id`/`parent_id` metadata;
   - upserts validated mentioned participants and fails atomically on error;
   - on a new insert, computes strictly monotonic DB time and updates `updated_at`,
     `last_activity_at`, `last_activity_by_email`, and `stale_reminded_at`;
   - on replay, does not touch timestamps or duplicate activity;
   - returns canonical comment, canonical parent timestamp, and `was_created`.
4. Route validates text/request UUID/mentions, calls the command, then performs notifications and
   broadcasts as warning-only side effects.
5. Return the same successful payload on replay. Do not use body-text deduplication.

**Verification:** F2-F4 and F9 tests; comment then immediate task PATCH; DB failure rollback; same
request replay.

**Commit:** `fix(tasks): commit comments atomically and idempotently`

### Task 3 — Harden shared composer and independent file status

**Files:**

- `src/app/(authed)/tasks/_components/CommentThread.tsx`
- `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`
- pure state helper/test added in Task 1

**Work:**

1. Generate a stable `crypto.randomUUID()` request ID for each user submission.
2. Add a synchronous ref guard before starting fetch, plus visible `sending` state. Disable Send,
   Enter submission, Clear, and draft mutation that would lose the in-flight payload.
3. Do not clear the only recoverable draft until comment response establishes canonical success;
   preserve a clear retry path on pre-commit failure.
4. Once a comment commits, never label the comment itself failed because a file or reload failed.
5. Model every file independently: local ID, upload request ID, pending/uploading/success/failed,
   error, and retry. Preserve successfully uploaded files when another fails.
6. Limit bounded parallel uploads to two after correctness is in place.
7. Revoke all local object URLs on success, explicit discard, task change, and component unmount.
8. Make drawer `reload` return/throw a meaningful result. A reconciliation failure shows a small
   retry warning but does not roll back committed optimistic state.
9. Preserve the shared API response contract for Enrollment and run ACA/Medicare regression checks.

**Verification:** F4/F5 client tests and browser matrix; React Strict Mode; close/reopen during
upload; Enrollment shared thread.

**Commit:** `fix(comments): separate durable comment and file upload states`

> **[[Claude] — the scope gap that matters most in this plan]**
> §1 scopes the Enrollment API out ("The Task API and Task schema remain the primary correctness
> scope"), but this task changes the **shared** client. Those two decisions collide.
>
> I verified `src/app/api/enrollment/[id]/comments/route.ts` is a **separate 7.6 KB implementation**,
> not a wrapper over the Task route. It has no `client_request_id` and no idempotency key of any
> kind. So after Task 3 ships, the shared composer will mint a stable request UUID and send it to
> both products, **only the Task route will honour it** (Task 2), and ACA/Medicare keep the exact
> F4 duplicate-comment defect — while the UI now behaves as though submissions are protected. That
> is worse than today, because the failure becomes invisible.
>
> Two things to note in that route's favour, since they change what work is actually needed: it
> captures `nowIso` *after* the insert (so it does **not** have F2's backwards-version bug), and it
> *does* check `activityError` (so it does not have F3's silent-audit-loss bug). The gap is
> genuinely idempotency-only.
>
> Pick one and write it down before starting Task 3:
> 1. **Extend Task 2's contract to the Enrollment comment route** (accept + enforce
>    `client_request_id`). Small, additive, closes F4 on all three products. **Recommended.**
> 2. **Gate the client**: only send the request ID when the target API advertises support, and
>    state in the plan that F4 remains open on ACA/Medicare with a named owner.
>
> Silently doing neither is the current state of the plan.

### Task 4 — Make attachment upload idempotent and compensating

**Files:**

- `supabase/schema.sql`
- `src/app/api/tasks/[id]/attachments/route.ts`
- `src/lib/tasks/storage.ts`
- `src/lib/tasks/attachments.ts`
- related tests

**Work:**

1. Add nullable `client_request_id uuid` to `task_attachments` and a partial unique key scoped to
   task/uploader/request ID.
2. Resolve authentication and base task view access before reading the multipart file body.
3. Accept client upload ID through a documented field/header and validate UUID.
4. Check idempotent replay before creating a new object; return the existing signed attachment.
5. Validate file and operation limits.
6. Upload and sign the new unique path before metadata commit.
7. On upload/sign/metadata failure before commit, remove only the new attempt's path.
8. Commit attachment metadata and `attachment_added` activity exactly once. Comment-linked file
   activity does not bump parent task version a second time; standalone legacy upload does.
9. Treat notification, broadcast, and reconciliation errors as warnings after commit.
10. Broadcast both room and global list because attachment count changes.
11. Keep the bucket private and signed URL lifetime unchanged in this task.

**Verification:** F6 fault matrix, replay, two identical filenames with different IDs, cross-task
comment ID, permission matrix, storage reconciliation.

**Commit:** `fix(attachments): add idempotent upload compensation`

### Task 5 — Make comment edit/delete and attachment delete atomic and auditable

**Files:**

- `supabase/schema.sql`
- `src/app/api/tasks/[id]/comments/[cid]/route.ts`
- `src/app/api/tasks/[id]/comments/[cid]/edits/route.ts`
- `src/app/api/tasks/[id]/attachments/[aid]/route.ts`
- `src/app/(authed)/tasks/_components/CommentThread.tsx`
- related tests

**Work:**

1. Add expected comment `updated_at` to PATCH and implement atomic compare-and-swap edit:
   history snapshot + body update + `comment_edited` activity + parent last-activity/version.
2. Return 409 for stale edits and return the canonical comment/task versions on success.
3. Reuse structured mention selection while editing. Add participants atomically; notify only
   newly mentioned users after commit.
4. Implement atomic comment delete under the retention contract in Section 6.4. Preserve replies,
   write `comment_deleted`, remove linked metadata from active surfaces, and return cleanup paths.
5. Change attachment delete to metadata/audit first and physical object cleanup second. Return 2xx
   with warnings after committed deletion; never invite a retry that changes canonical state twice.
6. Broadcast task room and global list after every committed edit/delete that affects visible
   detail or counters.
7. UI shows edit/delete/storage-cleanup failures explicitly. Edit-history fetch errors must not be
   presented as “No previous versions.”

**Verification:** F1/F7/F8 tests; two-tab edit; parent-with-replies delete; cleanup failure; list
counts/search/realtime in two tabs.

**Commit:** `fix(tasks): make comment and attachment changes auditable`

> **[[Claude]]** This is three independent tasks wearing one commit message. It bundles (a) an
> atomic compare-and-swap comment edit with 409 semantics and mention diffing, (b) a comment-delete
> retention contract that touches metadata, counts, and search, and (c) reversing the attachment
> delete order — which is **F1, a P1 CRITICAL**, the single highest-priority fix in the document.
> A reviewer cannot approve the P1 without also approving two P2 redesigns, and the P1 cannot ship
> early.
>
> Split it, and pull the P1 forward:
> - **5a — F1 only:** attachment delete becomes metadata-and-audit first, storage cleanup after
>   commit as best-effort. Pairs naturally with Task 9's per-file `Promise.allSettled` signing,
>   which is the other half of F1. Ship this first; it is the go-live blocker.
> - **5b — F7:** atomic CAS comment edit + `comment_edited` activity + parent touch + 409.
> - **5c — F8:** comment delete retention contract + `comment_deleted` + count/search exclusion.
>
> Step 7 (UI error surfacing) belongs to Task 13, not here — it depends on typed results from all
> three and will otherwise be written twice.

### Task 6 — Align notification delivery with canonical mention state

**Files:**

- `supabase/schema.sql`
- `src/lib/tasks/notifications.ts`
- comment create/edit routes
- notification tests

**Work:**

1. Add a partial unique index for comment-linked notifications so one recipient/comment has one
   canonical notification.
2. Preserve “mentioned wins over commented” before insert.
3. Make comment notification insertion replay-safe with upsert/ignore-conflict semantics.
4. Broadcast only recipients whose notification state was inserted or intentionally reconciled.
5. Keep notification failure warning-only after canonical comment commit; record structured logs
   with task/comment/request IDs, never comment body.

**Verification:** Idempotent comment replay, recipient overlap, newly mentioned edit, notification
DB failure, and immediate notification deep-link permission.

**Commit:** `fix(notifications): dedupe comment delivery after commit`

### Task 7 — Unify last-activity and activity event semantics

**Files:**

- `supabase/schema.sql`
- `src/lib/tasks/activity.ts`
- `src/lib/tasks/last-activity.ts` (replace/remove only after all callers migrate)
- `src/lib/tasks/queries.ts`
- `src/app/api/tasks/route.ts`
- `src/app/api/tasks/[id]/route.ts`
- `src/app/api/tasks/[id]/assignees/[email]/route.ts`
- `src/app/(authed)/tasks/_components/ActivityFeed.tsx`
- activity/query tests

**Work:**

1. Add `tasks.last_activity_by_email` and backfill from the latest substantive non-system event.
   Produce a dry-run comparison before applying the backfill.
2. Update atomic task commands to write last-activity time/actor together. Do not update either for
   system reminders or position-only reorder.
3. Add activity for custom-value edits so substantive field changes remain represented.
4. Make `task_list_metadata` return the denormalized canonical actor instead of independently
   selecting the latest activity row. Keep response field name unchanged.
5. Correct assignee removal to `unassigned`; render historical `assigned` rows with
   `meta.removed` compatibly.
6. Align SQL allowed types, typed event union, writers, and renderer for comment/file lifecycle.
7. Render meaningful unknown-event fallback and category/priority values where labels are
   available.
8. Log task archive if product requires archive in the retained audit; otherwise remove the dead
   renderer case and document exclusion.

**Verification:** F10, F11, and F14 tests; current 11 actor/time mismatches go to zero;
list/export/sort; stale cron; assignment removal; every allowed type fixture.

**Commit:** `fix(activity): align task audit and last activity ownership`

### Task 8 — Make initial creation and overdue transition atomically auditable

**Files:**

- `supabase/schema.sql`
- `src/app/api/tasks/route.ts`
- `src/app/api/cron/check-overdue/route.ts`
- task create/cron tests
- data-audit/backfill script from Task 15

> **[[Claude]]** Forward dependency: this task consumes a script that Task 15 creates, seven tasks
> later. Step 6 then asks for a "dry-run repair report" using it. As written the task cannot be
> executed in order. Move the read-only audit/backfill script to its own early task (before Task 7,
> which is the first task that actually needs a dry-run comparison for the
> `last_activity_by_email` backfill), and leave Task 15 owning only the *final re-run* of those
> same audits. The script must be read-only-by-default with destructive actions behind an explicit
> flag plus an approved target list.

**Work:**

1. Add stable client request ID to initial task create and an idempotent atomic create command for
   task, canonical assignees, initial stage/assignment cycles, required history, and `created`
   activity.
2. Decide queue rotation transaction placement from its invariants. If it remains post-commit,
   return a warning and record enough canonical input for safe reconciliation; never return a
   retryable 500 for the already-created task.
3. Make initial notifications/broadcasts post-commit warning-only and replay-safe.
4. Add `mark_task_overdue_atomic` with conditional row lock/update, one open overdue event, and one
   `went_overdue` activity in the same transaction.
5. Cron sends notifications/broadcasts only when the command reports a newly committed transition.
6. Generate a dry-run repair report for the current 11 activity gaps and eight event gaps. Backfill
   only records whose time/source can be derived without invention; otherwise mark them as legacy
   repaired with explicit source metadata after owner approval.

**Verification:** F12/F13 fault tests; duplicate create replay; two concurrent cron calls; user
status transition racing cron; task/activity/history and overdue/event/activity counts reconcile.

**Commit:** `fix(activity): atomically audit task create and overdue`

### Task 9 — Make detail authorization, signing, and cache resilient

**Files:**

- `src/app/api/tasks/[id]/detail/route.ts`
- `src/lib/tasks/detail.ts`
- `src/lib/tasks/detail-cache.ts`
- `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`
- `src/app/(authed)/tasks/_components/CommentThread.tsx`
- detail/cache tests

**Work:**

1. Resolve authorization before loading comments/activity or signing files.
2. Do not query activity for a role that cannot receive it.
3. Sign each attachment independently with `Promise.allSettled`; return typed availability/error
   state without exposing storage internals.
4. Render an unavailable attachment placeholder and keep the rest of detail usable.
5. Add cache timestamp/TTL below one-hour URL expiry, invalidate on relevant room event/mutation,
   and surface reconciliation failure with retry.
6. Keep comments/activity eager for now. Current maxima (5 comments, 14 activity rows) do not
   justify pagination or virtualization.
7. Add a threshold note: introduce cursor pagination only after measured records exceed 100
   comments or the 200-activity cap. If the cap is reached first, show “latest 200” rather than a
   false total.

**Verification:** F1/F15/F16 tests; unauthorized call instrumentation; one broken file with healthy
comments; fake-time cache expiry; browser slow-network check.

**Commit:** `fix(task-detail): isolate file failures and stale signed urls`

### Task 10 — Enforce operation limits and database invariants

**Files:**

- `supabase/schema.sql`
- Task comment/attachment routes
- `src/lib/tasks/attachments.ts`
- shared composer
- tests and operations documentation

**Work:**

1. Query real comment/file distributions again before applying limits.
2. Enforce the default limits in Section F17 on client and server; use clear 4xx responses.
3. Enforce same-task/top-level-parent and same-task/comment-attachment invariants inside canonical
   commands. Add constraint triggers only if non-command writers must remain supported.
4. Add indexes needed by active comment attachment lookup and idempotency constraints.
5. Move repeated bucket configuration mutation out of the upload hot path into deployment/setup,
   while keeping local bootstrap documented.
6. Document malware-scanning risk and owner decision. Do not add a vendor/library without explicit
   approval and operational ownership.

**Verification:** F17/F18 tests; current data validation; accepted real file corpus; load test with
bounded concurrent uploads.

**Commit:** `fix(tasks): enforce collaboration input and integrity limits`

### Task 11 — Return canonical person names for comments and edit history

**Files:**

- new small server-only batched person-name resolver under `src/lib/people/` (or the nearest
  existing server-only people module)
- `src/lib/tasks/detail.ts`
- `src/lib/enrollment/detail.ts`
- `src/lib/enrollment/types.ts`
- Task and Enrollment edit-history routes
- `src/app/(authed)/tasks/_components/CommentThread.tsx`
- detail/edit-history tests for both products

**Work:**

1. Define additive typed response fields: every comment has `author_name: string`; every edit row
   has `edited_by_name: string`. Retain email identity fields for compatibility and authorization.
2. Collect distinct author/editor emails and resolve them in one batched `portal_account` query,
   including inactive accounts. Normalize lookup keys consistently and avoid one query per row.
3. Use the latest non-empty canonical `portal_account.name`. Resolve absent/nameless accounts to
   one neutral product fallback; never call `formatEmailAsName()` for historical comment/editor
   display.
4. Apply the same helper/response contract to Task and Enrollment. Do not depend on
   `mentionMembers`, `fetchTaskAssignees()`, or `fetchEnrollmentPeople()` because all three are
   active-roster views, not historical identity stores.
5. Update optimistic rows with the authenticated user's resolved display name and render only the
   response name in normal, deleted, edit, and edit-history surfaces. Do not put raw email in a
   tooltip, title, accessible label, or error message.
6. Keep avatar color identity stable using normalized email internally. The avatar's accessible
   label is the display name.
7. Document the intentional behavior that an account rename updates the name shown on older
   comments. Do not add a display-name snapshot migration without a separate audit requirement.

**Verification:** F19 Task/Enrollment route tests; active/inactive/missing/renamed accounts;
optimistic-to-canonical transition; DOM/text assertion that view/edit/history/deleted states expose
no email.

**Commit:** `fix(comments): resolve canonical author and editor names`

### Task 12 — Unify create, reply, and edit tagging

**Files:**

- `src/app/(authed)/tasks/_components/CommentThread.tsx`
- a small shared comment-mention draft helper/component under the existing shared UI boundary
- `src/lib/tasks/mentions.ts`
- `src/lib/ui/option-search.ts` (reuse; do not create a third normalization implementation)
- Task and Enrollment comment edit routes from Task 5
- mention parser/draft/component tests

**Work:**

1. Extract decode/encode, active-token detection, selected identity state, filtering, and keyboard
   movement from `Composer` into testable shared mention logic. Preserve stored
   `@[Label](email)` syntax.
2. Reuse the exact same draft editor in top-level comment, reply, and `EditCommentForm`. During
   edit, decode existing tokens losslessly and keep their email identity even if the account is no
   longer selectable.
3. Use `normalizeOptionSearchText()` for canonical name, optional email keyword, and role/team
   keywords. Search may match email internally; rendered read/edit UI remains name-only.
4. A user must choose a result before text becomes a structured tag. Plain `@foo` remains plain
   and does not notify. Support removing a tag without leaving a hidden mention email behind.
5. Build a caret-anchored, viewport-safe picker with avatar, canonical name, role/team secondary
   label, `No matching people`, and result count. Duplicate names must be distinguishable by
   non-email context where roster role/team data is available.
6. Implement stable option IDs, combobox/listbox relationship, `aria-activedescendant`, Arrow Up/
   Down, Enter/Tab select, Escape close, IME safety, and focus/caret preservation. Do not double-
   handle Escape at document and panel levels.
7. Render tags as compact soft-blue chips using canonical current names. The stored label is a
   backward-compatible fallback only when identity resolution is genuinely unavailable; in that
   case use the neutral identity label, not email.
8. On edit, submit mention-email diff to the atomic edit contract: add participant visibility and
   notify only newly added valid identities after commit. Removing a tag does not retroactively
   revoke task visibility unless a separately approved policy says so.

**Verification:** F20/F21 tests; Vietnamese accented/unaccented/`đ`, duplicate name, zero result,
mouse/keyboard/VoiceOver/IME, existing inactive tag, changed account name, add/remove during edit,
and Task/ACA/Medicare parity.

**Commit:** `fix(comments): unify searchable mentions across edit and create`

### Task 13 — Polish comment thread interaction and mutation feedback

**Files:**

- `src/app/(authed)/tasks/_components/CommentThread.tsx`
- `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx`
- `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- pure thread-position/count/time helpers and tests

**Work:**

1. Apply the visual hierarchy in Section 6.5: compact aligned header, name-first identity, muted
   time, readable body, safe wrapping, consistent hover/focus actions, subtle replies rail, and a
   clearer deleted placeholder with author/time.
2. Keep the composer visually quiet and task-focused: auto-grow within a bounded height, clear
   focus state, attachment strip, short `Enter to send · Shift+Enter for new line` hint, and one
   primary Send button. Do not sacrifice recoverable draft semantics from Task 3 for appearance.
3. Map typed send/edit/delete/history/reconciliation results to adjacent pending, warning, error,
   and Retry UI with `role=status`/`role=alert`. Never render an API/storage/internal path.
4. Add an accessible delete-confirmation dialog. State whether replies remain and whether linked
   files will be removed. Keep author-only permission and Task 5 retention behavior unchanged.
5. Track whether the reader is near the bottom. Follow own successful send and remote messages
   only while near bottom; otherwise show a small `New comments` button/count. Deep-link highlight
   always wins and must not then snap to bottom.
6. Use canonical active comment count (replies included, deleted excluded) returned by metadata in
   Task and Enrollment tabs/list. Do not derive the visible count from raw `comments.length`.
7. Refresh relative labels with one shared one-minute timer per open thread and keep exact local
   datetime in the accessible title. Pause unnecessary updates while the document is hidden.
8. Make reply indentation responsive and ensure 320 px drawer layouts retain usable composer and
   text width.

**Verification:** F22/F23 plus visual snapshots at desktop/tablet/mobile; local/remote message at
top/bottom, deep link, deleted parent with replies, stale edit, offline Retry, count reconciliation,
fake time, keyboard and screen reader checks across Task/ACA/Medicare.

**Commit:** `fix(comments): polish thread feedback and navigation`

### Task 14 — Make comment attachment UI resilient and accessible

**Files:**

- `src/app/(authed)/tasks/_components/CommentThread.tsx`
- shared accessible dialog primitive if one already exists; do not create a competing modal system
- attachment formatting/state helpers and tests

**Work:**

1. Consume Task 3 file-operation states and Task 9 typed availability. Render file type icon,
   safely truncated name, formatted size, pending/uploading/success/failed/unavailable state, and
   per-file Retry/Remove where allowed.
2. Add the server-supported extension/MIME list to file-input `accept` as chooser guidance, plus
   client feedback for duplicate, unsupported, per-file, count, and aggregate-size violations.
   Server validation remains authoritative.
3. Keep images as restrained thumbnails with an explicit Preview action/focus label; provide an
   equivalent Open action for non-images and unavailable-state reason without storage details.
4. Upgrade preview to a complete dialog: labelled title, initial close focus, Tab trap, Escape,
   backdrop close, focus restoration, scroll lock, loading/error state, and open/download original.
5. Constrain image dimensions without cropping the full preview, preserve aspect ratio, and ensure
   long filenames/URLs cannot overflow desktop or 320 px viewport.
6. Do not add image transformations, public URLs, a new modal library, or a changed signed-link
   lifetime in this task.

**Verification:** F24 plus supported/unsupported/duplicate/oversize files, slow/expired/broken
signed URL, keyboard focus cycle and restoration, screen reader labels, portrait/landscape image,
long filename, and Task/ACA/Medicare responsive parity.

**Commit:** `fix(comments): harden attachment presentation and preview`

### Task 15 — Reconcile data and run end-to-end regression

**Files:**

- add a read-only-first reconciliation script under `scripts/` if no suitable operations path
  exists;
- `docs/changelog.md` or repository changelog used by current work;
- this plan's Execution Log.

> **[[Claude]]** `docs/changelog.md` does not exist. The repository changelog is
> **`agent-portal/changelog.md`** (repo root, ~65 KB, actively maintained). Name it directly rather
> than leaving "or repository changelog used by current work" — that hedge is how a task ends up
> creating a second changelog. Every logic change in this plan gets an entry there; that is a
> standing project rule, not a Task 15 nicety, so entries should be written **per task** as they
> land, not batched at the end where they will be reconstructed from memory.

**Work:**

1. Re-run comment/activity, attachment/storage, parent/task-link, notification, and last-activity
   audits.
2. Report the two current duplicate-comment groups for manual owner review. Do **not** delete based
   only on identical content/timing.
3. Reconcile orphan objects and broken metadata in dry-run mode. Any destructive cleanup requires
   explicit target list and approval.
4. Run full test, typecheck, lint, and build.
5. Browser-test Tasks plus ACA/Medicare shared CommentThread flows, including name-only identity,
   create/reply/edit tags, mutation feedback, scroll behavior, and attachment preview.
6. Run an automated UI text scan/fixture assertion proving comment cards, deleted placeholders,
   edit forms, and history do not render raw emails.
7. Record remaining accepted P3 risks and final subsystem go-live status.

**Verification:** Commands in Section 9 plus the full manual matrix.

**Commit:** `docs(tasks): record collaboration hardening verification`

## 8. Regression boundaries

Do not change these behaviors without a separately approved product decision:

- Any authorized task viewer may comment; task field edit permission remains separate.
- Comment edit/delete remains author-only unless moderation requirements are explicitly approved.
- Replies remain one level deep.
- Deleted parent placeholder and surviving replies remain visible.
- Task bucket remains private; links remain short-lived signed URLs.
- Per-file maximum remains 15 MiB unless measured product need changes it.
- Mention tokens remain `@[Label](email)` in stored bodies.
- Comment and edit-history display uses canonical names; email remains an internal identity key and
  may be a hidden search keyword, not visible read/edit/history text.
- Account renames update historical display labels; no immutable name snapshot is introduced.
- `CommentThread` stays compatible with Task and Enrollment response shapes.
- Activity access remains manager/agent-owner scoped as currently resolved; this plan hardens data,
  not role policy.
- Realtime remains a content-free hint. Canonical state is always reloaded through authenticated
  HTTP APIs.

## 9. Verification commands and manual matrix

Run after each relevant task, then all together:

```bash
npm test -- --run \
  src/lib/tasks/activity.test.ts \
  src/lib/tasks/detail.test.ts \
  src/lib/tasks/storage.test.ts \
  src/lib/tasks/notifications.test.ts \
  src/lib/tasks/mentions.test.ts \
  <new comment/attachment route and state tests>

npm run typecheck
npm run lint
npm run build
```

Manual browser cases:

1. Send by click, Enter, rapid Enter, and double-click.
2. Same text submitted deliberately twice after first success.
3. Slow comment POST; close/reopen drawer; navigate to another task.
4. Comment-only, file-only, comment plus one file, comment plus ten files.
5. First/middle/last file fails; retry only failed file.
6. File upload commits but notification/realtime/reload fails.
7. Edit in two tabs; stale tab receives 409 and keeps its draft.
8. Add mention during create/edit; recipient opens notification immediately.
9. Delete parent with replies and comment with files.
10. Storage cleanup fails after DB delete; drawer/list/search remain canonical.
11. One metadata row references a deliberately unavailable test object; drawer still opens.
12. Signed URL expires while app remains open; reopening refreshes without broken stale link.
13. Manager, plain CS, assignee, participant, agent owner/assistant, and unauthorized account.
14. Human comment followed by overdue cron; Last activity time/actor stay paired.
15. Add/remove one of multiple assignees; activity wording is correct.
16. ACA and Medicare comment/file smoke test because `CommentThread` is shared.
17. Active, inactive, renamed, nameless, and missing author/editor account; no visible email in
    comment, deleted placeholder, edit form, edit history, title, or accessibility tree.
18. Tag by mouse and keyboard in create/reply/edit; Vietnamese accented/unaccented and `đ`; same
    display name with different roles; zero-result menu; existing inactive mention.
19. Screen reader announces picker active option, send/upload/edit/delete status, empty/error
    states, and dialog labels without duplicate Escape handling.
20. Remote comment while reader is at bottom versus reading old messages; New comments control;
    own send; deep-link highlight; active count after deletion.
21. 320/375/768/desktop widths with long URL, long Unicode token, long filename, reply, ten file
    chips, and mention picker near every viewport edge.
22. Image preview by mouse and keyboard: loading, failure, expired URL, Tab containment, Escape,
    backdrop close, open/download, and focus restoration.

## 10. Explicit optimization decisions

Implement now:

- eliminate duplicate requests rather than merely debouncing them;
- bounded two-file upload concurrency after independent retry state exists;
- avoid signing/reading detail before authorization;
- isolate signed URL failure per file;
- short, explicit cache TTL and mutation invalidation;
- denormalized paired last-activity actor/time to remove repeated ambiguous activity lookup;
- one batched historical display-name lookup per detail/history response, never N+1;
- shared pure mention filtering/keyboard logic and one low-frequency thread clock.

Deliberately defer:

- comment virtualization or cursor pagination: current maximum is five per task;
- activity pagination UI: current maximum is 14; only add truthful cap messaging if needed;
- server-side file search changes: current volume is one attachment;
- lazy sign-on-click: resilience and cache expiry fix the current risk with less UI churn;
- new malware-scanning vendor: needs security/product ownership, cost, quarantine, and support plan;
- rich-text/WYSIWYG editor, reactions, nested replies, presence/typing indicators, drag-drop/paste
  uploads, and comment virtualization: none is required to fix the confirmed go-live issues.

## 11. Execution Log

| Task | Status | Commit | Verification | Notes |
|---|---|---|---|---|
| Audit/plan | Complete | N/A | 31 targeted tests passed; read-only DB/storage audit complete | No implementation or data mutation performed |
| Task 1 | Pending | — | — | — |
| Task 2 | Pending | — | — | — |
| Task 3 | Pending | — | — | — |
| Task 4 | Pending | — | — | — |
| Task 5 | Pending | — | — | — |
| Task 6 | Pending | — | — | — |
| Task 7 | Pending | — | — | — |
| Task 8 | Pending | — | — | — |
| Task 9 | Pending | — | — | — |
| Task 10 | Pending | — | — | — |
| Task 11 | Pending | — | — | — |
| Task 12 | Pending | — | — | — |
| Task 13 | Pending | — | — | — |
| Task 14 | Pending | — | — | — |
| Task 15 | Pending | — | — | — |
