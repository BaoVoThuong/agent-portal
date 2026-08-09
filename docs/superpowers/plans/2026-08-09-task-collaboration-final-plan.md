# Task Comments, Attachments & Activity — Final End-to-End Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> **This document is self-contained.** It carries both the diagnosis (§2, what is broken and the
> evidence) and the treatment (§6, twenty-five tasks). You do not need to open the audit document to
> execute it. Read the current source before changing it — other agents commit to this worktree.

**Goal:** Make Health CS task comments, attachments, and the activity trail commit atomically,
replay safely, and degrade per-file — so a committed action is never reported as failed, a retry
never duplicates, one broken attachment never hides a task's whole conversation, and the audit trail
describes what actually happened.

**Architecture:** Move every *required* multi-row write behind a single Postgres command (the pattern
`patch_task_atomic` already establishes in this repo), and demote notifications, realtime, storage
cleanup, and reconciliation fetches to post-commit best-effort work that returns `warnings` with a
2xx. Client-side, split one "did the send work" boolean into independent comment-state and
per-file-state, each carrying a stable idempotency UUID. Column-level monotonicity for
`tasks.updated_at` is enforced by a trigger so no writer — present or future — can regress the
optimistic-concurrency token.

**Tech Stack:** Next.js 16.2.4 (App Router route handlers), React 19, TypeScript, Supabase
(Postgres + Storage + Realtime), Vitest (node environment), Tailwind.

---

## 1. Provenance and confidence

This plan supersedes two earlier documents and folds both into one:

| Source | What it contributed |
|---|---|
| `2026-08-09-task-comments-attachments-activity-hardening.md` | The original 24-finding audit: failure modes, severities, target contracts, regression boundaries |
| `2026-08-09-task-collaboration-hardening-execution.md` | The task breakdown, SQL commands, and TDD steps |

**Verification status.** Every finding below was independently re-checked against the working tree at
`HEAD 78208aa`. Twenty of the twenty-four were confirmed down to the exact source lines and are
marked **[verified]**. Four (F6, F12, F17, F18) were checked for consistency with surrounding code
rather than line-by-line and are marked **[consistent]**. Two claims rest on read-only database
queries that cannot be re-run from here and are marked **[point-in-time]** — re-confirm them with
Task 1 before acting on them.

One finding was actively challenged and survived: F14 looked like it should be P1, because
`ActivityFeed` renders activity types that the `task_activity_type_check` constraint forbids — which
would mean those inserts were failing silently. They are not. Those writers target
`enrollment_activity` and `task_notifications`, never `task_activity`. **F14 is correctly rated P3**;
the renderer branches are dead code, not a live failure.

---

## 2. What is broken

### 2.1 The two commit boundaries that do not exist

```text
Composer clears immediately
  -> optimistic comment + local blob previews
  -> POST comment
       -> insert task_comments                         COMMITTED
       -> insert task_activity          (error ignored)
       -> add mentioned participants    (error ignored)
       -> insert notifications          (MAY THROW -> 500)
       -> update task timestamps        (MAY THROW -> 500)
       -> broadcasts
  -> upload file 1                                    SEPARATE COMMIT
  -> upload file 2                                    SEPARATE COMMIT
  -> reload entire detail
  -> remove optimistic row
```

Nothing spans the canonical comment, its required activity row, participant visibility, and the task
version. Two of the later steps can throw *after* the comment is durable, turning a successful write
into a retryable 500 — and the retry creates a duplicate.

```text
Attachment deletion
  remove private storage object                       IRREVERSIBLE
    -> delete task_attachments metadata
    -> response
```

If the metadata delete fails, a visible row now points at a missing object. Detail loading signs all
attachment paths with one `Promise.all`, and `signTaskFile` throws on failure, so that one row makes
the whole task drawer return 500.

### 2.2 Finding catalogue

Severity gate: **P1 must ship before go-live. P2 should ship before go-live; any deferral needs a
named owner and a documented workaround. P3 follows correctness work.**

| ID | Sev | What is wrong | Verified evidence |
|---|---|---|---|
| **F1** | **P1** | Attachment deletion removes the storage object *before* the metadata row, and detail loading signs every attachment with one `Promise.all`. A failed metadata delete leaves visible metadata pointing at nothing, and that one row makes the entire drawer 500 — comments and activity become unreachable because of an unrelated file. | **[verified]** `attachments/[aid]/route.ts`: `await removeTaskFile(...)` then `.delete()`, `if (error) → 500`. `detail.ts`: `Promise.all(...signAttachment)`; `storage.ts:77-84` `signTaskFile` throws. |
| **F2** | **P1** | `POST comments` captures `nowIso` *before* parent validation, insert, activity, mention resolution, and notification insert, then writes that stale timestamp unconditionally into `updated_at` and `last_activity_at` — and returns it to the client as the concurrency token. A slow comment can move the task version **backwards** past a newer PATCH, defeating the 409 check. | **[verified]** `comments/route.ts:112` captures; `touchLastActivity` writes it unconditionally; the same value is returned as `parent_updated_at`. |
| **F3** | **P2** | The same route mixes required and best-effort writes with no commit boundary. The `comment_added` activity insert result is **never checked** (silent audit loss). `insertNotifications` and `touchLastActivity` can throw *after* the comment committed, returning 500 for a durable comment — which the user then retries. | **[verified]** `comments/route.ts:128-188`; the activity insert is a bare `await ... .insert(...)`. |
| **F4** | **P2** | No synchronous in-flight guard client-side (`post()` always `return true`), no idempotency key server-side. Double-click, held Enter, or a retry after an ambiguous response each create a new row. | **[verified]** code: `CommentThread.tsx:335-368`. **[point-in-time]** data: two exact-duplicate groups created 0.647 s and 1.175 s apart. |
| **F5** | **P2** | One `try/catch` wraps the comment POST, every sequential file upload, **and** `onReload()`. Any file failure — or a reload failure, which is not a mutation at all — marks the whole optimistic comment `failed: true`. Because `realId` is already set by then, the real server comment is hidden behind the failed row by `shadowedIds`. | **[verified]** `CommentThread.tsx:371-435`. |
| **F6** | **P2** | Upload parses the full multipart body into memory *before* any permission check; uploads the object *before* metadata with no compensation; and signs the URL *after* the metadata commit inside the response literal, so a signing failure 500s a durable attachment. No idempotency key. Additionally the comment-linked branch writes **no `attachment_added` activity at all**, and the standalone branch writes `meta: { file_name }` — which leaks customer-identifying data into the audit trail. | **[consistent]** `attachments/route.ts:118-222`. |
| **F7** | **P2** | Comment edit inserts the history snapshot **without checking the error**, then updates the body in a second unguarded statement. Two tabs is last-write-wins; history can be missing, duplicated, or record a version that never became canonical. The edit emits no activity, never touches task last-activity, and never re-parses mentions. | **[verified]** `comments/[cid]/route.ts:91-120`. |
| **F8** | **P2** | Delete sets only `deleted_at` and `body: ""`. Attachments stay in storage, in `task_attachments`, in the list's attachment count, and **searchable by filename** — they vanish from the thread only because the deleted-comment branch returns before rendering them. No `comment_deleted` audit row; only the room is broadcast, so other tabs keep stale counters. | **[verified]** `comments/[cid]/route.ts:123-136`; `CommentThread.tsx:686-693`; `search.ts:370-388` has no `deleted_at` filter. |
| **F9** | **P2** | `addParticipants` discards its upsert result **entirely** — the error is never even assigned. A mention can therefore be notified while its visibility write failed, so the recipient clicks the notification and gets 403. | **[verified]** `participants.ts:46-61`. |
| **F10** | **P2** | Last-activity *time* is read from `tasks.last_activity_at`; last-activity *actor* is independently derived from the newest `task_activity` row — including `actor_email: 'system'` rows written by cron, which does not touch the time. The list therefore shows one event's time next to another event's actor. The identical bug exists a second time in the legacy fallback. | **[verified]** `schema.sql` `task_list_metadata` actor subquery; `queries.ts:239-244`. **[point-in-time]** 11 affected tasks. |
| **F11** | **P2** | Removing an assignee writes activity type `"assigned"` with `meta: { removed, to }`. The renderer's `case "assigned"` reads only `meta.to`, so the feed says **"assigned to \<the remaining person\>"** for a removal. A correct `unassigned` branch exists in the renderer — nothing writes it. | **[verified]** `assignees/[email]/route.ts:101`; `ActivityFeed.tsx`. |
| **F12** | **P2** | Task creation writes task, assignees, rotation, activity, history, notifications in six separate steps with no transaction. Rotation failure returns 500 **after the task exists**, so a retry creates a duplicate task. The `created` activity insert result is never checked. | **[consistent]** `tasks/route.ts:253-373`. |
| **F13** | **P2** | Cron's overdue branch runs three separate awaits and ignores the activity insert result. It has a `.is("overdue_flagged_at", null)` guard on the update but **never checks whether the update matched a row**, so two concurrent runs both proceed to write an event and an activity row. | **[verified]** `cron/check-overdue/route.ts:188-243`. **[point-in-time]** 110 overdue-marked tasks vs 99 with `went_overdue`; 8 with no event history. |
| **F14** | P3 | SQL constraint, writers, and renderer share no typed contract. `ActivityFeed` has branches for nine types `task_activity` can never hold, and **no branch for `attachment_added`**, which the constraint does allow — so it renders as raw snake_case. Comment edit/delete and attachment delete have no event types at all. | **[verified]** `schema.sql` type check (16 types, `not valid`); `ActivityFeed.tsx:7-38`. |
| **F15** | P3 | For non-managers, the full privileged detail load and URL signing run **inside the same `Promise.all`** as the authorization checks, and the result is discarded on 403. The code comment describes this as "just parallelized". | **[verified]** `detail/route.ts:71-82`. |
| **F16** | P3 | Signed URLs last one hour; the module-level detail cache is a bare `Map` with no TTL, no timestamps, and no invalidation. `reload()` swallows every failure (`if (!res.ok) return;` plus an empty `catch`). Expired image and download links can persist indefinitely. | **[verified]** `storage.ts:77` `expiresIn = 3600`; `detail-cache.ts`; `TaskDetailDrawer.tsx` `reload`. |
| **F17** | P3 | Per-file validation is genuinely good — magic-byte checks for eight extensions, HTML detection for `txt`/`csv`. What is missing is *operation*-level limits: comment text length, files per comment, and aggregate bytes are all unbounded. HEIC has no structural check. Authenticated upload parsing precedes full view authorization. | **[consistent]** `attachments.ts`; `comments/route.ts:105-111`. |
| **F18** | P3 | `task_comments.parent_id` and `task_attachments.comment_id` are foreign keys to `task_comments(id)` with `task_id` as a *separate* column — so nothing at the database level prevents a reply or an attachment from pointing at another task's comment. One-level reply depth is likewise application-only. | **[consistent]** `schema.sql:1628-1665`. |
| **F19** | **P2** | Comment and edit-history APIs expose identity as email only. The shared UI resolves names through `members.find(...)?.name ?? formatEmailAsName(email)`, where `members` is the *active mention roster*. An author who left, changed role, or was never on the roster falls through to `formatEmailAsName`, which looks nothing up — it splits the email local part and title-cases it. A guess rendered as a fact. | **[verified]** `CommentThread.tsx:318-321`; `detail.ts` `COMMENT_COLUMNS`; both edit-history routes return `edited_by` only. |
| **F20** | **P2** | The composer has mention autocomplete; `EditCommentForm` is a bare `<textarea>`. It re-encodes mentions by regex-replacing the *label text*, so a newly typed `@Name` during edit is saved as plain text and notifies nobody — while looking exactly like a tag. Editing characters *around* an existing label breaks the pattern and silently severs a live mention. | **[verified]** `CommentThread.tsx:874-949`, `encodeDraftMentions:229-247`. |
| **F21** | P3 | The picker filter is `toLowerCase().includes()` with no accent or `đ` handling — and the identical predicate is duplicated in two places. Fixed `w-72` / 288 px width overflows a 320 px viewport. It has `role="listbox"` and `role="option"` but **no `role="combobox"`, no `aria-controls`, no `aria-activedescendant`**, so a screen reader never hears the active option. Zero results makes the menu vanish silently. Rendered tags print the label frozen in the stored token, so a renamed account shows its old name forever. | **[verified]** `CommentThread.tsx:1009-1015` and `1063-1068` (duplicated); `MENTION_MENU_WIDTH = 288`; `renderBody:616-635`. |
| **F22** | P3 | `edit()` returns a bare `false`; `EditCommentForm` does `if (ok) onCancel()` and otherwise shows nothing. `remove()` does `if (res.ok)` and is silent on failure. History load failure renders as "No previous versions". Delete fires straight from the menu with no confirmation. | **[verified]** `CommentThread.tsx:375-447, 673-683, 726-765`. |
| **F23** | P3 | `useEffect(... el.scrollTop = el.scrollHeight, [rowSignature])` — **any** change to the row-id signature snaps the thread to the bottom, yanking a reader away from what they were reading. The Comments tab count is `detail.comments.length`, which includes deleted placeholder rows, while `task_list_metadata` counts `deleted_at is null` — so list and drawer disagree. Relative timestamps only update when something else re-renders. | **[verified]** `CommentThread.tsx:479-486`; `TaskDetailDrawer.tsx:487`. |
| **F24** | P3 | Comment bodies lack `overflow-wrap`, so a long URL or token overflows. Reply indentation is fixed regardless of viewport. The file input has no `accept`. The image preview closes only by click — no Escape, no focus trap or restoration, no load-error state, no open/download action. Non-image attachments show only a truncated filename. | **[consistent]** `CommentThread.tsx:507-558, 575-609, 689-830, 1180-1315`. |

**Gate:** P1 = 2 (F1, F2). P2 = 13 (F3–F13, F19, F20). P3 = 9 (F14–F18, F21–F24). Total 24.

**Subsystem status: NOT READY** until F1 and F2 are fixed. Low current attachment volume reduces
likelihood but not impact. Duplicate comments have already occurred, so idempotency is not optional
cleanup.

---

## 3. Target contracts

### 3.1 Required vs best-effort

**Required** — commits or rolls back together:

- canonical comment create / edit / delete;
- the corresponding required activity row;
- mentioned participant visibility;
- parent task monotonic version and the last-human-activity pair;
- attachment metadata create / delete plus its required activity;
- comment edit-history snapshot plus the canonical body edit;
- initial task, assignees / stage, and the required `created` audit;
- first overdue task flag, overdue event, and `went_overdue` audit.

**Best-effort** — after commit, reported as `warnings` beside a 2xx:

- notification delivery rows and broadcasts, provided the insert is idempotent;
- room / global realtime pings;
- canonical detail / list reconciliation fetches;
- physical storage cleanup after metadata deletion.

**A best-effort failure must never convert a durable mutation into a retryable 5xx.**

### 3.2 Idempotency

- One composer submission owns one stable UUID until it commits or is explicitly discarded.
- One selected file owns one stable upload UUID across retries.
- Replaying a UUID returns the existing canonical row and writes no second activity row.
- The same text, or the same filename, under a **new** UUID is a legitimate new operation.
  **Never deduplicate on body text.**
- Comment notifications are unique per `(recipient_email, comment_id)`; "mentioned" beats
  "commented" before insertion.

### 3.3 Activity semantics

| Event | Required metadata | Moves last human activity |
|---|---|---|
| `created` | optional initial assignee emails | yes |
| `comment_added` | `comment_id`, `parent_id` | yes |
| `comment_edited` | `comment_id` | yes |
| `comment_deleted` | `comment_id`, `attachment_count` | yes |
| `attachment_added` | `attachment_id`, `comment_id` | no when part of the just-created comment; yes for a standalone upload |
| `attachment_deleted` | `attachment_id`, `comment_id` | yes |
| `assigned` | `to` | yes |
| `unassigned` | `removed`, `next_primary` | yes |
| system overdue / reminder | due / reminder metadata | **no** |

**Never store comment bodies, file contents, signed URLs, credentials, or file names in
`task_activity.meta`.** File names can carry customer information; use identifiers and counts.

### 3.4 Deletion and retention

- Comments stay soft-deleted so replies and audit references survive; bodies are cleared as today.
- Linked attachment metadata is soft-deleted **in the same command**, and excluded from detail,
  search, and counts.
- Physical objects are removed after commit; a cleanup failure produces an operational warning and
  an orphan that can be reaped later.
- Activity records only the identifiers and counts needed to prove the deletion.

> **Blocking decision:** if compliance requires *retaining* deleted attachment objects, stop before
> Task 11 and document the retention and access policy. What must not survive is the current
> accidental state, where files are hidden in one surface but searchable and countable in another.

### 3.5 Identity and shared UI

The same contract applies in Health CS, ACA Enrollment, and Medicare Enrollment. **Do not fork a
second Enrollment comment UI.**

- APIs keep normalized email as the identity key **and** return an authoritative `display_name` for
  every author and editor in the response.
- Read, deleted-placeholder, edit, and edit-history surfaces render the display name — never a raw
  email, and never `formatEmailAsName()` as a historical identity source.
- Names resolve from **all** matching `portal_account` rows, including inactive accounts. Missing or
  nameless identities render one neutral label, `Unknown user`.
- The latest canonical account name is used. An account rename therefore updates the name shown on
  older comments; that is intended. Immutable name snapshots are a separate product decision.
- A visible tag is always backed by a selected account. Arbitrary `@text` stays plain and notifies
  nobody.
- Search is case-, whitespace-, accent-, and `Đ`-insensitive via the existing shared normalization.
  Email may match internally; it is never the visible label.

---

## 4. Global Constraints

Every task's requirements implicitly include this section.

