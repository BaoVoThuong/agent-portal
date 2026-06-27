# Task Detail: Batched Loading + Tabbed Drawer — Design

Date: 2026-06-27
Branch: new `feat/task-detail-batch` off `main`
Status: Approved (design)

## Problem

Opening a task is slow (~1–2s for comments/activity to appear). The detail drawer
mounts three sections at once — `CommentThread`, `ActivityFeed`, `AttachmentPanel`
— each of which fetches its own endpoint on mount. Every one of those routes
independently re-runs `auth()` + `loadActorAndTask` (a tasks SELECT) + the
view-authorization (for CS: `isTaskParticipant` + `fetchAgentsForCs`) + its data
query, and the comments route also signs attachment URLs. That's three HTTP
requests and many serial Supabase round-trips per open.

## Goal

Open a task in ~one round-trip; show Comments immediately; Activity/Attachments
live behind instant tabs (data prefetched); cache per task so re-opens are instant.

Patterns borrowed: **Jira** (issue detail returns issue + comments + activity in
one payload; tabs switch client-side instantly) and **Slack** (load a
conversation once, keep it cached, update via realtime).

## Part B — Batched read endpoint

`GET /api/tasks/[id]/detail`:
- Authorize **once**: `auth()` → load task (incl. `agent_email`) → view check.
  Reuse the existing participant/agent resolution (manager short-circuits; CS
  resolves `isTaskParticipant` + `fetchAgentsForCs` a single time).
- `Promise.all` of three reads, then return `{ comments, activity, attachments }`:
  - `comments`: same shape the comments GET returns today (each with its
    `attachments[]`, signed URLs in parallel).
  - `activity`: latest activity (cap at 200, newest first).
  - `attachments`: task-level only (`comment_id IS NULL`), signed.
- Extract the read logic into `src/lib/tasks/detail.ts` so it is shared (not
  duplicated) and unit-testable in pieces:
  - `loadComments(supabase, taskId)` → comments with signed per-comment attachments
  - `loadActivity(supabase, taskId)` → activity rows
  - `loadTaskAttachments(supabase, taskId)` → signed task-level attachments
  - `loadTaskDetail(supabase, taskId)` → `Promise.all` wrapper returning the
    `{ comments, activity, attachments }` object.

The existing comments/attachments/activity **GET** routes may delegate to these
helpers too (keeps one source of truth); the **POST/DELETE** routes (create
comment, upload, delete) stay unchanged.

### Types

```ts
type TaskDetail = {
  comments: CommentWithAttachments[];   // existing comment shape + attachments[]
  activity: ActivityRow[];
  attachments: SignedAttachment[];      // task-level
};
```

## Part A — Tabbed drawer + cache

- On open, the drawer fetches `/api/tasks/[id]/detail` **once**, shows a skeleton
  while loading, and stores the `TaskDetail` in state.
- A tab group replaces the always-mounted sections: **Comments** (default) ·
  **Activity** · **Attachments**. Switching tabs is a client-side toggle over
  already-loaded data — instant, no per-click fetch.
- The three children become **controlled** (data via props; no self-fetch):
  - `CommentThread({ comments, members, currentEmail, onReload, taskId })` —
    keeps the composer (POST), delete, and the task-room realtime subscription;
    after a successful post/delete, or on a realtime ping, it calls `onReload()`.
  - `ActivityFeed({ activity, personLabelByEmail })` — pure render.
  - `AttachmentPanel({ attachments, canEdit, taskId, onReload })` — keeps upload
    (POST) + delete; calls `onReload()` after a change.
- `onReload` re-fetches `/detail` for the task and updates drawer state (realtime
  pings are debounced ~300ms).
- **Cache (stale-while-revalidate)**: a module-level `Map<taskId, TaskDetail>`.
  On open, if cached, render immediately, then refetch in the background and
  replace. Invalidate/replace a task's entry whenever `onReload` returns fresh
  data. Keeps re-opening recent tasks instant.

## Out of scope / kept as-is

- POST/DELETE routes for comments and attachments (mutations) unchanged.
- Realtime broadcast (`taskRoomTopic`) unchanged; the drawer's `onReload` is what
  the ping triggers now.
- No change to board/list loading.

## Testing

- Unit (`detail.ts`): a pure mapper that shapes raw rows → `TaskDetail` (group
  comment attachments by `comment_id`, task-level vs comment split) tested without
  network; verify activity cap and the comment-attachment grouping.
- Route: returns 403 for a non-viewer (reuses the view check), 200 with the three
  arrays for a viewer.
- Manual: open a task → exactly **one** `/detail` request in the Network tab;
  switching tabs makes no new request; re-opening a recent task renders instantly
  then refreshes; posting a comment / uploading a file refreshes via `onReload`.

## Risks / decisions

- Batching loads activity/attachments even if the user only reads comments —
  acceptable for typical sizes; activity is capped at 200.
- `onReload` refetches the whole `/detail` (simpler, one code path) rather than
  just comments; it runs after user actions or debounced realtime pings, so the
  extra cost is fine.
- Children become controlled — a focused refactor of the three components; their
  mutation logic (post/upload/delete) is preserved, only the read is lifted.

## Rollout

1. Add `detail.ts` helpers + `/detail` route (additive; nothing uses it yet).
2. Refactor the drawer to fetch `/detail` + tabbed UI + cache; switch the three
   children to controlled props.
3. (Optional follow-up) delete the now-unused individual GET routes once verified.
