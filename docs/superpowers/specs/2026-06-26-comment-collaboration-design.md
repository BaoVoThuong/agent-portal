# Comment Collaboration — Design (Project B)

Date: 2026-06-26
Branch: `feat/task-board`
Status: Approved (design)

Covers asks #2 (inline @mention + attach files to a comment, Slack-style) and #3
(let mentioned/added users who are not the assignee actually see the task). These
ship together because a mention is useless if the mentioned person can't open the
task. (Ask #1 — organize-at-scale — is a separate later project.)

## Goals

- Type `@` in a comment → inline autocomplete of team members → insert a mention.
- Attach files/images to a comment; images render as thumbnails inline.
- A mentioned (or added) user who is not the assignee can open the task + thread
  and reply, but cannot edit task fields/status.
- New comments from others appear live in an open thread (no F5).

## Non-goals

- Removing/revoking participants (mentions only add). Manager-driven removal is a
  future addition.
- Editing comments (only create/delete exists today; unchanged).
- Rich text beyond mentions (no bold/markdown rendering).

## 1. Visibility model (#3)

New table `task_participants`:

```
task_participants (
  task_id uuid not null references tasks(id) on delete cascade,
  email   text not null,
  source  text not null default 'mention',   -- 'mention' | 'added'
  created_at timestamptz not null default now(),
  primary key (task_id, email)
)
```

- A `@mention` (server-parsed) upserts a participant row for the mentioned member.
- `fetchTasksForActor(actor)`: a non-manager sees tasks where `assignee_email =
  me` **OR** `id IN (participant task ids for me)`. Managers still see all.
- `canViewTask`: gains participant awareness — manager → true; otherwise true if
  assignee is me **or** I'm a participant.
- Permissions stay: `canMutateTask` is still manager-or-assignee, so a participant
  can **view + comment** but cannot change fields/status. (Comment POST is gated by
  `canViewTask`, mutations by `canMutateTask`.)
- Privacy: mentioning grants visibility into that task's customer data — intended
  (you only @ someone to collaborate). No auto-revoke (YAGNI).

## 2. Inline @mention (#2)

- Replace the crude "Mention" button with **inline autocomplete**: typing `@`
  opens a member dropdown filtered by the text after `@`; arrow keys / enter /
  click selects.
- Storage: mentions live in the body as a markdown-like token **`@[Name](email)`**.
  - Render: parse tokens → highlighted chips (show Name).
  - Server: `parseMentions(body)` extracts emails from tokens; the client-sent
    `mentions[]` is no longer trusted. Emails are validated against board members.
- Mentionable people = board members (`/api/tasks/members`).

## 3. Comment attachments (#2)

- Composer gains a file button + paste/drag image support; selected files are held
  locally and **uploaded on Send** (avoids orphaned uploads).
- Reuse the `task-attachments` bucket and the existing attachment upload route,
  passing `comment_id`.
- Rendering: under each comment, images → thumbnail (signed URL), other files →
  download chip.
- Separation: the task-level `AttachmentPanel` lists only `comment_id IS NULL`;
  comment attachments are fetched with the comment.

## 4. Realtime comments (Slack feel)

- After a comment (or its attachments) is added, the server broadcasts a
  content-free ping to a per-task topic `taskRoomTopic(id) = "task-" + id`.
- An open `CommentThread` subscribes to that topic and refetches on ping, so other
  participants see new comments instantly. Reuses the existing browser Supabase
  client + broadcast REST helper.

## 5. Components & interfaces

- DB: `task_participants` table (RLS on; service-role only) in `schema.sql`.
- `src/lib/tasks/participants.ts`:
  - `fetchParticipantTaskIds(email): Promise<string[]>`
  - `addParticipants(taskId, emails[], source): Promise<void>` (idempotent upsert)
- `src/lib/tasks/mentions.ts`:
  - `parseMentions(body): string[]` — emails from `@[Name](email)` tokens (deduped).
- `src/lib/tasks/access.ts`: `canViewTask(actor, task, isParticipant=false)`.
- `src/lib/tasks/queries.ts`: `fetchTasksForActor` unions assignee + participant.
- `src/lib/tasks/realtime.ts`: `taskRoomTopic(id)` + reuse `sendBroadcast`.
- `comments` route:
  - POST: parse mentions → validate members → `addParticipants` → notify → link
    `attachmentIds` → broadcast task room.
  - GET: attach each comment's attachments (`comment_id = c.id`); gate by
    participant-aware `canViewTask`.
- `attachments` route: accept optional `comment_id`; panel GET filters
  `comment_id IS NULL`.
- `CommentThread.tsx`: inline mention autocomplete, file attach + previews, chip
  rendering, realtime subscription.

## 6. Testing

- Unit:
  - `parseMentions`: extracts/dedups emails from tokens; ignores malformed tokens
    and plain `@text`.
  - `canViewTask`: participant (non-assignee, non-manager) → true; stranger → false.
- Manual:
  - A mentions B (B not assignee) → B gets a toast → opens the task, sees thread +
    image, can reply, **cannot** change status. A sees B's reply live.
  - Task-level AttachmentPanel still shows only its own files (not comment files).

## 7. Risks / decisions

- Mention grants view access by design; no revoke for now.
- Upload-on-Send avoids orphan attachments.
- Server parses mention tokens (don't trust client array) → no privilege via forged
  mention payloads.
- `fetchTasksForActor` for non-managers does two cheap queries (participant ids +
  tasks) and merges.

## 8. Rollout

1. Land code (participant table read paths degrade to "assignee only" if the table
   isn't created yet — additive).
2. Run the `task_participants` SQL in Supabase.
3. Verify mention → visibility → reply-with-image → live update.