- **Next.js 16.2.4 is not the Next.js in your training data.** Before editing any file under
  `src/app/`, read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`.
  Route params are async: existing handlers use `{ params }: Ctx` with `const { id } = await params`
  — preserve that shape.
- **Vitest collects `src/**/*.test.ts` only, in `environment: "node"`.** `.tsx` is not collected and
  there is no DOM harness. Any client behaviour that must be tested has to live in a pure `.ts`
  helper. Never write a task whose verification silently never runs.
- **Test imports are explicit:** `import { describe, expect, it } from "vitest";` (`globals: false`).
  Import app code through the `@/` alias.
- **Every logic change gets a `changelog.md` entry** (repo root: `agent-portal/changelog.md`, ~65 KB,
  actively maintained). Write it in the same commit as the change, not batched at the end.
- **Commit per task.** Stage only files owned by the current task; other agents have unrelated dirty
  files in this worktree. Do not `git push` to any remote unless explicitly asked.
- **Schema first.** Additive nullable columns, indexes, and RPCs land and are verified *before* the
  code that calls them. A missing RPC must surface as a visible error, never as a silent fallback to
  the unsafe multi-step path. Roll back application code before removing any function or column.
  **Never roll back by deleting comments, activity, metadata, or storage objects.**
- **`CommentThread.tsx` is shared by Tasks and Enrollment (ACA + Medicare).** Every client change is
  regression-tested in all three. Enrollment's comment API is a *separate* 7.6 KB implementation
  (`src/app/api/enrollment/[id]/comments/route.ts`) — never assume a Task-side response field exists
  there. It notably does **not** have F2 or F3 (it captures its timestamp after the insert and does
  check the activity error); idempotency is its only gap.

---

## 5. File structure

**New files**

| Path | Responsibility |
|---|---|
| `scripts/audit-task-collaboration.ts` | Read-only reconciliation queries; destructive actions behind an explicit flag |
| `src/lib/tasks/mutation-result.ts` | `MutationResult<T>` / `Warning` shared by every hardened route |
| `src/lib/tasks/activity-events.ts` (+ test) | Typed activity vocabulary and metadata contract |
| `src/lib/tasks/comment-submission.ts` (+ test) | Pure reducer: comment state, per-file state, idempotency IDs |
| `src/lib/people/display-names.ts` (+ test) | Server-only batched `portal_account` name resolver |
| `src/lib/tasks/mention-draft.ts` (+ test) | Pure mention decode/encode/active-token/filter model |
| `src/lib/tasks/thread-view.ts` (+ test) | Pure near-bottom / unread-count / active-count helpers |
| `src/lib/tasks/attachment-limits.ts` (+ test) | Pure operation-limit checks shared by client and server |

**Heavily modified**

`CommentThread.tsx` (~42 KB) and `EnrollmentClient.tsx` (~4.5 k lines) are touched by several tasks.
Each task states exactly which region it owns, so no two tasks edit the same block.

---

## 6. Deployment and rollback order

1. Apply additive nullable columns, indexes, allowed activity types, and new RPC commands.
2. Verify each command directly in the target environment against synthetic records.
3. Deploy API code that calls them.
4. Deploy shared client behaviour after **both** Task and Enrollment compatibility checks pass.
5. Run dry-run audits and reviewed backfills.
6. Validate constraints only after the post-backfill audit is clean.

Idempotency request IDs and warning fields must remain safe while old and new clients overlap during
a rolling browser deployment — every new column is nullable and every partial index is scoped
`where ... is not null` precisely for that window.

---

## 7. Implementation tasks

# Phase A — Foundations

These three tasks change no user-visible behaviour. They exist because Phases B–D each depend on
them, and because the audit's backfills need a dry-run tool that currently does not exist.

## Task 1: Read-only reconciliation script

The audit reported eleven activity gaps, eight overdue-event gaps, and two duplicate-comment groups.
Those numbers are a point-in-time observation from a session I cannot re-run. Every later backfill
needs to re-derive them, and needs to do so without a human running ad-hoc SQL.

**Files:**
- Create: `scripts/audit-task-collaboration.ts`
- Test: none (it is a read-only reporting script; correctness is verified by running it)

**Interfaces:**
- Produces: `npx tsx scripts/audit-task-collaboration.ts [--json]`, printing one section per
  invariant. Tasks 12, 14, and 15 consume its output as their dry-run comparison.

- [ ] **Step 1: Write the script**

```ts
// scripts/audit-task-collaboration.ts
// Read-only. Prints every cross-table invariant this subsystem depends on.
// Destructive repair is NOT implemented here on purpose: repairs need an
// approved target list, so they are separate one-off scripts reviewed per case.
import { getSupabaseAdmin } from "@/lib/supabase";

type Section = { name: string; rows: unknown[] };

async function run(): Promise<Section[]> {
  const db = getSupabaseAdmin();
  const sections: Section[] = [];

  // 1. Comments whose task has no matching comment_added activity.
  const { data: commentGaps } = await db.rpc("audit_comment_activity_gaps");
  sections.push({ name: "comment_activity_gaps", rows: commentGaps ?? [] });

  // 2. Attachment metadata whose storage object cannot be signed.
  const { data: attachments } = await db
    .from("task_attachments")
    .select("id,task_id,storage_path");
  const broken: unknown[] = [];
  for (const row of (attachments ?? []) as { id: string; storage_path: string }[]) {
    const { error } = await db.storage
      .from("task-files")
      .createSignedUrl(row.storage_path, 60);
    if (error) broken.push({ ...row, reason: error.message });
  }
  sections.push({ name: "unsignable_attachments", rows: broken });

  // 3. Tasks where last_activity_at and the newest activity actor disagree (F10).
  const { data: actorMismatch } = await db.rpc("audit_last_activity_mismatch");
  sections.push({ name: "last_activity_actor_mismatch", rows: actorMismatch ?? [] });

  // 4. Overdue-marked tasks missing went_overdue activity or overdue history (F13).
  const { data: overdueGaps } = await db.rpc("audit_overdue_gaps");
  sections.push({ name: "overdue_gaps", rows: overdueGaps ?? [] });

  // 5. Candidate duplicate comments (F4). Reported only — never auto-deleted,
  //    because identical text is a legitimate user action.
  const { data: dupes } = await db.rpc("audit_duplicate_comments");
  sections.push({ name: "duplicate_comment_candidates", rows: dupes ?? [] });

  return sections;
}

run()
  .then((sections) => {
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(sections, null, 2));
      return;
    }
    for (const section of sections) {
      console.log(`\n=== ${section.name} (${section.rows.length}) ===`);
      for (const row of section.rows) console.log(JSON.stringify(row));
    }
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
```

- [ ] **Step 2: Add the five read-only audit functions to `supabase/schema.sql`**

```sql
-- Read-only audit helpers. security definer so the service client can run them
-- without widening RLS for anyone else. Each returns rows describing a broken
-- invariant; an empty result means the invariant currently holds.

create or replace function audit_comment_activity_gaps()
returns table (task_id uuid, comment_count bigint, activity_count bigint)
language sql stable security definer set search_path = public as $$
  select
    c.task_id,
    count(*) as comment_count,
    (select count(*) from task_activity a
      where a.task_id = c.task_id and a.type = 'comment_added') as activity_count
  from task_comments c
  group by c.task_id
  having count(*) <> (
    select count(*) from task_activity a
    where a.task_id = c.task_id and a.type = 'comment_added'
  );
$$;

create or replace function audit_last_activity_mismatch()
returns table (task_id uuid, last_activity_at timestamptz, newest_actor text,
               newest_activity_at timestamptz, newest_type text)
language sql stable security definer set search_path = public as $$
  select t.id, t.last_activity_at, a.actor_email, a.created_at, a.type
  from tasks t
  join lateral (
    select actor_email, created_at, type from task_activity
    where task_id = t.id order by created_at desc limit 1
  ) a on true
  where a.actor_email = 'system'
    and t.last_activity_at is not null
    and a.created_at > t.last_activity_at;
$$;

create or replace function audit_overdue_gaps()
returns table (task_id uuid, has_activity boolean, has_event boolean)
language sql stable security definer set search_path = public as $$
  select
    t.id,
    exists (select 1 from task_activity a
             where a.task_id = t.id and a.type = 'went_overdue'),
    exists (select 1 from task_overdue_events e where e.task_id = t.id)
  from tasks t
  where t.overdue_flagged_at is not null
    and (
      not exists (select 1 from task_activity a
                   where a.task_id = t.id and a.type = 'went_overdue')
      or not exists (select 1 from task_overdue_events e where e.task_id = t.id)
    );
$$;

create or replace function audit_duplicate_comments()
returns table (task_id uuid, author_email text, body text, copies bigint,
               spread_seconds double precision, ids uuid[])
language sql stable security definer set search_path = public as $$
  select task_id, author_email, body, count(*),
         extract(epoch from (max(created_at) - min(created_at))),
         array_agg(id order by created_at)
  from task_comments
  where deleted_at is null and body <> ''
  group by task_id, author_email, parent_id, body
  having count(*) > 1;
$$;
```

- [ ] **Step 3: Apply the schema additions, then run the script**

Run: `npx tsx scripts/audit-task-collaboration.ts`
Expected: five sections print without error. Record each count in the Execution Log — these are the
**baseline** numbers every later backfill compares against. Do not act on any row yet.

- [ ] **Step 4: Commit**

```bash
git add scripts/audit-task-collaboration.ts supabase/schema.sql changelog.md
git commit -m "chore(tasks): add read-only collaboration audit script"
```

---

## Task 2: Enforce `tasks.updated_at` monotonicity at the column

F2 is described in the audit as a comment-route bug. It is not — it is a *column* invariant that
three writers can each violate. `touchLastActivity` writes a caller-supplied `nowIso`
(`src/lib/tasks/last-activity.ts`), `patch_task_atomic` writes a route-supplied `p_now`, and the
cron writes its own. Fixing only the comment route leaves the PATCH path able to regress the token.

**Files:**
- Modify: `supabase/schema.sql`
- Test: `src/lib/tasks/last-activity.test.ts` (create)

**Interfaces:**
- Produces: trigger `tasks_updated_at_monotonic` on `tasks`. Every later task may write `updated_at`
  naively; the column guarantees it never moves backwards.

- [ ] **Step 1: Write the failing test**

`src/lib/tasks/last-activity.test.ts` — the trigger itself is SQL, so the node-side test pins the
contract `touchLastActivity` must satisfy once the trigger exists: it must report the timestamp the
database actually committed, not the one it asked for.

```ts
import { describe, expect, it } from "vitest";
import { touchLastActivity } from "@/lib/tasks/last-activity";

function fakeDb(committed: string) {
  return {
    from() {
      return {
        update() {
          return {
            eq() {
              return {
                select() {
                  return {
                    single: async () => ({
                      data: { updated_at: committed },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("touchLastActivity", () => {
  it("returns the timestamp the database committed, not the one requested", async () => {
    const requested = "2026-08-09T10:00:00.000Z";
    const committed = "2026-08-09T10:00:05.000Z"; // trigger clamped it forward
    const db = fakeDb(committed) as unknown as Parameters<typeof touchLastActivity>[0];

    const result = await touchLastActivity(db, "task-1", requested);

    expect(result).toBe(committed);
    expect(result).not.toBe(requested);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/lib/tasks/last-activity.test.ts`
Expected: FAIL — `touchLastActivity` currently returns `Promise<void>`.

- [ ] **Step 3: Add the trigger to `supabase/schema.sql`**

```sql
-- tasks.updated_at is the optimistic-concurrency token every PATCH echoes back
-- as expected_updated_at. Several writers set it by hand from an application
-- clock captured before their own async work, so a slow writer could commit an
-- older value than a faster one that already finished — defeating the 409 check
-- (audit F2). Clamp it in the column so no writer, present or future, can
-- regress it. last_activity_at is clamped with it because the list renders the
-- pair and they must not disagree.
create or replace function tasks_updated_at_monotonic()
returns trigger language plpgsql as $$
begin
  if new.updated_at is null or new.updated_at <= old.updated_at then
    new.updated_at := old.updated_at + interval '1 microsecond';
  end if;
  if new.last_activity_at is not null
     and old.last_activity_at is not null
     and new.last_activity_at < old.last_activity_at then
    new.last_activity_at := old.last_activity_at;
  end if;
  return new;
end $$;

drop trigger if exists tasks_updated_at_monotonic on tasks;
create trigger tasks_updated_at_monotonic
  before update on tasks
  for each row execute function tasks_updated_at_monotonic();
```

- [ ] **Step 4: Make `touchLastActivity` return the committed value**

`src/lib/tasks/last-activity.ts` — the current body updates and discards the result. Add
`.select("updated_at").single()` so callers can hand the *real* token to the client. Keep the
existing explanatory comment; it is still accurate and still load-bearing.

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export async function touchLastActivity(
  supabase: SupabaseClient,
  taskId: string,
  nowIso: string
): Promise<string> {
  const { data, error } = await supabase
    .from("tasks")
    // updated_at must move too. `last_activity_at` is a rendered List column,
    // so a comment/attachment genuinely changes what the row displays — and
    // `updated_at` is the token every PATCH sends back as
    // `expected_updated_at` for the 409 concurrency check. Leaving it behind
    // means the row's visible content and its version disagree: clients that
    // refresh see new content at an unchanged version, and any staleness
    // check keyed on the version silently drops the update. There is no DB
    // trigger maintaining this column — but `tasks_updated_at_monotonic`
    // clamps it forward, so the value we asked for is not necessarily the
    // value that committed. Return what the database actually stored.
    .update({
      last_activity_at: nowIso,
      stale_reminded_at: null,
      updated_at: nowIso,
    })
    .eq("id", taskId)
    .select("updated_at")
    .single();
  if (error) throw new Error(error.message);
  return (data as { updated_at: string }).updated_at;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/tasks/last-activity.test.ts`
Expected: PASS.

- [ ] **Step 6: Fix the one existing caller to forward the committed value**

`src/app/api/tasks/[id]/comments/route.ts` currently returns its own stale `nowIso`:

```ts
  await touchLastActivity(r.supabase, id, nowIso);
  // ...
  return NextResponse.json({ comment, parent_updated_at: nowIso });
```

becomes:

```ts
  const parentUpdatedAt = await touchLastActivity(r.supabase, id, nowIso);
  // ...
  return NextResponse.json({ comment, parent_updated_at: parentUpdatedAt });
```

This is a partial F2 fix — the full atomic command lands in Task 6. It is included here because
leaving the route returning a value the trigger may have rewritten is strictly worse than before.

- [ ] **Step 7: Verify the whole suite still passes, then commit**

Run: `npx vitest run && npm run typecheck`
Expected: all pass.

```bash
git add supabase/schema.sql src/lib/tasks/last-activity.ts src/lib/tasks/last-activity.test.ts \
  "src/app/api/tasks/[id]/comments/route.ts" changelog.md
git commit -m "fix(tasks): clamp task version monotonically in the database"
```

---

## Task 3: Typed activity events and the mutation-result contract

Every route in Phases B–D returns the same shape. Define it once, with tests, before anything
consumes it. This also closes F14's type half without touching the renderer yet.

**Files:**
- Create: `src/lib/tasks/mutation-result.ts`
- Create: `src/lib/tasks/activity-events.ts`
- Create: `src/lib/tasks/activity-events.test.ts`

**Interfaces:**
- Produces: `type MutationResult<T> = { data: T; warnings: Warning[] }`,
  `type Warning = { code: string; message: string }`,
  `type TaskActivityEvent` (discriminated union), `isKnownActivityType(t: string): boolean`.
  Tasks 4–17 all import from here.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/activity-events.test.ts
import { describe, expect, it } from "vitest";
import {
  ALLOWED_TASK_ACTIVITY_TYPES,
  isKnownActivityType,
} from "@/lib/tasks/activity-events";

describe("task activity vocabulary", () => {
  it("matches the task_activity_type_check constraint exactly", () => {
    // Keep this list in sync with supabase/schema.sql. A type present in one
    // place and absent from the other is the bug F14 describes.
    expect([...ALLOWED_TASK_ACTIVITY_TYPES].sort()).toEqual(
      [
        "assigned",
        "attachment_added",
        "attachment_deleted",
        "category_changed",
        "comment_added",
        "comment_deleted",
        "comment_edited",
        "created",
        "done_review_cleared",
        "done_reviewed",
        "edited",
        "overdue_unlocked",
        "priority_changed",
        "reopened",
        "status_changed",
        "task_reopened",
        "unassigned",
        "went_overdue",
      ].sort()
    );
  });

  it("treats historical/unknown types as unknown rather than throwing", () => {
    expect(isKnownActivityType("comment_added")).toBe(true);
    expect(isKnownActivityType("some_legacy_type")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/tasks/activity-events.test.ts`
Expected: FAIL with "Cannot find module '@/lib/tasks/activity-events'".

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/tasks/activity-events.ts
// One vocabulary for task_activity, shared by SQL (the type check constraint),
// the routes that write rows, and ActivityFeed which renders them. Before this
// existed the three drifted: the renderer had branches for types the constraint
// forbids (they were enrollment_activity / notification types), and no branch
// for attachment_added which the constraint allows (audit F14).

export const ALLOWED_TASK_ACTIVITY_TYPES = [
  "created",
  "assigned",
  "unassigned",
  "status_changed",
  "reopened",
  "task_reopened",
  "priority_changed",
  "category_changed",
  "done_reviewed",
  "done_review_cleared",
  "edited",
  "comment_added",
  "comment_edited",
  "comment_deleted",
  "attachment_added",
  "attachment_deleted",
  "went_overdue",
  "overdue_unlocked",
] as const;

export type TaskActivityType = (typeof ALLOWED_TASK_ACTIVITY_TYPES)[number];

const ALLOWED = new Set<string>(ALLOWED_TASK_ACTIVITY_TYPES);

export function isKnownActivityType(type: string): type is TaskActivityType {
  return ALLOWED.has(type);
}

// Metadata contract. Never store comment bodies, file contents, signed URLs, or
// credentials here — file names can carry customer information, so identifiers
// and counts only.
export type TaskActivityEvent =
  | { type: "created"; meta: { assignees?: string[] } | null }
  | { type: "assigned"; meta: { to: string | null } }
  | { type: "unassigned"; meta: { removed: string; next_primary: string | null } }
  | { type: "comment_added"; meta: { comment_id: string; parent_id: string | null } }
  | { type: "comment_edited"; meta: { comment_id: string } }
  | { type: "comment_deleted"; meta: { comment_id: string; attachment_count: number } }
  | { type: "attachment_added"; meta: { attachment_id: string; comment_id: string | null } }
  | { type: "attachment_deleted"; meta: { attachment_id: string; comment_id: string | null } }
  | { type: Exclude<TaskActivityType,
        | "created" | "assigned" | "unassigned"
        | "comment_added" | "comment_edited" | "comment_deleted"
        | "attachment_added" | "attachment_deleted">;
      meta: Record<string, unknown> | null };
```

```ts
// src/lib/tasks/mutation-result.ts
// Required state commits or rolls back together; everything else is best-effort
// and reported as a warning beside a 2xx. A durable mutation must never be
// returned as a retryable 5xx (audit F3, F6, F12).

export type Warning = {
  /** Stable machine code, e.g. "notification_failed". Safe to log and branch on. */
  code: string;
  /** Operator-facing text. Never contains storage paths, SQL, or comment bodies. */
  message: string;
};

export type MutationResult<T> = { data: T; warnings: Warning[] };

export function ok<T>(data: T, warnings: Warning[] = []): MutationResult<T> {
  return { data, warnings };
}

/**
 * Runs post-commit side effects without letting any of them fail the request.
 * Returns one warning per rejected effect.
 */
export async function settleSideEffects(
  effects: { code: string; message: string; run: () => Promise<unknown> }[]
): Promise<Warning[]> {
  const results = await Promise.allSettled(effects.map((effect) => effect.run()));
  const warnings: Warning[] = [];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const effect = effects[index];
      console.warn(`[side-effect] ${effect.code}`, result.reason);
      warnings.push({ code: effect.code, message: effect.message });
    }
  });
  return warnings;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/tasks/activity-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend the SQL constraint to match**

The three new types (`comment_edited`, `comment_deleted`, `attachment_deleted`) must be allowed
before Tasks 10, 11, and 5 can write them. In `supabase/schema.sql`, add them to the
`task_activity_type_check` list. Keep `not valid` — historical rows are not re-validated, which is
deliberate.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tasks/activity-events.ts src/lib/tasks/activity-events.test.ts \
  src/lib/tasks/mutation-result.ts supabase/schema.sql changelog.md
git commit -m "feat(tasks): add typed activity vocabulary and mutation result contract"
```

---

# Phase B — P1 go-live blockers

The audit's §5 gate: F1 and F2 must be fixed before Go Live. Task 2 covered F2's column half; F2's
transactional half lands in Task 6. F1 is two independent halves — signing isolation and delete
ordering — and each is separately shippable.

## Task 4: Isolate per-attachment signing failures (F1, read half)

Today one unsignable attachment takes down a task's entire drawer: `loadCommentAttachments` signs
with `Promise.all`, and `signTaskFile` throws on error, so one rejection rejects the whole detail
load and `/detail` returns 500. Comments and activity become unreachable because of an unrelated
file.

**Files:**
- Modify: `src/lib/tasks/detail.ts:107-115` (the `Promise.all` block) and `signAttachment:180-189`
- Modify: `src/app/(authed)/tasks/_components/CommentThread.tsx` (attachment rendering only)
- Test: `src/lib/tasks/detail.test.ts` (extend)

**Interfaces:**
- Consumes: nothing from Phase A.
- Produces: `SignedAttachment.url` becomes `string | null`, plus
  `SignedAttachment.unavailable?: true`. Task 24 renders the placeholder state; Task 9 returns the
  same shape from the upload route.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/tasks/detail.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { signAttachmentsSafely } from "@/lib/tasks/detail";

describe("signAttachmentsSafely", () => {
  it("returns an unavailable row instead of rejecting the whole batch", async () => {
    const rows = [
      { id: "a", file_name: "ok.pdf", mime_type: null, size_bytes: 1, storage_path: "good" },
      { id: "b", file_name: "gone.pdf", mime_type: null, size_bytes: 1, storage_path: "missing" },
    ];
    const sign = async (path: string) => {
      if (path === "missing") throw new Error("Object not found");
      return `https://signed/${path}`;
    };

    const signed = await signAttachmentsSafely(rows, sign);

    expect(signed[0]).toMatchObject({ id: "a", url: "https://signed/good" });
    expect(signed[1]).toMatchObject({ id: "b", url: null, unavailable: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/tasks/detail.test.ts`
Expected: FAIL — `signAttachmentsSafely` is not exported.

- [ ] **Step 3: Implement it in `src/lib/tasks/detail.ts`**

```ts
/**
 * Signs each attachment independently. A file whose object is missing or whose
 * signature fails yields `url: null, unavailable: true` — it must not reject the
 * batch, because the batch is the whole task detail: one broken file used to
 * make the entire drawer (comments, activity, everything) return 500 (audit F1).
 */
export async function signAttachmentsSafely<
  T extends { id: string; file_name: string; mime_type: string | null;
              size_bytes: number | null; storage_path: string }
>(
  rows: readonly T[],
  sign: (path: string) => Promise<string> = signTaskFile
): Promise<SignedAttachment[]> {
  const settled = await Promise.allSettled(rows.map((row) => sign(row.storage_path)));
  return rows.map((row, index) => {
    const result = settled[index];
    const base = {
      id: row.id,
      file_name: row.file_name,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
    };
    if (result.status === "fulfilled") return { ...base, url: result.value };
    console.warn(`[attachments] could not sign ${row.id}`, result.reason);
    return { ...base, url: null, unavailable: true as const };
  });
}
```

Update the `SignedAttachment` type so `url: string | null` and `unavailable?: true`.

- [ ] **Step 4: Replace both call sites**

In `loadCommentAttachments`, the current block:

```ts
  const signed = await Promise.all(
    ((attachmentRows ?? []) as unknown as CommentAttachmentRow[]).map(
      async (row) => ({
        comment_id: row.comment_id,
        att: await signAttachment(row),
      })
    )
  );
```

becomes:

```ts
  const rows = (attachmentRows ?? []) as unknown as CommentAttachmentRow[];
  const attachments = await signAttachmentsSafely(rows);
  const signed = rows.map((row, index) => ({
    comment_id: row.comment_id,
    att: attachments[index],
  }));
```

Apply the same replacement to the standalone-attachment path (`detail.ts:175-189` region). Delete
the now-unused `signAttachment` helper.

- [ ] **Step 5: Render the unavailable state**

In `CommentThread.tsx`, the attachment chip currently assumes `url` is a string. Guard it: when
`unavailable` is set, render a non-interactive chip reading `File unavailable` with the file name and
a `title` explaining it may have been removed. Do not surface the storage path or the raw error.

- [ ] **Step 6: Run tests and verify**

Run: `npx vitest run src/lib/tasks/detail.test.ts && npm run typecheck`
Expected: PASS. TypeScript will flag every place assuming `url: string` — fix each by handling null.

Browser check: deliberately corrupt one `task_attachments.storage_path` on a test task, open the
drawer. Expected: drawer opens, comments and activity render, only that one chip shows unavailable.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tasks/detail.ts src/lib/tasks/detail.test.ts \
  "src/app/(authed)/tasks/_components/CommentThread.tsx" changelog.md
git commit -m "fix(task-detail): isolate unsignable attachments from detail load"
```

---

## Task 5: Reverse attachment delete ordering (F1, write half)

`src/app/api/tasks/[id]/attachments/[aid]/route.ts` currently calls `removeTaskFile()` *then*
deletes metadata, returning 500 if the metadata delete fails. That is the exact sequence that
creates the row Task 4 now tolerates — so fix the source too.

**Files:**
- Modify: `src/app/api/tasks/[id]/attachments/[aid]/route.ts:77-80`
- Modify: `supabase/schema.sql` (new command)

**Interfaces:**
- Consumes: `MutationResult`, `settleSideEffects` (Task 3); `attachment_deleted` activity type
  (Task 3).
- Produces: RPC `delete_task_attachment_atomic(p_attachment_id, p_actor_email)` returning the
  storage path to clean up.

- [ ] **Step 1: Add the atomic command to `supabase/schema.sql`**

```sql
-- Deletes attachment metadata and writes its audit row in one transaction, then
-- hands the storage path back so the caller can clean up AFTER commit. The old
-- order (storage first, metadata second) left visible metadata pointing at a
-- missing object whenever the second step failed — and one such row used to take
-- down the whole task detail load (audit F1).
create or replace function delete_task_attachment_atomic(
  p_attachment_id uuid,
  p_actor_email text
) returns table (storage_path text, task_id uuid, comment_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_row task_attachments%rowtype;
begin
  select * into v_row from task_attachments where id = p_attachment_id for update;
  if not found then
    raise exception 'ATTACHMENT_NOT_FOUND';
  end if;

  delete from task_attachments where id = p_attachment_id;

  insert into task_activity (task_id, actor_email, type, meta)
  values (
    v_row.task_id, p_actor_email, 'attachment_deleted',
    jsonb_build_object('attachment_id', p_attachment_id, 'comment_id', v_row.comment_id)
  );

  update tasks
     set updated_at = clock_timestamp(),
         last_activity_at = clock_timestamp(),
         stale_reminded_at = null
   where id = v_row.task_id;

  storage_path := v_row.storage_path;
  task_id := v_row.task_id;
  comment_id := v_row.comment_id;
  return next;
end $$;
```

- [ ] **Step 2: Rewrite the route's delete section**

Replace:

```ts
  await removeTaskFile(attachment.storage_path);
  const { error } = await supabase.from("task_attachments").delete().eq("id", aid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
```

with:

```ts
  // Metadata + audit commit first; the object is removed afterwards as
  // best-effort. A failed cleanup leaves an orphan object we can reap later,
  // which is strictly better than visible metadata pointing at nothing.
  const { data: deleted, error } = await supabase
    .rpc("delete_task_attachment_atomic", {
      p_attachment_id: aid,
      p_actor_email: email,
    })
    .single();
  if (error) {
    if (error.message.includes("ATTACHMENT_NOT_FOUND")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const warnings = await settleSideEffects([
    {
      code: "storage_cleanup_failed",
      message: "The file record was removed but the stored file could not be deleted.",
      run: () => removeTaskFile((deleted as { storage_path: string }).storage_path),
    },
    {
      code: "broadcast_failed",
      message: "Other open tabs may show a stale attachment count until they refresh.",
      run: async () => {
        await broadcastTaskRoom(id);
        await broadcastTasksChanged();
      },
    },
  ]);

  return NextResponse.json({ ok: true, warnings });
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run`

Browser/DB checks:
1. Delete an attachment normally → row gone, object gone, `attachment_deleted` activity present,
   drawer and list counter update.
2. Point `storage_path` at a non-existent object, delete → **2xx with
   `storage_cleanup_failed` warning**, metadata gone, drawer still healthy.
3. Confirm the previous failure mode is unreachable: there is no longer any ordering where the
   object is gone and the row survives.

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql "src/app/api/tasks/[id]/attachments/[aid]/route.ts" changelog.md
git commit -m "fix(attachments): delete metadata and audit before storage cleanup"
```

---

## Task 6: Atomic, monotonic, idempotent comment creation (F2, F3, F9)

The single densest fix in the plan. `POST /api/tasks/[id]/comments` currently: captures `nowIso`
before all async work (F2); inserts the comment (committed); inserts `comment_added` **without
checking the error** (F3, silent audit loss); calls `addParticipants`, which discards its upsert
result entirely (F9); inserts notifications, which may throw *after* the comment committed (F3); and
calls `touchLastActivity`, which throws on error — turning a durable comment into a 500 (F3).

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `src/app/api/tasks/[id]/comments/route.ts:98-190`
- Modify: `src/lib/tasks/participants.ts:46-61`

**Interfaces:**
- Consumes: `MutationResult`, `settleSideEffects` (Task 3); the monotonicity trigger (Task 2).
- Produces: RPC `create_task_comment_atomic(...)` returning `(comment jsonb, parent_updated_at
  timestamptz, was_created boolean)`; the route accepts an optional `client_request_id` body field.
  Task 7's client sends it.

- [ ] **Step 1: Add the column, index, and command to `supabase/schema.sql`**

```sql
-- Idempotency key. Nullable so older clients (and the rolling-deploy window)
-- keep working; the partial index only constrains rows that carry one.
alter table task_comments add column if not exists client_request_id uuid;

create unique index if not exists task_comments_client_request_id_key
  on task_comments (task_id, author_email, client_request_id)
  where client_request_id is not null;

create or replace function create_task_comment_atomic(
  p_task_id uuid,
  p_author_email text,
  p_body text,
  p_parent_id uuid,
  p_client_request_id uuid,
  p_mentions text[]
) returns table (comment jsonb, parent_updated_at timestamptz, was_created boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_comment task_comments%rowtype;
  v_task tasks%rowtype;
  v_now timestamptz;
begin
  -- Replay check first: the same submission retried must return the original
  -- row and must not touch timestamps or write a second activity row.
  if p_client_request_id is not null then
    select * into v_comment from task_comments
     where task_id = p_task_id
       and author_email = p_author_email
       and client_request_id = p_client_request_id;
    if found then
      select updated_at into parent_updated_at from tasks where id = p_task_id;
      comment := to_jsonb(v_comment);
      was_created := false;
      return next;
      return;
    end if;
  end if;

  -- Lock the parent task so the version bump below cannot interleave with a
  -- concurrent PATCH (audit F2).
  select * into v_task from tasks where id = p_task_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;

  if p_parent_id is not null then
    perform 1 from task_comments
     where id = p_parent_id and task_id = p_task_id and parent_id is null;
    if not found then raise exception 'INVALID_PARENT'; end if;
  end if;

  insert into task_comments (task_id, parent_id, author_email, body, client_request_id)
  values (p_task_id, p_parent_id, p_author_email, p_body, p_client_request_id)
  returning * into v_comment;

  -- Required audit row. Unlike the old route, a failure here aborts everything.
  insert into task_activity (task_id, actor_email, type, meta)
  values (
    p_task_id, p_author_email, 'comment_added',
    jsonb_build_object('comment_id', v_comment.id, 'parent_id', p_parent_id)
  );

  -- Required participant visibility. A mention promises access; granting it
  -- best-effort meant a user could be notified and then get 403 (audit F9).
  if p_mentions is not null and array_length(p_mentions, 1) > 0 then
    insert into task_participants (task_id, email, source)
    select p_task_id, unnest(p_mentions), 'mention'
    on conflict (task_id, email) do nothing;
  end if;

  v_now := greatest(clock_timestamp(), v_task.updated_at + interval '1 microsecond');
  update tasks
     set updated_at = v_now,
         last_activity_at = v_now,
         last_activity_by_email = p_author_email,
         stale_reminded_at = null
   where id = p_task_id;

  comment := to_jsonb(v_comment);
  parent_updated_at := v_now;
  was_created := true;
  return next;
end $$;
```

> `last_activity_by_email` is added to `tasks` in Task 12. Land Task 12's column addition first, or
> drop that one assignment from this command and add it in Task 12. Do not leave the command
> referencing a column that does not exist.

- [ ] **Step 2: Rewrite the route body**

Everything from the `nowIso` capture through `touchLastActivity` is replaced. Validation and mention
resolution stay in the route (they need `fetchTaskAssignees`); the writes move into the command.

```ts
  const requestId =
    typeof body?.client_request_id === "string" ? body.client_request_id : null;
  if (requestId !== null && !UUID_RE.test(requestId)) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }

  // Mentions are parsed from the body (server is the source of truth), then
  // validated against board members before they are handed to the command.
  const taskMembers = await fetchTaskAssignees();
  const actionableEmails = new Set(taskMembers.map((member) => member.email));
  const validMentions = parseMentions(text).filter((m) => actionableEmails.has(m));

  const { data: created, error } = await r.supabase
    .rpc("create_task_comment_atomic", {
      p_task_id: id,
      p_author_email: r.actor.email,
      p_body: text,
      p_parent_id: typeof body?.parentId === "string" ? body.parentId : null,
      p_client_request_id: requestId,
      p_mentions: validMentions,
    })
    .single();
  if (error) {
    if (error.message.includes("INVALID_PARENT")) {
      return NextResponse.json({ error: "Invalid parent comment." }, { status: 400 });
    }
    if (error.message.includes("TASK_NOT_FOUND")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { comment, parent_updated_at: parentUpdatedAt, was_created: wasCreated } =
    created as { comment: { id: string }; parent_updated_at: string; was_created: boolean };

  // Everything past this line is best-effort: the comment is durable.
  const warnings = wasCreated
    ? await settleSideEffects([
        {
          code: "notification_failed",
          message: "The comment was saved but some people may not have been notified.",
          run: async () => {
            // Unchanged from the current route — it was already correct; it was
            // only in the wrong place, running before the commit boundary where
            // its failure could 500 a durable comment.
            const [assigneeEmails, participantEmails] = await Promise.all([
              fetchTaskAssigneeEmails(id, r.supabase),
              fetchTaskParticipantEmails(id, r.supabase),
            ]);
            const activeOnly = (candidate: string | null | undefined) =>
              candidate && actionableEmails.has(candidate) ? candidate : null;
            const recipients = resolveCommentRecipients(
              {
                assignees: assigneeEmails.filter((e) => actionableEmails.has(e)),
                assignee_email: activeOnly(r.task.assignee_email),
                participants: participantEmails.filter((e) => actionableEmails.has(e)),
                reporter_email: activeOnly(r.task.reporter_email),
                agent_email: activeOnly(r.task.agent_email),
              },
              r.actor.email,
              validMentions
            );
            await insertNotifications(
              recipients.map((rec) => ({
                recipient_email: rec.email,
                task_id: id,
                type: rec.type,
                actor_email: r.actor.email,
                comment_id: comment.id,
              }))
            );
          },
        },
        {
          code: "broadcast_failed",
          message: "Other open tabs may need a refresh to see this comment.",
          run: async () => {
            await broadcastTasksChanged();
            await broadcastTaskRoom(id);
          },
        },
      ])
    : [];

  return NextResponse.json({ comment, parent_updated_at: parentUpdatedAt, warnings });
```

- [ ] **Step 3: Stop `addParticipants` from swallowing mutation errors**

`src/lib/tasks/participants.ts` — the mention path now goes through the command, so this helper is
only used by explicitly-added participants. Make it report failure instead of discarding it:

```ts
export async function addParticipants(
  taskId: string,
  emails: string[],
  source: "mention" | "added" = "mention"
): Promise<void> {
  const unique = [...new Set(emails.filter(Boolean))];
  if (unique.length === 0) return;
  const { error } = await getSupabaseAdmin()
    .from("task_participants")
    .upsert(
      unique.map((email) => ({ task_id: taskId, email, source })),
      { onConflict: "task_id,email", ignoreDuplicates: true }
    );
  // Visibility is part of what a mention promises, so a failure here is real:
  // silently widening nothing used to let us notify someone who then got a 403
  // opening the task (audit F9). Callers decide whether it is fatal.
  if (error) throw new Error(error.message);
}
```

Then audit every caller: mutation paths must propagate; any read-tolerant path must catch
explicitly with a comment saying why.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npx vitest run`

DB/browser checks:
1. Normal comment → one row, one `comment_added` with `comment_id` meta, participants added,
   `parent_updated_at` strictly greater than before.
2. Replay the same `client_request_id` → **same comment id returned, `was_created: false`, no second
   activity row, `updated_at` unchanged.**
3. Comment, then immediately PATCH the task with the returned token → no 409.
4. Force the notification insert to fail → **2xx with `notification_failed` warning**, comment
   present.
5. Force the activity insert to fail (temporarily break the constraint) → **whole thing rolls back**,
   no comment row.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql "src/app/api/tasks/[id]/comments/route.ts" \
  src/lib/tasks/participants.ts changelog.md
git commit -m "fix(tasks): commit comments atomically with required audit and visibility"
```

---

# Phase C — P2 correctness

## Task 7: Client submission guard and idempotency key (F4)

`post()` in `CommentThread.tsx:335-368` has no synchronous in-flight guard and unconditionally
`return true`. The audit found two duplicate comment groups created 0.647 s and 1.175 s apart.

**Files:**
- Create: `src/lib/tasks/comment-submission.ts` + `.test.ts`
- Modify: `src/app/(authed)/tasks/_components/CommentThread.tsx` (composer + `post` only)
- Modify: `src/app/api/enrollment/[id]/comments/route.ts` — **see the scope note below**

> **Enrollment parity is part of this task, not a follow-up.** The composer is shared. If only the
> Task route honours `client_request_id`, ACA and Medicare keep the duplicate bug while the UI
> behaves as though it is fixed — an invisible regression. The Enrollment route is a separate 7.6 KB
> implementation; it needs the same nullable column, the same partial unique index on
> `enrollment_comments`, and the same replay-returns-existing-row branch. It does **not** need F2's
> or F3's fixes: I verified it captures `nowIso` *after* its insert and it *does* check
> `activityError`. Idempotency is the only gap.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/comment-submission.test.ts
import { describe, expect, it } from "vitest";
import { beginSubmission, canSubmit } from "@/lib/tasks/comment-submission";

describe("comment submission guard", () => {
  it("refuses a second submission while one is in flight", () => {
    const idle = { inFlight: false, requestId: null };
    expect(canSubmit(idle)).toBe(true);
    const busy = beginSubmission(idle, () => "uuid-1");
    expect(busy.inFlight).toBe(true);
    expect(canSubmit(busy)).toBe(false);
  });

  it("keeps the same request id across retries so a replay is recognised", () => {
    const first = beginSubmission({ inFlight: false, requestId: null }, () => "uuid-1");
    const retry = beginSubmission({ ...first, inFlight: false }, () => "uuid-2");
    expect(retry.requestId).toBe("uuid-1");
  });

  it("mints a new id once the previous submission is discarded", () => {
    const fresh = beginSubmission({ inFlight: false, requestId: null }, () => "uuid-2");
    expect(fresh.requestId).toBe("uuid-2");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/tasks/comment-submission.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure model**

```ts
// src/lib/tasks/comment-submission.ts
// Pure submission state. Lives outside the component because vitest runs in the
// node environment with no DOM harness, so this is the only layer where the
// duplicate-submission guard can actually be tested.

export type SubmissionState = {
  inFlight: boolean;
  /** Stable across retries of the same user intent; null once discarded. */
  requestId: string | null;
};

export function canSubmit(state: SubmissionState): boolean {
  return !state.inFlight;
}

export function beginSubmission(
  state: SubmissionState,
  newId: () => string
): SubmissionState {
  // Retrying an ambiguous send must reuse the id, otherwise the server sees a
  // different intent and legitimately creates a second comment (audit F4).
  return { inFlight: true, requestId: state.requestId ?? newId() };
}

export function finishSubmission(): SubmissionState {
  return { inFlight: false, requestId: null };
}

export function failSubmission(state: SubmissionState): SubmissionState {
  return { inFlight: false, requestId: state.requestId };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/tasks/comment-submission.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the composer**

In `CommentThread.tsx`, add `const submissionRef = useRef<SubmissionState>({ inFlight: false,
requestId: null })`. A **ref, not state** — React batches state updates, so a double-click can pass a
state-based check twice before the first render lands. `post()` returns `false` when
`!canSubmit(submissionRef.current)`, sends `client_request_id: submissionRef.current.requestId` in
the POST body, and the Send button is disabled while `inFlight`.

- [ ] **Step 6: Mirror the schema change for Enrollment**

Add `client_request_id uuid` + partial unique index to `enrollment_comments`, and the same
replay-returns-existing branch to its POST route.

- [ ] **Step 7: Verify**

Run: `npx vitest run && npm run typecheck`

Browser matrix, on **Tasks, ACA, and Medicare**: double-click Send → 1 comment. Hammer Enter →
1 comment. Deliberately send the same text twice → 2 comments (text is never deduplicated). Replay
the same request id via devtools → the first comment returned, no duplicate.

- [ ] **Step 8: Commit**

```bash
git add src/lib/tasks/comment-submission.ts src/lib/tasks/comment-submission.test.ts \
  "src/app/(authed)/tasks/_components/CommentThread.tsx" \
  "src/app/api/enrollment/[id]/comments/route.ts" supabase/schema.sql changelog.md
git commit -m "fix(comments): guard duplicate submission across tasks and enrollment"
```

---

## Task 8: Separate comment state from per-file state (F5)

`persistComment` wraps the comment POST, every sequential file upload, and `onReload()` in one
`try/catch`. Any file failure — or a *reload* failure, which is not a mutation at all — marks the
whole optimistic comment `failed: true`. Worse, `realId` has already been set by then, so the real
server comment is hidden by `shadowedIds` behind a row labelled failed.

**Files:**
- Modify: `src/lib/tasks/comment-submission.ts` (extend with file state)
- Modify: `src/app/(authed)/tasks/_components/CommentThread.tsx:369-435`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/lib/tasks/comment-submission.test.ts
import { fileFailed, commentCommitted, isCommentFailed } from "@/lib/tasks/comment-submission";

describe("comment vs file status", () => {
  it("keeps a committed comment successful when a file fails", () => {
    let state = commentCommitted({ files: [{ id: "f1", status: "uploading" },
                                            { id: "f2", status: "uploading" }] },
                                  "real-comment-id");
    state = fileFailed(state, "f2", "Network error");

    expect(isCommentFailed(state)).toBe(false);
    expect(state.realId).toBe("real-comment-id");
    expect(state.files.find((f) => f.id === "f1")?.status).toBe("uploading");
    expect(state.files.find((f) => f.id === "f2")).toMatchObject({
      status: "failed",
      error: "Network error",
    });
  });

  it("never marks a committed comment failed for a reload error", () => {
    const state = commentCommitted({ files: [] }, "real-comment-id");
    expect(isCommentFailed({ ...state, reloadFailed: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then implement**

Run: `npx vitest run src/lib/tasks/comment-submission.test.ts` → FAIL.

Add to `comment-submission.ts`: a `FileState = { id, status: "pending"|"uploading"|"success"|
"failed", error?: string }`, a `CommentDraftState` holding `realId`, `files`, and `reloadFailed`, and
the transitions above. `isCommentFailed` returns true **only** when the comment POST itself failed —
never for a file or a reload.

- [ ] **Step 3: Rewrite `persistComment` around it**

Split the single `try/catch` into three: comment POST, then per-file uploads each with their own
`catch` that marks only that file, then `onReload()` with its own `catch` setting `reloadFailed`.
Once the POST resolves, the comment is permanently non-failable. Keep uploads sequential in this
task; bounded concurrency of two is a follow-up once per-file retry exists.

- [ ] **Step 4: Revoke object URLs on every exit path**

`optimisticUrlsRef` is currently released only in `releaseOptimistic`. Add revocation on explicit
discard, task change, and unmount — otherwise a failed send leaks blob URLs for the session.

- [ ] **Step 5: Verify**

Run: `npx vitest run && npm run typecheck`

Browser: two files where the second fails → comment renders normally, file 1 shows success, file 2
shows failed with Retry. Kill the network before `onReload` → comment stays, small reload warning
appears. Close the drawer mid-upload and reopen. Repeat on ACA and Medicare.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tasks/comment-submission.ts src/lib/tasks/comment-submission.test.ts \
  "src/app/(authed)/tasks/_components/CommentThread.tsx" changelog.md
git commit -m "fix(comments): separate durable comment state from per-file upload state"
```

---

**Ordering constraints inside Phase C:** Task 12 must land before Task 6's command references
`last_activity_by_email`. Task 10 must land before Task 17, because unified mention editing needs the
atomic edit contract to diff mentions against. Tasks 9, 13, 14, 15 are independent and may run in
any order or in parallel worktrees.

## Task 9: Idempotent attachment upload with compensation (F6)

`POST /api/tasks/[id]/attachments` has four separate defects in one 100-line handler. It parses the
whole multipart body into memory **before** any permission check (`req.formData()` runs immediately
after `loadActorAndTask`). It uploads the object *then* inserts metadata, with no cleanup if the
insert fails — an orphan object. It signs the URL **after** the metadata commit, inside the response
literal, so a signing failure throws and returns 500 for a durable attachment. And it has no
idempotency key, so a client retrying an ambiguous response uploads a second copy.

Two more details the audit does not spell out, both verified: the comment-linked branch writes **no
`attachment_added` activity at all** (only `broadcastTaskRoom`), and the standalone branch writes
`meta: { file_name: file.name }` — which violates the "never store file names in activity metadata"
rule in audit §6.3, because file names carry customer information.

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `src/app/api/tasks/[id]/attachments/route.ts:118-222`
- Test: `src/lib/tasks/attachments.test.ts` (extend)

**Interfaces:**
- Consumes: `MutationResult`, `settleSideEffects` (Task 3); `attachment_added` typed meta (Task 3);
  `SignedAttachment` with `url: string | null` (Task 4).
- Produces: RPC `create_task_attachment_atomic(...)`; the route accepts `client_request_id` as a
  form field. Task 8's per-file state supplies it.

- [ ] **Step 1: Add the column, index, and command**

```sql
alter table task_attachments add column if not exists client_request_id uuid;

create unique index if not exists task_attachments_client_request_id_key
  on task_attachments (task_id, uploaded_by, client_request_id)
  where client_request_id is not null;

-- Metadata + required audit in one transaction. The storage object is uploaded
-- BEFORE this runs (storage cannot join a Postgres transaction), so the caller
-- owns compensation: if this command fails, the caller deletes the object it
-- just uploaded — and only that object, never a previous attempt's (audit F6).
create or replace function create_task_attachment_atomic(
  p_task_id uuid,
  p_comment_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_uploaded_by text,
  p_client_request_id uuid
) returns table (attachment jsonb, was_created boolean, replayed_path text)
language plpgsql security definer set search_path = public as $$
declare
  v_row task_attachments%rowtype;
begin
  if p_client_request_id is not null then
    select * into v_row from task_attachments
     where task_id = p_task_id
       and uploaded_by = p_uploaded_by
       and client_request_id = p_client_request_id;
    if found then
      attachment := to_jsonb(v_row);
      was_created := false;
      replayed_path := v_row.storage_path;
      return next;
      return;
    end if;
  end if;

  -- Same-task invariant: a comment attachment must belong to a comment on THIS
  -- task. Foreign keys alone permit a cross-task link (audit F18).
  if p_comment_id is not null then
    perform 1 from task_comments where id = p_comment_id and task_id = p_task_id;
    if not found then raise exception 'INVALID_COMMENT'; end if;
  end if;

  insert into task_attachments (
    task_id, comment_id, storage_path, file_name, mime_type, size_bytes,
    uploaded_by, client_request_id
  ) values (
    p_task_id, p_comment_id, p_storage_path, p_file_name, p_mime_type,
    p_size_bytes, p_uploaded_by, p_client_request_id
  ) returning * into v_row;

  insert into task_activity (task_id, actor_email, type, meta)
  values (
    p_task_id, p_uploaded_by, 'attachment_added',
    -- Identifiers only. File names can contain customer information and must
    -- not be denormalised into the audit trail (audit §6.3).
    jsonb_build_object('attachment_id', v_row.id, 'comment_id', p_comment_id)
  );

  -- A file attached to a comment that was just created is part of that one user
  -- action: the comment already bumped the version. A standalone upload is its
  -- own action and must bump it.
  if p_comment_id is null then
    update tasks
       set updated_at = clock_timestamp(),
           last_activity_at = clock_timestamp(),
           last_activity_by_email = p_uploaded_by,
           stale_reminded_at = null
     where id = p_task_id;
  end if;

  attachment := to_jsonb(v_row);
  was_created := true;
  replayed_path := null;
  return next;
end $$;
```

- [ ] **Step 2: Move authorization above the multipart parse**

The current order is `loadActorAndTask` → `req.formData()` → permission checks. Reading an
authenticated user's whole 15 MiB body before deciding whether they may write is both the F6 and the
F17 concern. Reorder so the **base view check** happens first:

```ts
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

  // Base view permission BEFORE the body is read into memory. The finer
  // comment-ownership / mutate checks still need form fields, so they stay
  // below — but an unauthorised caller can no longer make us buffer 15 MiB.
  if (!(await canViewResolved(r.actor, r.task, id)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const form = await req.formData().catch(() => null);
```

- [ ] **Step 3: Read and validate the idempotency key**

```ts
  const rawRequestId = form?.get("client_request_id");
  const requestId =
    typeof rawRequestId === "string" && rawRequestId ? rawRequestId : null;
  if (requestId !== null && !UUID_RE.test(requestId)) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }
```

- [ ] **Step 4: Restructure upload → sign → commit → compensate**

Replace everything from `const path = buildStoragePath(...)` to the final `return NextResponse.json`:

```ts
  const path = buildStoragePath(id, file.name);

  // 1. Upload. Nothing is durable yet from the user's point of view.
  try {
    await uploadTaskFile(path, fileData, validation.contentType);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Could not upload attachment.") },
      { status: 500 }
    );
  }

  // 2. Sign BEFORE the metadata commit. Signing used to happen inside the
  //    response literal, after the commit — so a signing failure threw and
  //    returned 500 for an attachment that was already durable (audit F6).
  let url: string | null;
  try {
    url = await signTaskFile(path);
  } catch {
    await removeTaskFile(path).catch(() => {});
    return NextResponse.json(
      { error: "Could not prepare the attachment link. Please try again." },
      { status: 500 }
    );
  }

  // 3. Commit metadata + required audit atomically.
  const { data: created, error } = await r.supabase
    .rpc("create_task_attachment_atomic", {
      p_task_id: id,
      p_comment_id: commentId,
      p_storage_path: path,
      p_file_name: file.name,
      p_mime_type: validation.contentType,
      p_size_bytes: file.size,
      p_uploaded_by: r.actor.email,
      p_client_request_id: requestId,
    })
    .single();

  if (error) {
    // Compensation: remove ONLY the object this attempt created. A retry of an
    // earlier request must never delete the first request's valid object.
    await removeTaskFile(path).catch(() => {});
    if (error.message.includes("INVALID_COMMENT")) {
      return NextResponse.json({ error: "Invalid comment." }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { attachment, was_created: wasCreated, replayed_path: replayedPath } =
    created as { attachment: Record<string, unknown>; was_created: boolean;
                 replayed_path: string | null };

  // On replay the row already existed, so the object we just uploaded is a
  // duplicate: drop it and return the original, freshly signed.
  if (!wasCreated) {
    await removeTaskFile(path).catch(() => {});
    url = await signTaskFile(replayedPath as string).catch(() => null);
  }

  // 4. Everything past here is best-effort; the attachment is durable.
  const warnings = wasCreated
    ? await settleSideEffects([
        {
          code: "notification_failed",
          message: "The file was saved but some people may not have been notified.",
          run: async () => {
            if (commentId) return; // comment notifications belong to the comment
            const [assignees, agentRecipients] = await Promise.all([
              fetchTaskAssigneeEmails(id, r.supabase),
              fetchAgentOwnerAndAssistantEmails(r.task.agent_email),
            ]);
            const recipients = uniqueNotificationRecipients(
              [...assignees, r.task.reporter_email, ...agentRecipients],
              [r.actor.email]
            );
            await insertNotifications(
              recipients.map((recipient) => ({
                recipient_email: recipient,
                task_id: id,
                type: "attachment_added" as const,
                actor_email: r.actor.email,
                detail: file.name,
              }))
            );
          },
        },
        {
          code: "broadcast_failed",
          message: "Other open tabs may need a refresh to see this file.",
          run: async () => {
            await broadcastTaskRoom(id);
            // The list shows an attachment count, so the global channel must
            // fire too — the old code only broadcast the room.
            await broadcastTasksChanged();
          },
        },
      ])
    : [];

  return NextResponse.json({ attachment: { ...attachment, url }, warnings });
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npx vitest run`

Fault matrix — inject each failure and assert the pair (HTTP status, storage state):

| Injected failure | Expected status | Expected storage |
|---|---|---|
| Upload fails | 500 | no object |
| Signing fails | 500 | object removed |
| Metadata insert fails | 500 | object removed |
| Same `client_request_id` replayed | 200, original row | duplicate object removed, original kept |
| Notification insert fails | **200 + warning** | object kept |
| Broadcast fails | **200 + warning** | object kept |
| Two files, same name, different request ids | 200 each | two distinct objects |
| `comment_id` from another task | 400 | object removed |

Then run `npx tsx scripts/audit-task-collaboration.ts` and confirm `unsignable_attachments` is
still 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql "src/app/api/tasks/[id]/attachments/route.ts" \
  src/lib/tasks/attachments.test.ts changelog.md
git commit -m "fix(attachments): make upload idempotent with storage compensation"
```

---

## Task 10: Atomic compare-and-swap comment edit (F7)

`PATCH /api/tasks/[id]/comments/[cid]` snapshots the previous body into `task_comment_edits`
**without checking the insert error**, then updates the comment in a second unguarded statement.
Two tabs editing the same comment is last-write-wins, and the history can be missing, duplicated, or
record a version that never became canonical. The edit also does not touch task last activity, emits
no activity row, and never re-parses mentions.

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `src/app/api/tasks/[id]/comments/[cid]/route.ts:91-120`
- Modify: `src/app/(authed)/tasks/_components/CommentThread.tsx` (`edit()` + `EditCommentForm` only)

**Interfaces:**
- Consumes: `comment_edited` activity type (Task 3); monotonic trigger (Task 2).
- Produces: RPC `edit_task_comment_atomic(...)` → `(comment jsonb, parent_updated_at timestamptz)`,
  raising `COMMENT_CONFLICT` on a stale expected version. Task 17 diffs mentions against it.

- [ ] **Step 1: Add the command**

```sql
create or replace function edit_task_comment_atomic(
  p_comment_id uuid,
  p_task_id uuid,
  p_actor_email text,
  p_body text,
  p_expected_updated_at timestamptz,
  p_new_mentions text[]
) returns table (comment jsonb, parent_updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_row task_comments%rowtype;
  v_now timestamptz;
begin
  select * into v_row from task_comments
   where id = p_comment_id and task_id = p_task_id
   for update;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  if v_row.author_email <> p_actor_email then raise exception 'FORBIDDEN'; end if;
  if v_row.deleted_at is not null then raise exception 'COMMENT_DELETED'; end if;

  -- Compare-and-swap. Without this, two tabs silently overwrite each other and
  -- one user's text is lost with no signal (audit F7).
  if p_expected_updated_at is not null
     and v_row.updated_at <> p_expected_updated_at then
    raise exception 'COMMENT_CONFLICT';
  end if;

  if v_row.body = p_body then
    comment := to_jsonb(v_row);
    select updated_at into parent_updated_at from tasks where id = p_task_id;
    return next;
    return;
  end if;

  insert into task_comment_edits (comment_id, previous_body, edited_by)
  values (p_comment_id, v_row.body, p_actor_email);

  update task_comments
     set body = p_body, updated_at = clock_timestamp()
   where id = p_comment_id
  returning * into v_row;

  insert into task_activity (task_id, actor_email, type, meta)
  values (p_task_id, p_actor_email, 'comment_edited',
          jsonb_build_object('comment_id', p_comment_id));

  -- Newly mentioned people gain visibility with the edit itself. Removing a tag
  -- never revokes access: someone already notified must keep being able to open
  -- what they were told about.
  if p_new_mentions is not null and array_length(p_new_mentions, 1) > 0 then
    insert into task_participants (task_id, email, source)
    select p_task_id, unnest(p_new_mentions), 'mention'
    on conflict (task_id, email) do nothing;
  end if;

  v_now := clock_timestamp();
  update tasks
     set updated_at = v_now, last_activity_at = v_now,
         last_activity_by_email = p_actor_email, stale_reminded_at = null
   where id = p_task_id;

  comment := to_jsonb(v_row);
  parent_updated_at := v_now;
  return next;
end $$;
```

- [ ] **Step 2: Rewrite the PATCH handler**

```ts
  const expectedUpdatedAt =
    typeof body?.expected_updated_at === "string" ? body.expected_updated_at : null;

  const taskMembers = await fetchTaskAssignees();
  const actionable = new Set(taskMembers.map((member) => member.email));
  const mentionsNow = parseMentions(text).filter((m) => actionable.has(m));
  const mentionsBefore = parseMentions(ctx.currentBody ?? "");
  const newMentions = mentionsNow.filter((m) => !mentionsBefore.includes(m));

  const { data: edited, error } = await ctx.supabase
    .rpc("edit_task_comment_atomic", {
      p_comment_id: cid,
      p_task_id: id,
      p_actor_email: ctx.email,
      p_body: text,
      p_expected_updated_at: expectedUpdatedAt,
      p_new_mentions: newMentions,
    })
    .single();

  if (error) {
    if (error.message.includes("COMMENT_CONFLICT")) {
      return NextResponse.json(
        { error: "This comment was edited somewhere else. Refresh to see the latest version." },
        { status: 409 }
      );
    }
    if (error.message.includes("FORBIDDEN"))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (error.message.includes("COMMENT_NOT_FOUND"))
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { comment, parent_updated_at: parentUpdatedAt } =
    edited as { comment: { id: string }; parent_updated_at: string };

  const warnings = await settleSideEffects([
    {
      code: "notification_failed",
      message: "The edit was saved but newly tagged people may not have been notified.",
      run: async () => {
        if (newMentions.length === 0) return;
        await insertNotifications(
          newMentions.map((recipient) => ({
            recipient_email: recipient,
            task_id: id,
            type: "mentioned" as const,
            actor_email: ctx.email,
            comment_id: cid,
          }))
        );
      },
    },
    {
      code: "broadcast_failed",
      message: "Other open tabs may need a refresh to see this edit.",
      run: () => broadcastTaskRoom(id),
    },
  ]);

  return NextResponse.json({ comment, parent_updated_at: parentUpdatedAt, warnings });
```

- [ ] **Step 3: Make the client send the expected version and surface 409**

`edit()` currently collapses everything into `if (!res.ok) return false;`. Change its return type to
a discriminated result so `EditCommentForm` can distinguish conflict from transport failure and
**keep the user's draft** in both cases:

```ts
type EditOutcome =
  | { ok: true }
  | { ok: false; kind: "conflict" | "error"; message: string };
```

`EditCommentForm.save()` currently does `if (ok) onCancel();` and silently does nothing otherwise —
the form stays open with no explanation. Render `result.message` inline with `role="alert"` and leave
the textarea populated.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npx vitest run`

Browser: open the same comment in two tabs, save in tab A, then save in tab B → tab B shows a 409
message and **keeps its draft**. Save an unchanged body → no history row, no activity row. Edit and
then immediately PATCH the task → no false 409. Break the history insert → the whole edit rolls back
and the body is unchanged.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql "src/app/api/tasks/[id]/comments/[cid]/route.ts" \
  "src/app/(authed)/tasks/_components/CommentThread.tsx" changelog.md
git commit -m "fix(comments): make comment edits atomic with conflict detection"
```

---

## Task 11: Comment deletion retention contract (F8)

`DELETE` sets `deleted_at` and `body: ""` and nothing else. Attachments on that comment stay in
storage, stay in `task_attachments`, stay in the list's attachment count, and stay **searchable by
filename** — I verified `src/lib/tasks/search.ts:370-388` queries `task_attachments` with no
`deleted_at` filter and no join excluding deleted comments. The files vanish from the thread only
because the deleted-comment branch in `CommentThread.tsx:686-693` returns before rendering them.
There is no `comment_deleted` audit row, and only the room is broadcast, so other tabs keep a stale
counter.

> **Retention decision** (audit §6.4, restated because this task depends on it): comments stay
> soft-deleted so replies and audit references survive; linked attachment metadata is soft-deleted in
> the same command; objects are removed after commit as best-effort. **If compliance requires
> retaining deleted attachment objects, stop and get that decision before starting this task.**

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `src/app/api/tasks/[id]/comments/[cid]/route.ts:123-136`
- Modify: `src/lib/tasks/search.ts:370-388`
- Modify: `src/lib/tasks/detail.ts` (attachment queries)
- Modify: `src/app/(authed)/tasks/_components/CommentThread.tsx` (deleted branch + confirmation)

- [ ] **Step 1: Add soft-delete to attachment metadata and the command**

```sql
alter table task_attachments add column if not exists deleted_at timestamptz;

create index if not exists task_attachments_active_idx
  on task_attachments (task_id) where deleted_at is null;

create or replace function delete_task_comment_atomic(
  p_comment_id uuid,
  p_task_id uuid,
  p_actor_email text
) returns table (storage_paths text[], attachment_count integer)
language plpgsql security definer set search_path = public as $$
declare
  v_row task_comments%rowtype;
  v_paths text[];
begin
  select * into v_row from task_comments
   where id = p_comment_id and task_id = p_task_id for update;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  if v_row.author_email <> p_actor_email then raise exception 'FORBIDDEN'; end if;

  -- Replies deliberately survive under the deleted-parent placeholder; this
  -- never cascades (audit §8).
  update task_comments
     set deleted_at = clock_timestamp(), body = ''
   where id = p_comment_id and deleted_at is null;

  select coalesce(array_agg(storage_path), '{}') into v_paths
    from task_attachments
   where comment_id = p_comment_id and deleted_at is null;

  update task_attachments
     set deleted_at = clock_timestamp()
   where comment_id = p_comment_id and deleted_at is null;

  insert into task_activity (task_id, actor_email, type, meta)
  values (p_task_id, p_actor_email, 'comment_deleted',
          jsonb_build_object('comment_id', p_comment_id,
                             'attachment_count', coalesce(array_length(v_paths, 1), 0)));

  update tasks
     set updated_at = clock_timestamp(), last_activity_at = clock_timestamp(),
         last_activity_by_email = p_actor_email
   where id = p_task_id;

  storage_paths := v_paths;
  attachment_count := coalesce(array_length(v_paths, 1), 0);
  return next;
end $$;
```

- [ ] **Step 2: Exclude soft-deleted attachments everywhere they are read**

Three call sites, all currently unfiltered. Add `.is("deleted_at", null)` to each:

- `src/lib/tasks/detail.ts` — the `task_attachments` select in `loadCommentAttachments` and the
  standalone-attachment select.
- `src/lib/tasks/search.ts:373-378` — the `fetchPage` query inside `collectVisibleHits<FileSearchRow>`.
  Without this, a deleted comment's filename stays globally searchable.
- `supabase/schema.sql` `task_list_metadata` — the `attachment_count` subquery counts every row;
  add `and att.deleted_at is null` so the list counter matches what the drawer shows.

- [ ] **Step 3: Rewrite the DELETE handler**

```ts
  const { data: removed, error } = await ctx.supabase
    .rpc("delete_task_comment_atomic", {
      p_comment_id: cid,
      p_task_id: id,
      p_actor_email: ctx.email,
    })
    .single();
  if (error) { /* map FORBIDDEN → 403, COMMENT_NOT_FOUND → 404, else 500 */ }

  const { storage_paths: paths } = removed as { storage_paths: string[] };
  const warnings = await settleSideEffects([
    {
      code: "storage_cleanup_failed",
      message: "The comment was deleted but some stored files could not be removed.",
      run: async () => { for (const path of paths) await removeTaskFile(path); },
    },
    {
      code: "broadcast_failed",
      message: "Other open tabs may show a stale comment count until they refresh.",
      run: async () => { await broadcastTaskRoom(id); await broadcastTasksChanged(); },
    },
  ]);
  return NextResponse.json({ ok: true, warnings });
```

- [ ] **Step 4: Fix the deleted placeholder and add confirmation**

The current placeholder loses the author's name and the timestamp entirely:

```tsx
  if (c.deleted_at) {
    return (
      <div className="flex gap-2.5">
        <Initials email={c.author_email} label={nameOf(c.author_email)} />
        <p className="pt-1 text-xs italic text-[#97a0af]">comment deleted</p>
      </div>
    );
  }
```

Keep the author name and time so surviving replies still have clear ownership, and render
`Comment deleted` in the same header geometry as a normal comment. Add an accessible confirmation
dialog before `remove()` fires (it currently deletes straight from the menu, and `if (res.ok)`
swallows every failure) — the dialog must state that replies remain and that linked files will be
removed.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npx vitest run`

Browser/DB: delete a comment with two files and one reply → reply still visible under the
placeholder, files gone from thread **and** from global filename search, list attachment count drops,
`comment_deleted` activity present with `attachment_count: 2`, objects removed. Then make storage
removal fail → 2xx with warning, metadata still soft-deleted, drawer healthy. Check the counter in a
second tab updates without a manual refresh.

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql "src/app/api/tasks/[id]/comments/[cid]/route.ts" \
  src/lib/tasks/search.ts src/lib/tasks/detail.ts \
  "src/app/(authed)/tasks/_components/CommentThread.tsx" changelog.md
git commit -m "fix(comments): give deletion one retention and audit contract"
```

---

## Task 12: Pair last-activity time with its actor (F10)

The list renders one concept — "who last touched this, and when" — from two unrelated sources. The
time comes from `tasks.last_activity_at`; the actor comes from a subquery over `task_activity`:

```sql
    (
      select a.actor_email
      from task_activity a
      where a.task_id = t.id
      order by a.created_at desc
      limit 1
    ) as last_activity_by_email,
```

Cron writes `went_overdue` rows with `actor_email: 'system'` and does **not** touch
`last_activity_at`. So a system event silently becomes the displayed actor while the displayed time
still belongs to an earlier human action. The audit measured 11 such tasks. The identical bug exists
a second time in the legacy fallback at `src/lib/tasks/queries.ts:239-244`.

**Files:**
- Modify: `supabase/schema.sql` (column, backfill, `task_list_metadata`)
- Modify: `src/lib/tasks/queries.ts:239-259`
- Modify: `src/lib/tasks/last-activity.ts`

**Interfaces:**
- Produces: `tasks.last_activity_by_email text`. **Tasks 6, 9, 10, 11 all write it — land this task
  before them, or their commands will reference a missing column.**

- [ ] **Step 1: Add the column and a reviewed backfill**

```sql
alter table tasks add column if not exists last_activity_by_email text;

-- Backfill from the latest SUBSTANTIVE event: system rows are bookkeeping, not
-- someone touching the task, and treating them as the actor is the bug itself.
update tasks t
   set last_activity_by_email = a.actor_email
  from lateral (
    select actor_email from task_activity
     where task_id = t.id and actor_email <> 'system'
     order by created_at desc limit 1
  ) a
 where t.last_activity_by_email is null;
```

- [ ] **Step 2: Dry-run the backfill before applying it**

Run: `npx tsx scripts/audit-task-collaboration.ts`
Expected: `last_activity_actor_mismatch` reports its current count (11 at audit time). Record the
row list. Apply the backfill, re-run, and confirm the count reaches **0**. If any row cannot be
derived — a task with no non-system activity at all — leave it `null` rather than inventing an
actor; the UI already handles a missing actor.

- [ ] **Step 3: Read the column instead of re-deriving it**

In `task_list_metadata`, replace the `actor_email` subquery with `t.last_activity_by_email`, and add
the deleted-attachment filter from Task 11:

```sql
  select
    t.id as task_id,
    t.last_activity_by_email,
    (select count(*)::integer from task_comments c
      where c.task_id = t.id and c.deleted_at is null) as comment_count,
    (select count(*)::integer from task_attachments att
      where att.task_id = t.id and att.deleted_at is null) as attachment_count
  from unnest(task_ids) as t(id);
```

The response field name is unchanged, so no caller, sort, or export needs updating.

- [ ] **Step 4: Fix the legacy fallback the same way**

`src/lib/tasks/queries.ts` builds `lastActivityByTask` from `fetchTaskActivityRows`. Replace that
whole derivation with a direct select of `id,last_activity_by_email` from `tasks`, and delete
`fetchTaskActivityRows` if nothing else uses it. Leaving the old derivation in place means the bug
returns whenever the RPC is missing — which is exactly the deployment window the fallback exists for.

- [ ] **Step 5: Keep the pair in sync on every write**

`touchLastActivity` must set both. Add an `actorEmail` parameter and write
`last_activity_by_email: actorEmail` alongside `last_activity_at`. Then audit every writer: the
atomic commands from Tasks 6, 9, 10, 11 already set it; **cron must not** — system reminders and
overdue bookkeeping stay out of the human last-activity pair, which is the whole point.

- [ ] **Step 6: Verify**

Run: `npx vitest run src/lib/tasks/queries.test.ts && npm run typecheck`

Scenario checks: human comment → actor is that human, time matches. Then run the overdue cron on the
same task → **actor and time both unchanged**, `went_overdue` still recorded in activity. Then a
human PATCH → both move together. Position-only reorder → neither moves. List sort and export still
work against the unchanged field name.

- [ ] **Step 7: Commit**

```bash
git add supabase/schema.sql src/lib/tasks/queries.ts src/lib/tasks/last-activity.ts changelog.md
git commit -m "fix(activity): pair last-activity actor with its timestamp"
```

---

## Task 13: Log assignee removal as removal (F11)

Removing an assignee writes activity type `"assigned"` with `meta: { removed, to }`. The renderer's
`case "assigned"` reads only `meta.to`, so the feed says **"assigned to <the remaining person>"** for
an action that removed someone. A correct `case "unassigned"` branch already exists in
`ActivityFeed.tsx` — nothing writes it. The notification path already uses `unassigned` correctly, so
only the activity row and the renderer are wrong.

**Files:**
- Modify: `src/app/api/tasks/[id]/assignees/[email]/route.ts:101`
- Modify: `src/app/(authed)/tasks/_components/ActivityFeed.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/activity-events.test.ts (append)
import { describeActivity } from "@/lib/tasks/activity-events";

describe("assignment activity wording", () => {
  it("describes a removal as a removal", () => {
    expect(
      describeActivity({ type: "unassigned", meta: { removed: "a@x.com", next_primary: "b@x.com" } })
    ).toEqual({ kind: "unassigned", subject: "a@x.com" });
  });

  it("still reads historical rows that recorded a removal as `assigned`", () => {
    // Rows written before this fix carry meta.removed under type "assigned".
    expect(
      describeActivity({ type: "assigned", meta: { removed: "a@x.com", to: "b@x.com" } })
    ).toEqual({ kind: "unassigned", subject: "a@x.com" });
  });

  it("describes a genuine assignment as an assignment", () => {
    expect(describeActivity({ type: "assigned", meta: { to: "b@x.com" } }))
      .toEqual({ kind: "assigned", subject: "b@x.com" });
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `npx vitest run src/lib/tasks/activity-events.test.ts`
Expected: FAIL — `describeActivity` is not exported.

- [ ] **Step 3: Implement `describeActivity` in `activity-events.ts`**

```ts
/**
 * Normalises assignment rows into what actually happened. Rows written before
 * the F11 fix recorded a removal as type "assigned" with meta.removed set, so
 * the presence of `removed` — not the type — is the reliable signal. Historical
 * rows are never rewritten; they are read correctly instead.
 */
export function describeActivity(row: {
  type: string;
  meta: Record<string, unknown> | null;
}): { kind: "assigned" | "unassigned" | "other"; subject: string | null } {
  const removed = row.meta && typeof row.meta.removed === "string" ? row.meta.removed : null;
  if (row.type === "unassigned" || (row.type === "assigned" && removed)) {
    return { kind: "unassigned", subject: removed };
  }
  if (row.type === "assigned") {
    const to = row.meta && typeof row.meta.to === "string" ? row.meta.to : null;
    return { kind: "assigned", subject: to };
  }
  return { kind: "other", subject: null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/tasks/activity-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the correct type going forward**

In the assignees route, the removal branch currently sends:

```ts
    p_activity: wasAssigned
      ? [{ type: "assigned", meta: { removed: email, to: legacyAssignee } }]
      : [],
```

becomes:

```ts
    p_activity: wasAssigned
      ? [{ type: "unassigned", meta: { removed: email, next_primary: legacyAssignee } }]
      : [],
```

- [ ] **Step 6: Route the renderer through `describeActivity`**

Replace `ActivityFeed`'s `case "assigned"` / `case "unassigned"` branches with a call to
`describeActivity`, so both new and historical rows render correctly.

- [ ] **Step 7: Verify and commit**

Run: `npx vitest run && npm run typecheck`

Browser: remove the sole assignee, and remove one of several → feed reads "removed X from the task",
the DB row is `unassigned`, and pre-existing malformed `assigned` rows now also render as removals.

```bash
git add "src/app/api/tasks/[id]/assignees/[email]/route.ts" \
  "src/app/(authed)/tasks/_components/ActivityFeed.tsx" \
  src/lib/tasks/activity-events.ts src/lib/tasks/activity-events.test.ts changelog.md
git commit -m "fix(activity): record assignee removal as unassigned"
```

---

## Task 14: Idempotent, atomically audited task creation (F12)

`POST /api/tasks` writes the task, then assignees, then rotation, then activity, then history, then
notifications — six steps, no transaction. Rotation failure returns 500 **after the task exists**, so
a user retry creates a duplicate task. The `created` activity insert result is never checked, so a
task can exist with no creation audit at all.

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `src/app/api/tasks/route.ts:253-373`
- Modify: `src/app/(authed)/tasks/_components/NewTaskDialog.tsx` (request id only)

- [ ] **Step 1: Add the idempotency key and command**

```sql
alter table tasks add column if not exists client_request_id uuid;

create unique index if not exists tasks_client_request_id_key
  on tasks (reporter_email, client_request_id)
  where client_request_id is not null;
```

`create_task_atomic(p_task jsonb, p_assignees text[], p_actor_email text, p_client_request_id uuid)`
inserts the task from the jsonb payload, inserts `task_assignees`, writes the required `created`
activity plus initial history, and returns `(task jsonb, was_created boolean)`. On replay it returns
the existing task and writes nothing. Follow the structure of `create_task_comment_atomic` from
Task 6 — same replay-check-first shape, same required/best-effort split.

- [ ] **Step 2: Decide where rotation lives — and write the decision down**

`bumpAssignmentRotation` is fair-assignment bookkeeping across *other* rows, not part of this task's
canonical state. It goes **after** the commit as a warning-producing side effect. It must not return
500 for a task that already exists. Because skipping it silently would skew assignment fairness, the
warning code `rotation_failed` must be logged with the task id so it can be reconciled.

- [ ] **Step 3: Rewrite the handler around the command**

Replace lines 253-373 with: build the task payload → call `create_task_atomic` → on error map and
return → on success run `settleSideEffects([rotation, notifications, broadcast])` → return
`{ task, warnings }`. The `attachAssigneesToTasks` shaping call stays; it is a read.

- [ ] **Step 4: Send a stable request id from the dialog**

`NewTaskDialog` mints `crypto.randomUUID()` once per open form (not per submit attempt) and reuses it
across retries, exactly as `beginSubmission` does for comments in Task 7. Reset it only after a
successful create or an explicit discard.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npx vitest run`

Fault matrix: assignee insert fails → **no task row**. Activity insert fails → **no task row**.
Rotation fails → **201 with `rotation_failed` warning**, task present and correctly assigned.
Notification fails → 201 with warning. Replay the same request id → the same task, exactly one
`created` activity row.

Then `npx tsx scripts/audit-task-collaboration.ts` → task count and `created`-activity count stay
equal.

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql "src/app/api/tasks/route.ts" \
  "src/app/(authed)/tasks/_components/NewTaskDialog.tsx" changelog.md
git commit -m "fix(tasks): create tasks atomically and idempotently"
```

---

## Task 15: Atomic, idempotent overdue transition (F13)

The cron's newly-overdue branch runs three awaits in sequence inside a `Promise.all` over tasks:
update the task flag, `openOverdueEvent`, insert `went_overdue` — and the activity insert's result is
never inspected. There is a `.is("overdue_flagged_at", null)` guard on the update, which is good, but
**the code never checks whether that update actually matched a row**. Two concurrent cron runs
therefore both continue past it and both write an event and an activity row. The audit measured the
consequence: 110 overdue-marked tasks but only 99 with `went_overdue`, and 8 with no event history.

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `src/app/api/cron/check-overdue/route.ts:188-243`

**Interfaces:**
- Produces: `mark_task_overdue_atomic(...) → boolean` — true only when **this** invocation performed
  the transition. Notifications fire only on true.

- [ ] **Step 1: Add the command**

```sql
-- Returns true only if THIS call flipped the task into overdue. The old code
-- had the right conditional update but never checked whether it matched, so a
-- second concurrent run still wrote a duplicate event and activity row
-- (audit F13).
create or replace function mark_task_overdue_atomic(
  p_task_id uuid,
  p_due_at timestamptz,
  p_sla_minutes integer
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := clock_timestamp();
  v_updated integer;
begin
  update tasks
     set overdue_flagged_at = v_now,
         overdue_reminded_at = v_now,
         overdue_count = overdue_count + 1
   where id = p_task_id and overdue_flagged_at is null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then return false; end if;

  insert into task_overdue_events (task_id, due_at, overdue_at, sla_minutes)
  values (p_task_id, p_due_at, v_now, p_sla_minutes);

  insert into task_activity (task_id, actor_email, type, meta)
  values (p_task_id, 'system', 'went_overdue',
          jsonb_build_object('due_at', p_due_at, 'flagged_at', v_now));

  -- Deliberately does NOT touch last_activity_at / last_activity_by_email:
  -- system bookkeeping is not someone touching the task (audit F10).
  return true;
end $$;
```

- [ ] **Step 2: Rewrite the cron branch**

```ts
      newlyOverdue.map(async (task) => {
        const dueAt = currentStintDueAt(task, rules) ?? now;
        const { data: transitioned, error } = await supabase.rpc(
          "mark_task_overdue_atomic",
          {
            p_task_id: task.id,
            p_due_at: dueAt.toISOString(),
            p_sla_minutes: effectiveSlaMinutes(task, rules),
          }
        );
        if (error) throw new Error(error.message);
        // Another run (or a user status change) got there first: everything
        // below is the transition's side effects, so it must not fire twice.
        if (transitioned !== true) return;

        // Recipient resolution and row construction are unchanged from today —
        // they were already correct. They move inside the `transitioned` guard
        // so a losing concurrent run cannot re-notify everyone.
        const [assignees, agentRecipients, adminRecipients] = await Promise.all([
          fetchTaskAssigneeEmails(task.id, supabase),
          task.priority === "urgent" || task.priority === "high"
            ? fetchAgentOwnerAndAssistantEmails(task.agent_email)
            : Promise.resolve([]),
          task.priority === "urgent" || task.priority === "high"
            ? fetchAdminEmails()
            : Promise.resolve([]),
        ]);
        const escalationRecipients = uniqueNotificationRecipients(
          [...agentRecipients, ...adminRecipients],
          assignees
        );
        const rows: NotificationInsertInput[] = uniqueNotificationRows([
          ...assignees.map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "overdue" as const,
            actor_email: "system",
          })),
          ...escalationRecipients.map((email) => ({
            recipient_email: email,
            task_id: task.id,
            type: "sla_escalated" as const,
            actor_email: "system",
            detail: `${task.priority} task breached SLA`,
          })),
        ]);
        await insertNotifications(rows);
      })
```

- [ ] **Step 3: Produce the repair report for existing gaps**

Run: `npx tsx scripts/audit-task-collaboration.ts --json > /tmp/overdue-gaps.json`

The audit found 11 tasks missing `went_overdue` and 8 missing event history. For each, the
transition time can be derived from `tasks.overdue_flagged_at`, which is real recorded data. Where
`overdue_flagged_at` is itself null the row cannot be repaired without inventing a timestamp — list
those separately and **get owner approval before writing anything**. Mark every repaired row with
`meta.source = 'backfill'` so a later audit can tell derived rows from observed ones.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npx vitest run`

Concurrency checks: invoke the cron endpoint twice simultaneously → exactly one event and one
`went_overdue` per task, one set of notifications. Change a task's status to done while cron is
mid-flight → no reopened event, no double count. Force the event insert to fail → the task is **not**
left flagged (the whole command rolls back).

After the backfill: `npx tsx scripts/audit-task-collaboration.ts` → `overdue_gaps` is **0**.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql "src/app/api/cron/check-overdue/route.ts" changelog.md
git commit -m "fix(activity): make the overdue transition atomic and idempotent"
```

---

## Task 16: Canonical author and editor names (F19)

`CommentThread` resolves every identity through:

```ts
  const nameOf = useCallback(
    (email: string) =>
      members.find((m) => m.email === email)?.name ?? formatEmailAsName(email),
    [members],
  );
```

`members` is the *active mention roster* — task assignees on the Tasks side, active `portal_account`
rows on the Enrollment side. It is a picker roster being used as a historical identity directory. An
author who left the team, changed roles, or was never on the roster falls through to
`formatEmailAsName()`, which does not look anything up: it splits the email local part on `._-` and
title-cases it. That is a **guess rendered as a fact**, and the same problem exists in the edit
history, whose API returns `edited_by` only.

**Files:**
- Create: `src/lib/people/display-names.ts` + `.test.ts`
- Modify: `src/lib/tasks/detail.ts` (`COMMENT_COLUMNS` consumers)
- Modify: `src/lib/enrollment/detail.ts`, `src/lib/enrollment/types.ts`
- Modify: `src/app/api/tasks/[id]/comments/[cid]/edits/route.ts:68-74`
- Modify: `src/app/api/enrollment/[id]/comments/[cid]/edits/route.ts`
- Modify: `src/app/(authed)/tasks/_components/CommentThread.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/people/display-names.test.ts
import { describe, expect, it } from "vitest";
import { buildDisplayNameMap, UNKNOWN_PERSON_LABEL } from "@/lib/people/display-names";

describe("buildDisplayNameMap", () => {
  it("uses the canonical account name, including for inactive accounts", () => {
    const map = buildDisplayNameMap([
      { email: "bao@x.com", name: "Võ Thương Bảo", active: false },
    ]);
    expect(map.get("bao@x.com")).toBe("Võ Thương Bảo");
  });

  it("falls back to a neutral label, never to a name guessed from the email", () => {
    const map = buildDisplayNameMap([{ email: "j.doe@x.com", name: null, active: true }]);
    expect(map.get("j.doe@x.com")).toBe(UNKNOWN_PERSON_LABEL);
    expect(map.get("j.doe@x.com")).not.toBe("J Doe");
  });

  it("normalises lookup keys so casing never splits one person in two", () => {
    const map = buildDisplayNameMap([{ email: "Bao@X.com", name: "Bảo", active: true }]);
    expect(map.get("bao@x.com")).toBe("Bảo");
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `npx vitest run src/lib/people/display-names.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

```ts
// src/lib/people/display-names.ts
// Historical identity, not the active picker roster. Comment authors and
// editors can be inactive, off the current role-scoped roster, or gone — and a
// name guessed from an email local part is a guess rendered as a fact
// (audit F19). One batched query, never N+1.
import { getSupabaseAdmin } from "@/lib/supabase";

export const UNKNOWN_PERSON_LABEL = "Unknown user";

type AccountRow = { email: string; name: string | null; active?: boolean };

export function buildDisplayNameMap(rows: readonly AccountRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const key = row.email.trim().toLowerCase();
    const name = row.name?.trim();
    map.set(key, name || UNKNOWN_PERSON_LABEL);
  }
  return map;
}

/**
 * Resolves every distinct email in one query. `active` is deliberately NOT
 * filtered: a comment written by someone who has since been deactivated must
 * still show their real name.
 */
export async function resolveDisplayNames(
  emails: readonly string[]
): Promise<Map<string, string>> {
  const distinct = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (distinct.length === 0) return new Map();

  const { data, error } = await getSupabaseAdmin()
    .from("portal_account")
    .select("email,name")
    .in("email", distinct);
  if (error) throw new Error(error.message);

  const resolved = buildDisplayNameMap((data ?? []) as AccountRow[]);
  // Emails with no account row at all still need a stable label.
  for (const email of distinct) {
    if (!resolved.has(email)) resolved.set(email, UNKNOWN_PERSON_LABEL);
  }
  return resolved;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/people/display-names.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the typed response fields on both products**

In `loadComments` (Tasks) and `loadEnrollmentComments` (Enrollment), collect every distinct
`author_email`, call `resolveDisplayNames` **once**, and attach `author_name: string` to each comment.
Do the same for `edited_by` → `edited_by_name` in both edit-history routes. Keep the email fields —
they remain the identity key for permissions, avatar colour, and mention encoding.

- [ ] **Step 6: Render names only**

Delete `nameOf`'s `formatEmailAsName` fallback from `CommentThread`; read `author_name` /
`edited_by_name` from the response instead. Optimistic rows use the authenticated user's resolved
name. Audit every `title`, `aria-label`, and error string in the comment surfaces — none may contain
an email. `Initials` keeps taking the email for stable avatar colour, but its accessible label
becomes the display name.

- [ ] **Step 7: Verify**

Run: `npx vitest run && npm run typecheck`

Fixtures on Tasks **and** Enrollment: active author, deactivated author, author with no
`portal_account` row, author with a null name, and an author renamed after commenting (the old
comment must show the **new** name — that is the documented intent, not a bug). Assert no raw email
appears in the comment card, deleted placeholder, edit form, edit history, `title`, or the
accessibility tree.

- [ ] **Step 8: Commit**

```bash
git add src/lib/people/display-names.ts src/lib/people/display-names.test.ts \
  src/lib/tasks/detail.ts src/lib/enrollment/detail.ts src/lib/enrollment/types.ts \
  "src/app/api/tasks/[id]/comments/[cid]/edits/route.ts" \
  "src/app/api/enrollment/[id]/comments/[cid]/edits/route.ts" \
  "src/app/(authed)/tasks/_components/CommentThread.tsx" changelog.md
git commit -m "fix(comments): resolve canonical author and editor names"
```

---

## Task 17: One mention model for create, reply, and edit (F20, F21)

The composer has mention autocomplete; `EditCommentForm` is a bare `<textarea>`. It decodes existing
tokens with `decodeStoredMentions` and re-encodes them with `encodeDraftMentions`, which works by
regex-replacing the *label text*:

```ts
    const pattern = new RegExp(
      `(^|\\s)@${escapeRegExp(label)}(?=\\s|$|[.,!?;:])`, "g",
    );
```

Two consequences, both verified. A newly typed `@Name` during edit has no entry in `mentions`, so it
is saved as plain text and notifies nobody — while looking exactly like a tag to the user. And
editing the characters *around* an existing label breaks the pattern, silently severing a mention
that the user believes is still there.

The picker itself has three gaps: the filter is `toLowerCase().includes()` with no accent or `đ`
handling — and the identical predicate is duplicated at `CommentThread.tsx:1009-1015` and
`1063-1068`; the menu is a fixed `w-72` / `MENTION_MENU_WIDTH = 288` that overflows a 320 px
viewport; and it has `role="listbox"` and `role="option"` but **no `role="combobox"`, no
`aria-controls`, and no `aria-activedescendant`**, so a screen reader never hears the active option.

`src/lib/ui/option-search.ts` already exports exactly the primitives needed —
`normalizeOptionSearchText`, `filterSearchableChoices`, `initialEnabledChoiceIndex`,
`moveEnabledChoiceIndex` — and its `normalizeOptionSearchText` already handles Vietnamese `đ/Đ`.
Reuse it; do not write a third normalisation.

**Files:**
- Create: `src/lib/tasks/mention-draft.ts` + `.test.ts`
- Modify: `src/app/(authed)/tasks/_components/CommentThread.tsx` (`Composer` + `EditCommentForm`)

**Interfaces:**
- Consumes: `normalizeOptionSearchText`, `filterSearchableChoices` (`src/lib/ui/option-search.ts`);
  `edit_task_comment_atomic`'s `p_new_mentions` (Task 10); `author_name` (Task 16).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/mention-draft.test.ts
import { describe, expect, it } from "vitest";
import {
  decodeMentions, encodeMentions, findActiveMention,
  filterMentionCandidates, diffMentionEmails,
} from "@/lib/tasks/mention-draft";

const roster = [
  { email: "bao@x.com", name: "Võ Thương Bảo" },
  { email: "do@x.com", name: "Đỗ Minh" },
  { email: "bao2@x.com", name: "Bảo Trân" },
];

describe("mention search", () => {
  it("matches Vietnamese names typed without accents", () => {
    expect(filterMentionCandidates(roster, "bao").map((m) => m.email))
      .toEqual(["bao@x.com", "bao2@x.com"]);
  });

  it("matches đ typed as d", () => {
    expect(filterMentionCandidates(roster, "do").map((m) => m.email)).toEqual(["do@x.com"]);
  });

  it("matches on email internally without making email the visible label", () => {
    expect(filterMentionCandidates(roster, "bao2@").map((m) => m.email)).toEqual(["bao2@x.com"]);
  });
});

describe("mention identity", () => {
  it("survives text edited around an existing tag", () => {
    const stored = "hi @[Võ Thương Bảo](bao@x.com) please check";
    const draft = decodeMentions(stored);
    const rewritten = { ...draft, text: draft.text.replace("please check", "check this now") };
    // The old label-regex approach lost the identity here.
    expect(encodeMentions(rewritten)).toContain("@[Võ Thương Bảo](bao@x.com)");
  });

  it("does not turn arbitrary @text into a tag", () => {
    const draft = { text: "ping @nobody", mentions: [] };
    expect(encodeMentions(draft)).toBe("ping @nobody");
  });

  it("reports only newly added emails so only they get notified", () => {
    expect(diffMentionEmails(["a@x.com"], ["a@x.com", "b@x.com"])).toEqual(["b@x.com"]);
  });
});

describe("findActiveMention", () => {
  it("detects the token under the caret", () => {
    expect(findActiveMention("hi @ba", 6)).toMatchObject({ query: "ba" });
  });

  it("ignores an email address already typed", () => {
    expect(findActiveMention("mail a@b.com", 12)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `npx vitest run src/lib/tasks/mention-draft.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the shared model**

Move `MENTION_TOKEN`, `findActiveMention`, `mentionLabel`, `decodeStoredMentions`, and
`encodeDraftMentions` out of `CommentThread.tsx` into `src/lib/tasks/mention-draft.ts`, and fix the
identity problem while moving them: a draft carries mentions as **positioned entries**, not as labels
to be re-found by regex, so editing surrounding text cannot sever them. `filterMentionCandidates`
delegates to `filterSearchableChoices` with the person's name as `label` and their email as a
`keywords` entry — so email matches internally while the visible label stays name-only.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/tasks/mention-draft.test.ts`
Expected: PASS.

- [ ] **Step 5: Build one picker component and use it in all three places**

Extract the picker into a component taking `{ candidates, query, activeIndex, onSelect }`. Required
changes versus today:
- the input owns `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`;
- the list owns `role="listbox"`, options get stable `useId`-derived ids — **not array indexes**;
- arrow navigation uses `moveEnabledChoiceIndex` from `option-search.ts`;
- a zero-result state renders `No matching people` instead of the menu vanishing;
- width becomes `min(288px, calc(100vw - 16px))` so a 320 px viewport is safe;
- rows show avatar + canonical name + role/team secondary text, never a bare email.

Delete the duplicated filter predicate at both `1009-1015` and `1063-1068`; both now call
`filterMentionCandidates`.

- [ ] **Step 6: Give `EditCommentForm` the same editor**

Replace its bare `<textarea>` with the shared draft editor. Decode existing tokens losslessly and
keep their email identity even when the account is no longer selectable. On save, pass
`diffMentionEmails(before, after)` to Task 10's `p_new_mentions` so only newly added people are
notified — removing a tag never revokes existing access.

- [ ] **Step 7: Render chips from canonical names**

`renderBody` currently prints `@{m[1]}` — the label frozen inside the stored token, so a renamed
account shows its old name forever. Resolve the display name from Task 16's map by email, falling
back to the stored label only when resolution genuinely fails, and to `UNKNOWN_PERSON_LABEL` after
that. Never fall back to the email. Style as a compact soft-blue chip rather than the current flat
`bg-[#deebff]` text highlight.

- [ ] **Step 8: Verify**

Run: `npx vitest run && npm run typecheck && npm run lint`

Browser matrix on Tasks, ACA, **and** Medicare: type `bao` → matches `Bảo`; type `do` → matches `Đỗ`;
zero results shows the empty state; two people with the same display name are distinguishable by
role/team without exposing an email; keyboard-only selection and VoiceOver announce the active
option; IME composition does not commit a tag early; 320 px viewport keeps the menu on screen; add a
**new** mention during edit → that person becomes a participant and is notified; remove a tag → no
hidden mention email is left in the stored body; a mention of an account renamed since the comment
shows the new name.

- [ ] **Step 9: Commit**

```bash
git add src/lib/tasks/mention-draft.ts src/lib/tasks/mention-draft.test.ts \
  "src/app/(authed)/tasks/_components/CommentThread.tsx" changelog.md
git commit -m "fix(comments): unify searchable mentions across create, reply and edit"
```

---

# Phase D — P3 hardening

Correctness first: none of these ship before Phase B is complete and Phase C's P2s are either done or
explicitly deferred with a named owner.

## Task 18: Authorize before doing privileged work (F15)

For non-managers the detail route runs the scope checks and the **full privileged detail load** —
including storage URL signing — inside one `Promise.all`, then throws the result away on 403. The
code comment calls this "just parallelized"; that is precisely the finding. An authenticated but
unauthorized account can make the server read comments, read activity, and mint signed URLs for
arbitrary task IDs.

**Files:**
- Modify: `src/app/api/tasks/[id]/detail/route.ts:67-103`

- [ ] **Step 1: Split the one wave into decide-then-load**

```ts
    // Only the scope predicates are independent of each other. Resolving them
    // in parallel is fine; loading privileged data alongside them is not — the
    // old shape signed storage URLs for requests it then answered with 403.
    const [isAgentOwner, isParticipant, isAssignee, agents, seeAll] =
      await Promise.all([
        isAgentOwnerOrAssistant(taskScope.agent_email, actor.email),
        isTaskParticipant(id, actor.email),
        isTaskAssignee(id, actor.email, supabase),
        fetchAgentsForCs(actor.email),
        actorSeesAllTasks(actor),
      ]);
    const isAgentMember = Boolean(
      taskScope.agent_email && agents.includes(taskScope.agent_email)
    );

    if (
      !seeAll &&
      !canViewTask(actor, taskScope, {
        isParticipant, isAgentMember, isAgentOwner, isAssignee,
      })
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Authorized. Load only what this role may actually receive — activity is
    // owner/assistant-only, so for everyone else we must not query it at all
    // rather than query it and strip it afterwards.
    const detail = await loadDetailAndMetadata({ includeActivity: isAgentOwner });
    return NextResponse.json(detail);
```

- [ ] **Step 2: Make `loadDetailAndMetadata` honour `includeActivity`**

Thread the flag into `loadTaskDetail` so `loadActivity` is skipped entirely rather than called and
discarded. Return `activity: []` for roles that may not see it — the response shape is unchanged.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run src/lib/tasks/detail.test.ts`

Instrumented check: wrap the Supabase client and `signTaskFile` with counters, then request a task
the actor cannot view. Expected: **zero** comment queries, **zero** activity queries, **zero** signing
calls, response 403. Then confirm the authorized role matrix is unchanged (manager, plain CS,
assignee, participant, agent owner, agent assistant).

Measure drawer open latency before and after — this trades one network wave for correctness. If the
regression is user-visible, keep hover prefetch but move it *after* authorization rather than
reverting.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/tasks/[id]/detail/route.ts" src/lib/tasks/detail.ts changelog.md
git commit -m "fix(task-detail): resolve authorization before privileged reads"
```

---

## Task 19: Expire the detail cache before its signed URLs (F16)

`detail-cache.ts` is a bare `Map` with no timestamps, no TTL, and no invalidation, while
`signTaskFile` mints URLs that expire after 3600 s. `reload()` swallows every failure — both
`if (!res.ok) return;` and an empty `catch` — so a stale cached payload with dead links can persist
for as long as the tab stays open.

**Files:**
- Modify: `src/lib/tasks/detail-cache.ts`
- Modify: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx:139-150`
- Test: `src/lib/tasks/detail-cache.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/detail-cache.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  getCachedTaskDetail, setCachedTaskDetail,
  invalidateTaskDetail, DETAIL_CACHE_TTL_MS,
} from "@/lib/tasks/detail-cache";

const detail = { comments: [], activity: [], attachments: [] } as never;

describe("detail cache", () => {
  it("expires well before a signed URL does", () => {
    // Signed URLs live 3600 s; serving a payload older than that guarantees
    // dead image and download links.
    expect(DETAIL_CACHE_TTL_MS).toBeLessThan(3600_000);
  });

  it("returns undefined once the entry is older than the TTL", () => {
    vi.useFakeTimers();
    setCachedTaskDetail("t1", detail);
    expect(getCachedTaskDetail("t1")).toBeDefined();
    vi.advanceTimersByTime(DETAIL_CACHE_TTL_MS + 1);
    expect(getCachedTaskDetail("t1")).toBeUndefined();
    vi.useRealTimers();
  });

  it("drops an entry on explicit invalidation", () => {
    setCachedTaskDetail("t2", detail);
    invalidateTaskDetail("t2");
    expect(getCachedTaskDetail("t2")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `npx vitest run src/lib/tasks/detail-cache.test.ts`
Expected: FAIL — `DETAIL_CACHE_TTL_MS` and `invalidateTaskDetail` are not exported.

- [ ] **Step 3: Add timestamps, TTL, and invalidation**

```ts
import type { TaskDetail } from "./detail";

// Attachment URLs are signed for one hour (see signTaskFile). A cache entry
// that can outlive its own credentials serves dead image and download links,
// so the TTL is deliberately an order of magnitude below the URL lifetime.
export const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;

type Entry = { detail: TaskDetail; storedAt: number };

const cache = new Map<string, Entry>();
const inFlight = new Set<string>();

export function getCachedTaskDetail(id: string): TaskDetail | undefined {
  const entry = cache.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > DETAIL_CACHE_TTL_MS) {
    cache.delete(id);
    return undefined;
  }
  return entry.detail;
}

export function setCachedTaskDetail(id: string, detail: TaskDetail): void {
  cache.set(id, { detail, storedAt: Date.now() });
}

/** Called on any room mutation so the next open re-fetches instead of guessing. */
export function invalidateTaskDetail(id: string): void {
  cache.delete(id);
}
```

Keep `prefetchTaskDetail` as-is except that it must respect the TTL through `getCachedTaskDetail`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/tasks/detail-cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Surface reload failure instead of swallowing it**

`reload()` currently returns `void` and hides both branches. Make it return a result the drawer can
render, **without discarding committed optimistic state**:

```ts
  const reload = useCallback(async (): Promise<"ok" | "failed"> => {
    try {
      const res = await fetch(`/api/tasks/${task.id}/detail`);
      if (!res.ok) return "failed";
      const data = (await res.json()) as TaskDetail;
      setCachedTaskDetail(task.id, data);
      setDetail(data);
      if (data.metadata) onMetadataUpdatedRef.current?.(data.metadata);
      return "ok";
    } catch {
      return "failed";
    }
  }, [task.id]);
```

Render a small non-blocking "Could not refresh — Retry" affordance on `"failed"`. This pairs with
Task 8, where a reload failure must never mark a committed comment failed.

- [ ] **Step 6: Invalidate on realtime mutation**

Wherever the room channel signals a change, call `invalidateTaskDetail(taskId)` before reloading, so
a slow or failed reload cannot leave a stale entry that a later open would serve.

- [ ] **Step 7: Verify**

Run: `npx vitest run && npm run typecheck`

Browser: open a task, leave the tab for over an hour, reopen from a card — links work. Force the
reload request offline — the drawer keeps its content and shows the retry affordance. Mutate the task
in a second tab — the first tab's cached entry is dropped.

- [ ] **Step 8: Commit**

```bash
git add src/lib/tasks/detail-cache.ts src/lib/tasks/detail-cache.test.ts \
  "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx" changelog.md
git commit -m "fix(task-detail): expire cached detail before its signed urls"
```

---

## Task 20: Operation-level limits (F17)

Per-file validation is already good — `validateAttachmentFile` does magic-byte checks for eight
extensions and rejects HTML disguised as `txt`/`csv`. What is missing is any limit on the *operation*:
comment text length, file count, and aggregate bytes are all unbounded, and the multipart body is
parsed before full authorization.

**Files:**
- Create: `src/lib/tasks/attachment-limits.ts` + `.test.ts`
- Modify: `src/app/api/tasks/[id]/comments/route.ts` (length check)
- Modify: `src/app/api/tasks/[id]/attachments/route.ts` (count / aggregate check)
- Modify: `src/app/(authed)/tasks/_components/CommentThread.tsx` (client-side mirror)

- [ ] **Step 1: Query real distributions before choosing numbers**

Run `npx tsx scripts/audit-task-collaboration.ts --json` and inspect the largest existing comment
body, the largest file count on one comment, and the largest aggregate. **If any current legitimate
record exceeds a proposed limit, raise the limit — do not break existing workflows.** Record the
observed maxima in the Execution Log next to the chosen values.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/tasks/attachment-limits.test.ts
import { describe, expect, it } from "vitest";
import { checkOperationLimits, LIMITS } from "@/lib/tasks/attachment-limits";

const mb = (n: number) => n * 1024 * 1024;

describe("operation limits", () => {
  it("accepts an ordinary comment with two files", () => {
    expect(checkOperationLimits({ textLength: 200, sizes: [mb(1), mb(2)] }))
      .toEqual({ ok: true });
  });

  it("reports the aggregate limit, not the count, when aggregate binds first", () => {
    // Four 15 MiB files are under the 10-file cap but over the 50 MiB aggregate.
    // The message must name the limit that actually tripped.
    const result = checkOperationLimits({ textLength: 0, sizes: Array(4).fill(mb(15)) });
    expect(result).toMatchObject({ ok: false, limit: "aggregate" });
    expect((result as { message: string }).message).toContain("50MB");
  });

  it("reports the count limit when only the count is exceeded", () => {
    expect(checkOperationLimits({ textLength: 0, sizes: Array(11).fill(1024) }))
      .toMatchObject({ ok: false, limit: "count" });
  });

  it("reports the text limit", () => {
    expect(checkOperationLimits({ textLength: LIMITS.maxTextLength + 1, sizes: [] }))
      .toMatchObject({ ok: false, limit: "text" });
  });
});
```

- [ ] **Step 3: Run it, watch it fail, then implement**

Run: `npx vitest run src/lib/tasks/attachment-limits.test.ts` → FAIL.

```ts
// src/lib/tasks/attachment-limits.ts
import { TASK_ATTACHMENT_MAX_BYTES, formatAttachmentSize } from "./attachments";

export const LIMITS = {
  maxTextLength: 10_000,
  maxFiles: 10,
  maxAggregateBytes: 50 * 1024 * 1024,
} as const;

export type LimitFailure = {
  ok: false;
  limit: "text" | "count" | "aggregate" | "per_file";
  message: string;
};

/**
 * Precedence is aggregate > count > per-file, and it matters: the per-file cap
 * is 15 MiB and the count cap is 10, so ten maximum-size files would be 150 MiB
 * — three times the aggregate. The aggregate binds first in practice, so the
 * message must name the limit that actually tripped or the error reads as
 * arbitrary.
 */
export function checkOperationLimits(input: {
  textLength: number;
  sizes: readonly number[];
}): { ok: true } | LimitFailure {
  if (input.textLength > LIMITS.maxTextLength) {
    return { ok: false, limit: "text",
      message: `Comment is too long (max ${LIMITS.maxTextLength.toLocaleString()} characters).` };
  }
  const total = input.sizes.reduce((sum, size) => sum + size, 0);
  if (total > LIMITS.maxAggregateBytes) {
    return { ok: false, limit: "aggregate",
      message: `Attachments are too large in total (max ${formatAttachmentSize(LIMITS.maxAggregateBytes)}).` };
  }
  if (input.sizes.length > LIMITS.maxFiles) {
    return { ok: false, limit: "count",
      message: `Too many files (max ${LIMITS.maxFiles} per comment).` };
  }
  if (input.sizes.some((size) => size > TASK_ATTACHMENT_MAX_BYTES)) {
    return { ok: false, limit: "per_file",
      message: `File too large (max ${formatAttachmentSize(TASK_ATTACHMENT_MAX_BYTES)}).` };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Enforce on both sides with the same messages**

Server: the comment route checks `textLength`; the attachment route checks the running aggregate and
count for the target comment (query existing `task_attachments` for that `comment_id`, sum
`size_bytes`, add the incoming file). Client: `CommentThread` runs the same function at selection
time, so a user learns before uploading 40 MiB.

- [ ] **Step 5: Document the malware position**

Add a short section to `changelog.md` (and this plan's Execution Log): authenticated Office and PDF
uploads are **not** malware-scanned. Magic-byte validation is anti-confusion, not anti-malware. HEIC
has no structural check because no reliable lightweight one exists — it is accepted on extension plus
size alone. **Adding a scanning vendor needs security and product ownership, cost, quarantine
behaviour, and a support plan; it is explicitly out of scope here.** Get an owner's written risk
acceptance before go-live, or raise F17 to P2.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run && npm run typecheck`

Boundary tests at each limit ±1; an unauthorized large upload is rejected **before** the body is
read; every accepted extension still uploads a real sample file.

```bash
git add src/lib/tasks/attachment-limits.ts src/lib/tasks/attachment-limits.test.ts \
  "src/app/api/tasks/[id]/comments/route.ts" "src/app/api/tasks/[id]/attachments/route.ts" \
  "src/app/(authed)/tasks/_components/CommentThread.tsx" changelog.md
git commit -m "fix(tasks): enforce collaboration operation limits"
```

---

## Task 21: Enforce cross-row invariants in the commands (F18)

`task_comments.parent_id` and `task_attachments.comment_id` both reference `task_comments(id)`, while
`task_id` is a separate column. Nothing at the database level stops a reply or an attachment from
pointing at a comment on a *different* task — which would expose one task's file through another
task's detail query.

**Files:**
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Prove the current data is clean first**

Run: `npx tsx scripts/audit-task-collaboration.ts`
Expected: no cross-task links. **If any exist, stop and fix the data before adding enforcement** — a
constraint added over bad rows fails at validation time.

- [ ] **Step 2: Confirm the commands already enforce it**

Tasks 6 and 9 added these checks inside `create_task_comment_atomic` (`INVALID_PARENT`, which also
verifies `parent_id is null` for one-level depth) and `create_task_attachment_atomic`
(`INVALID_COMMENT`). Re-read both and confirm they are present. Since every write now goes through a
command, this is the enforcement boundary.

- [ ] **Step 3: Add narrow triggers only if a non-command writer must survive**

If any script, import, or admin path writes these tables directly, the command boundary is not
sufficient. Add:

```sql
create or replace function task_comment_same_task()
returns trigger language plpgsql as $$
begin
  if new.parent_id is not null then
    perform 1 from task_comments
     where id = new.parent_id and task_id = new.task_id and parent_id is null;
    if not found then
      raise exception 'reply parent must be a top-level comment on the same task';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists task_comment_same_task on task_comments;
create trigger task_comment_same_task
  before insert or update on task_comments
  for each row execute function task_comment_same_task();
```

and the analogous `task_attachment_same_task` for `comment_id`. If no such writer exists, **do not
add the triggers** — document that the commands own the invariant, and note that any future direct
writer must add them.

- [ ] **Step 4: Add the indexes the new queries need**

```sql
create index if not exists task_attachments_comment_active_idx
  on task_attachments (comment_id) where deleted_at is null;
```

- [ ] **Step 5: Verify and commit**

Attempt each invalid write directly against the database: a reply whose parent is on another task; a
reply to a reply; an attachment whose comment is on another task. All must fail. Valid top-level
replies and comment attachments must continue to work.

```bash
git add supabase/schema.sql changelog.md
git commit -m "fix(tasks): enforce same-task comment and attachment invariants"
```

---

## Task 22: Align the activity renderer with the vocabulary (F14)

`ActivityFeed.describe()` has branches for `stage_changed`, `people_changed`, `field_changed`,
`qc_needed`, `due_soon`, `stale`, `archived`, `overdue_resolved`, and `qc_review_cleared` — **none of
which `task_activity` can ever hold.** I verified each: they belong to `enrollment_activity` or
`task_notifications`. They are dead code, not a live failure, which is why this is P3. Meanwhile
`attachment_added` *is* allowed by the constraint and has **no branch**, so it renders as raw
`attachment_added`.

**Files:**
- Modify: `src/app/(authed)/tasks/_components/ActivityFeed.tsx:7-38`
- Modify: `src/lib/tasks/activity-events.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/lib/tasks/activity-events.test.ts
import { ALLOWED_TASK_ACTIVITY_TYPES } from "@/lib/tasks/activity-events";
import { ACTIVITY_LABELS } from "@/app/(authed)/tasks/_components/activity-labels";

describe("activity renderer coverage", () => {
  it("has a label for every allowed type and no label for a type that cannot exist", () => {
    const labelled = new Set(Object.keys(ACTIVITY_LABELS));
    const allowed = new Set<string>(ALLOWED_TASK_ACTIVITY_TYPES);
    expect([...allowed].filter((t) => !labelled.has(t))).toEqual([]);
    expect([...labelled].filter((t) => !allowed.has(t))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `npx vitest run src/lib/tasks/activity-events.test.ts`
Expected: FAIL — the module does not exist, and once created the two sets will not match.

- [ ] **Step 3: Extract the label map into a testable `.ts` module**

Create `src/app/(authed)/tasks/_components/activity-labels.ts` — a plain `.ts` file so Vitest
collects it — holding `ACTIVITY_LABELS: Record<TaskActivityType, (meta) => string>`. Add the four
missing lifecycle branches:

```ts
  attachment_added: () => "attached a file",
  attachment_deleted: () => "removed a file",
  comment_edited: () => "edited a comment",
  comment_deleted: () => "deleted a comment",
```

and **delete** the nine branches for types `task_activity` cannot hold. Keep `ActivityFeed`'s
`default: return a.type` fallback for historical rows — the constraint is `not valid`, so rows
predating it may carry anything.

- [ ] **Step 4: Route assignment wording through `describeActivity`**

Task 13 added `describeActivity`, which reads `meta.removed` rather than the type so historical
removals logged as `assigned` still render correctly. `ACTIVITY_LABELS` must delegate to it for both
`assigned` and `unassigned`.

- [ ] **Step 5: Run the test to verify it passes, then commit**

Run: `npx vitest run && npm run typecheck && npm run lint`

Fixture-render one row of every allowed type plus one unknown historical type. Confirm the unknown
row degrades to readable text rather than crashing.

```bash
git add "src/app/(authed)/tasks/_components/activity-labels.ts" \
  "src/app/(authed)/tasks/_components/ActivityFeed.tsx" \
  src/lib/tasks/activity-events.test.ts changelog.md
git commit -m "fix(activity): align feed rendering with the allowed vocabulary"
```

---

## Task 23: Thread navigation, counters, and mutation feedback (F22, F23)

Three separate annoyances with one root cause — behaviour written for the happy path only.

`useEffect(... el.scrollTop = el.scrollHeight, [rowSignature, highlightCommentId])` fires whenever
**any** row id changes, so a realtime comment yanks a reader away from what they were reading.
`count={detail?.comments.length ?? 0}` includes deleted placeholder rows while `task_list_metadata`
excludes them, so the drawer tab and the list disagree. And `edit()`/`remove()` collapse transport
failure, validation failure, and success into a bare boolean, so a failed edit leaves the form open
with no explanation and a failed delete does nothing at all.

**Files:**
- Create: `src/lib/tasks/thread-view.ts` + `.test.ts`
- Modify: `src/app/(authed)/tasks/_components/CommentThread.tsx`
- Modify: `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx:487`
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` (comment count only)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/thread-view.test.ts
import { describe, expect, it } from "vitest";
import { shouldFollowNewRows, activeCommentCount, isNearBottom } from "@/lib/tasks/thread-view";

describe("thread follow behaviour", () => {
  it("follows when the reader is already at the bottom", () => {
    expect(shouldFollowNewRows({ nearBottom: true, ownSend: false, deepLink: false })).toBe(true);
  });

  it("follows the reader's own successful send even when scrolled up", () => {
    expect(shouldFollowNewRows({ nearBottom: false, ownSend: true, deepLink: false })).toBe(true);
  });

  it("does not yank a reader who is reading older messages", () => {
    expect(shouldFollowNewRows({ nearBottom: false, ownSend: false, deepLink: false })).toBe(false);
  });

  it("never overrides a deep link", () => {
    expect(shouldFollowNewRows({ nearBottom: true, ownSend: true, deepLink: true })).toBe(false);
  });
});

describe("activeCommentCount", () => {
  it("counts replies and excludes deleted rows, matching task_list_metadata", () => {
    expect(activeCommentCount([
      { id: "a", parent_id: null, deleted_at: null },
      { id: "b", parent_id: "a", deleted_at: null },
      { id: "c", parent_id: null, deleted_at: "2026-08-09T00:00:00Z" },
    ])).toBe(2);
  });
});

describe("isNearBottom", () => {
  it("treats a small remaining scroll distance as near the bottom", () => {
    expect(isNearBottom({ scrollTop: 900, clientHeight: 100, scrollHeight: 1010 })).toBe(true);
    expect(isNearBottom({ scrollTop: 0, clientHeight: 100, scrollHeight: 1010 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then implement**

Run: `npx vitest run src/lib/tasks/thread-view.test.ts` → FAIL.

```ts
// src/lib/tasks/thread-view.ts
const NEAR_BOTTOM_PX = 120;

export function isNearBottom(m: {
  scrollTop: number; clientHeight: number; scrollHeight: number;
}): boolean {
  return m.scrollHeight - (m.scrollTop + m.clientHeight) <= NEAR_BOTTOM_PX;
}

/**
 * The old rule was "any new row id → jump to bottom", which pulled readers away
 * from what they were reading whenever a colleague commented. Follow only when
 * the reader is already at the bottom or just sent something themselves; a deep
 * link always wins and must not then be overridden.
 */
export function shouldFollowNewRows(s: {
  nearBottom: boolean; ownSend: boolean; deepLink: boolean;
}): boolean {
  if (s.deepLink) return false;
  return s.nearBottom || s.ownSend;
}

/**
 * The one canonical count: replies included, deleted rows excluded. Must match
 * task_list_metadata's `where deleted_at is null`, or the drawer tab and the
 * list row disagree about the same task.
 */
export function activeCommentCount(
  comments: readonly { deleted_at: string | null }[]
): number {
  return comments.filter((comment) => comment.deleted_at === null).length;
}
```

- [ ] **Step 3: Replace the scroll effect and the counters**

Track `nearBottom` in a ref updated on scroll, and the id of the last locally submitted comment.
Drive the effect through `shouldFollowNewRows`. When it returns false and new remote rows arrived,
show a small `New comments (n)` button that scrolls down and clears the count.

Replace `detail?.comments.length ?? 0` with `activeCommentCount(detail?.comments ?? [])` in
`TaskDetailDrawer` **and** in `EnrollmentClient`'s equivalent tab.

- [ ] **Step 4: One shared clock for relative timestamps**

Relative labels currently only refresh when something else re-renders. Add one 60 s interval per open
thread — **not one per comment** — that bumps a counter the rows depend on. Pause it while
`document.hidden`. Keep the exact local datetime in each row's `title`.

- [ ] **Step 5: Typed mutation outcomes and a delete confirmation**

Change `edit()`, `remove()`, and the edit-history fetch to return discriminated results (Task 10
already did this for `edit()`). Render the message adjacent to the affected comment with
`role="status"` for pending/warning and `role="alert"` for errors — **never a global toast as the
only location**, and never an API path or internal error string.

History load failure must render "Could not load edit history — Retry", **not** "No previous
versions"; conflating a failure with an empty result is how support loses an hour.

Add a focused confirmation dialog before `remove()`: it states that replies remain visible and that
linked files will be removed, restores focus on close, and does not change author-only authorization.

- [ ] **Step 6: Verify**

Run: `npx vitest run && npm run typecheck`

Browser: receive a remote comment while scrolled to the top → **no jump**, `New comments` appears.
Send your own while scrolled up → follows. Open a deep link → highlights the target and stays.
Delete a comment with replies → count drops by one, replies remain. Compare the drawer tab count with
the list row count. Go offline and edit → inline error, draft preserved, Retry works. Leave a thread
open for two minutes → "just now" becomes "2 minutes ago" without interaction.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tasks/thread-view.ts src/lib/tasks/thread-view.test.ts \
  "src/app/(authed)/tasks/_components/CommentThread.tsx" \
  "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx" \
  "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx" changelog.md
git commit -m "fix(comments): fix thread navigation, counters and mutation feedback"
```

---

## Task 24: Resilient, accessible attachment presentation (F24)

**Files:**
- Modify: `src/app/(authed)/tasks/_components/CommentThread.tsx:507-558, 575-609, 689-830, 1180-1315`

- [ ] **Step 1: Make text safe to render**

Comment bodies need `overflow-wrap: anywhere` (a long URL or token currently overflows the drawer),
preserved newlines, and readable line height. Reply indentation becomes responsive so a 320 px drawer
keeps a usable composer and text column — the rail stays, its width shrinks.

- [ ] **Step 2: Render real file rows**

Each attachment shows a type icon, a safely truncated name with the full name in `title`, a formatted
size via the existing `formatAttachmentSize`, and its operation state from Task 8
(pending / uploading / success / failed) or Task 4 (`unavailable`). Failed rows get Retry; unavailable
rows explain that the file is no longer available **without exposing a storage path**.

- [ ] **Step 3: Add chooser guidance**

Set `accept` on the file input from `ATTACHMENT_ALLOWED_MIME_TYPES` (already exported from
`attachments.ts`). Add client-side feedback for duplicate, unsupported, and limit violations using
Task 20's `checkOperationLimits`. **Server validation stays authoritative** — `accept` is a hint the
user can bypass.

- [ ] **Step 4: Build a real preview dialog**

The current image preview closes only by clicking. Replace it with a complete dialog: labelled title,
initial focus on close, Tab containment, Escape to close, backdrop click to close, focus restoration
to the trigger, scroll lock, an explicit loading state, an error state when the image fails or its URL
expired, and Open / Download actions for the original. Provide the equivalent Open action for
non-images.

Constrain dimensions without cropping — preserve aspect ratio, fit the viewport.

**Do not add** an image-processing library, a modal library, public URLs, or a changed signed-link
lifetime. If a shared accessible dialog primitive already exists in the repo, use it rather than
creating a competing modal system.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint && npx vitest run`

Browser matrix at 320 / 375 / 768 / desktop: long URL, long Unicode token, long filename, a reply
with files, ten file chips, portrait and landscape images. Supported, unsupported, duplicate, and
oversize selections. Slow, expired, and broken signed URLs. Keyboard-only preview: open, Tab cycle
stays inside, Escape closes, focus returns to the trigger. Screen-reader labels on every control.
Repeat on ACA and Medicare.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(authed)/tasks/_components/CommentThread.tsx" changelog.md
git commit -m "fix(comments): harden attachment presentation and preview"
```

---

## Task 25: Final reconciliation and go-live record

- [ ] Re-run `npx tsx scripts/audit-task-collaboration.ts` and diff against Task 1's baseline.
- [ ] Confirm `last_activity_actor_mismatch` is **0** (11 at audit time).
- [ ] Confirm `overdue_gaps` is **0** (11 activity gaps, 8 event gaps at audit time).
- [ ] Confirm `comment_activity_gaps` is **0** and `unsignable_attachments` is **0**.
- [ ] Report `duplicate_comment_candidates` for owner review. **Never auto-delete** — identical text
      is a legitimate user action, and only the request id can distinguish intent.
- [ ] Run `npx vitest run && npm run typecheck && npm run lint && npm run build`.
- [ ] Walk the full manual matrix in §9 on Health CS, ACA, **and** Medicare.
- [ ] Run a text scan proving no comment card, deleted placeholder, edit form, edit history, `title`,
      or accessibility label renders a raw email.
- [ ] Record accepted residual P3 risks — especially the F17 malware decision — with a named owner.
- [ ] Record the final go-live status in the Execution Log.

```bash
git add docs/superpowers/plans/2026-08-09-task-collaboration-final-plan.md changelog.md
git commit -m "docs(tasks): record collaboration hardening verification"
```

---

## 8. Regression boundaries

Do not change these without a separately approved product decision:

- Any authorized task viewer may comment; field-edit permission stays separate.
- Comment edit and delete remain author-only.
- Replies remain one level deep.
- A deleted parent placeholder and its surviving replies remain visible; deletion never cascades.
- The task bucket stays private; links stay short-lived signed URLs.
- Per-file maximum stays 15 MiB.
- Mention tokens stay `@[Label](email)` in stored bodies.
- Comment and edit-history surfaces display canonical names; email stays an internal identity key and
  may be a hidden search keyword, never visible read/edit/history text.
- Account renames update historical display labels; no immutable name snapshot is introduced.
- `CommentThread` stays compatible with both Task and Enrollment response shapes.
- Activity access stays manager/agent-owner scoped — this plan hardens data, not role policy.
- Realtime stays a content-free hint; canonical state is always reloaded over authenticated HTTP.
- No schema change is destructive: every new column is nullable, every new index is partial.

---

## 9. Verification

### 9.1 Commands

Run after each task, then all together at Task 25:

```bash
npx vitest run
npm run typecheck
npm run lint
npm run build
npx tsx scripts/audit-task-collaboration.ts
```

### 9.2 Manual browser matrix

Run every case on **Health CS, ACA, and Medicare** — `CommentThread` is shared.

1. Send by click, by Enter, by rapid Enter, and by double-click → one comment each.
2. Deliberately send the same text twice after the first succeeds → two comments.
3. Slow comment POST: close and reopen the drawer, navigate to another task.
4. Comment-only, file-only, comment + one file, comment + ten files.
5. First / middle / last file fails; retry only the failed file.
6. File upload commits but notification, realtime, or reload fails → 2xx with warning.
7. Edit the same comment in two tabs → the stale tab gets 409 **and keeps its draft**.
8. Add a mention during create and during **edit**; the recipient opens the notification immediately.
9. Delete a parent with replies; delete a comment with files.
10. Storage cleanup fails after the metadata delete → drawer, list, and search stay canonical.
11. One metadata row points at a deliberately missing object → **the drawer still opens.**
12. Signed URL expires while the app stays open → reopening refreshes without a broken link.
13. Manager, plain CS, assignee, participant, agent owner, agent assistant, unauthorized account.
14. Human comment followed by the overdue cron → last-activity time and actor stay paired.
15. Add and remove one of several assignees → activity wording is correct.
16. Active, inactive, renamed, nameless, and missing author/editor accounts → **no visible email**
    anywhere, including `title` and the accessibility tree.
17. Tag by mouse and keyboard in create, reply, **and** edit; Vietnamese accented and unaccented and
    `đ`; two people with the same display name; zero-result menu; an existing inactive mention.
18. Screen reader announces the picker's active option, send/upload/edit/delete status, empty and
    error states, and dialog labels — with no duplicate Escape handling.
19. Remote comment while at the bottom vs. while reading older messages; `New comments` control; own
    send; deep-link highlight; active count after a deletion.
20. 320 / 375 / 768 / desktop widths with a long URL, a long Unicode token, a long filename, a reply,
    ten file chips, and the mention picker near every viewport edge.
21. Image preview by mouse and keyboard: loading, failure, expired URL, Tab containment, Escape,
    backdrop close, open/download, focus restoration.
22. Two concurrent cron invocations; a status change racing the cron.

---

## 10. Explicit optimization decisions

**Do now:**

- eliminate duplicate requests rather than merely debouncing them;
- bounded two-file upload concurrency, but only after independent per-file retry state exists;
- never sign or read detail before authorization;
- isolate signed-URL failure per file;
- short explicit cache TTL plus mutation invalidation;
- denormalize the last-activity actor so the list stops re-deriving it;
- one batched historical display-name lookup per response, never N+1;
- one shared low-frequency thread clock, not one timer per comment.

**Deliberately defer** (with the measured reason):

- comment virtualization or cursor pagination — current maximum is 5 comments per task;
- activity pagination UI — current maximum is 14 rows against a 200 cap; add truthful "latest 200"
  messaging only if the cap is reached;
- server-side file search changes — current volume is one attachment;
- lazy sign-on-click — resilience plus cache expiry fixes the risk with less UI churn;
- a malware-scanning vendor — needs security/product ownership, cost, quarantine, and support;
- rich-text editor, reactions, nested replies, presence indicators, drag-drop/paste uploads — none is
  required to fix a confirmed go-live issue.

**Threshold to revisit:** introduce cursor pagination once measured records exceed 100 comments on
one task, or once the 200-row activity cap is actually reached.

---

## 11. Acceptance criteria

- A committed comment, edit, delete, or upload is never returned as a failed request; best-effort
  failures arrive as `warnings` beside a 2xx.
- Replaying any submission's request id returns the original row and writes no second activity row —
  on Health CS **and** on ACA/Medicare.
- `tasks.updated_at` is strictly monotonic regardless of which writer touches it.
- One unsignable attachment never prevents a task drawer from opening.
- Deleting an attachment may leave an orphan object, but never visible metadata pointing at nothing.
- Last-activity time and actor always describe the same event; system rows never become the actor.
- Comment, deleted placeholder, edit form, and edit history render canonical names — never an email,
  never a name guessed from an email local part.
- A visible mention chip always has a real selected account behind it, in create, reply, **and** edit.
- Keyboard and screen-reader semantics satisfy §3.5.
- Every task has its own commit and its own `changelog.md` entry.

---

## 12. Execution Log

| Task | Phase | Sev | Status | Commit | Verification | Notes |
|---|---|---|---|---|---|---|
| 1. Audit script | A | — | Implemented | `TBD` | `npm run typecheck` passed | Script and restricted audit RPCs added; baseline execution pending because local Postgres is unavailable and `tsx` is not installed. |
| 2. Version monotonicity | A | P1 | Implemented | `TBD` | Targeted test + typecheck passed | Trigger and committed-token return added; SQL trigger execution remains pending until Postgres is available. |
| 3. Typed contracts | A | — | Implemented | `TBD` | Targeted tests + typecheck passed | Vocabulary matches the current SQL constraint, including the existing `agent_changed` event; unknown historical values remain tolerated. |
| 4. Signing isolation | B | **P1** | Implemented | `TBD` | Detail test + typecheck passed | Added per-file signing fallback and unavailable UI; browser/storage corruption check still pending. |
| 5. Delete ordering | B | **P1** | Implemented | `fb7fd68` | Typecheck passed | Metadata/audit commit now precedes best-effort storage cleanup; DB/storage fault injection pending. |
| 6. Atomic comment create | B | **P1** | Implemented | `f48e1e1` | Typecheck + targeted tests passed | Comment/idempotency/participant writes are atomic; notification and realtime are warning-only after commit. Added the task actor column early so Task 12 can complete without a schema dependency. Live RPC/concurrency fault injection pending. |
| 7. Submission guard | C | P2 | Implemented | `9dcf7a1` | Submission unit tests + typecheck passed | Shared ref-based in-flight guard and request token wired into Tasks, ACA, and Medicare; Enrollment has an atomic replay command. Browser double-click and live DB replay pending. |
| 8. Comment/file state split | C | P2 | Implemented | `19f9f44` | Submission tests + typecheck passed | Durable comment, per-file upload, reload warning, retry state, and blob URL cleanup are separated in the shared Tasks/Enrollment composer. Full browser fault injection pending. |
| 9. Attachment idempotency | C | P2 | Implemented | `923075b` | Attachment validation tests + typecheck passed | Multipart auth gate, sign-before-commit, atomic metadata/audit, idempotency replay, compensation, and warning-only side effects implemented. Live storage/DB fault injection pending. |
| 10. Atomic comment edit | C | P2 | Implemented | `TBD` | Typecheck + targeted tests passed | Task and Enrollment edits now use locked compare-and-swap RPCs with atomic history/activity; UI keeps drafts and surfaces 409s. Two-tab/browser conflict test pending. |
| 11. Deletion retention | C | P2 | Pending | — | — | F8. Needs the §3.4 decision |
| 12. Last-activity pair | C | P2 | Pending | — | — | F10. **Land before Task 6** |
| 13. Unassigned activity | C | P2 | Pending | — | — | F11 |
| 14. Atomic task create | C | P2 | Pending | — | — | F12 |
| 15. Atomic overdue | C | P2 | Pending | — | — | F13 |
| 16. Canonical names | C | P2 | Pending | — | — | F19 |
| 17. Unified mentions | C | P2 | Pending | — | — | F20 + F21. Needs Task 10 |
| 18. Authorize first | D | P3 | Pending | — | — | F15 |
| 19. Cache TTL | D | P3 | Pending | — | — | F16 |
| 20. Operation limits | D | P3 | Pending | — | — | F17. Needs malware risk sign-off |
| 21. DB invariants | D | P3 | Pending | — | — | F18 |
| 22. Activity vocabulary | D | P3 | Pending | — | — | F14 |
| 23. Navigation + feedback | D | P3 | Pending | — | — | F22 + F23 |
| 24. Attachment UI | D | P3 | Pending | — | — | F24 |
| 25. Final reconciliation | — | — | Pending | — | — | Go-live decision recorded here |
