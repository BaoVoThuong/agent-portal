# Task Board (Customer Service) — Design Spec

- **Date:** 2026-06-23
- **Status:** Approved (brainstorming) — pending implementation plan
- **Scope:** MVP. A Jira-style task board for the agent portal, tailored to a
  customer-service workflow.

## Context — why this is being built

The portal currently has no way to delegate and track operational work. Managers
hand off customer-service tasks (follow-ups, document collection, carrier
chasing, etc.) ad hoc, with no shared visibility into who is doing what or where
work is stuck. This feature adds a single shared task board where **Managers**
create and assign work and **CS staff** execute it, with progress visible on a
Kanban board and a backlog of unassigned work.

The board is scoped by role: Managers see everything; CS users see only the
tasks assigned to them. All permission scoping is enforced **server-side** using
the existing service-role Supabase pattern (the same way dashboards enforce
`scopedAgent`). The LLM/client never decides permissions.

## Goals

- Shared board: **Backlog → To Do → In Progress → Waiting → Done**.
- Two roles via RBAC permission keys: Manager (`task.manage`), CS (`task.work`).
- Create / assign / edit / drag tasks; comment with replies and @mentions;
  in-app notifications; activity log; file attachments.
- Self-managed task categories (not a hardcoded list).

## Non-goals (Phase 2+)

Realtime sync, custom columns, Review/QA column, sprints/epics/subtasks,
reports/burndown, email notifications, comment reactions, swimlanes, SLA
reminders, multiple boards, "blocked as a flag" model.

## Roles & permissions

Two new permission keys, declared in **both** places permissions live:
`src/lib/rbac/permissions.ts` (`PERMISSIONS` + `PERMISSION_DEFINITIONS`, new
group "Tasks") **and** the `insert into permissions ... on conflict` seed in
`supabase/schema.sql`. The seed's `delete from permissions where key not in (...)`
list must be extended with the new keys, or they will be deleted on re-run.

| Key | Label (Role Manager) | Role |
|-----|----------------------|------|
| `task.manage` | Tasks - Manage | Manager |
| `task.work`   | Tasks - Work   | CS |

Admin role auto-receives all permissions (existing cross-join seed), so Admin
can manage tasks too.

### Permission & scope matrix (server-enforced)

Helpers from session: `isManager = can(perms, 'task.manage')`,
`isWorker = can(perms, 'task.work')`. Board access requires either. User identity
key is **email** (`session.user.email`); there is no account id in the session.

| Action | Manager `task.manage` | CS `task.work` |
|--------|----------------------|----------------|
| View | all tasks incl. Backlog | only tasks where `assignee_email = me`; **no Backlog** |
| Create | yes — leave in Backlog or assign immediately | yes — **auto-assigned to self**, never Backlog |
| Edit fields (title/desc/priority/due/category) | any task | own tasks only |
| Assign / reassign | yes | no |
| Change status (drag) | any task | own tasks only |
| Archive | any task | own tasks only |
| Comment / reply | any visible task | own tasks |
| Edit / delete a comment | author only | author only |
| Manage categories | yes | no (select only) |

Assignee picker lists accounts holding `task.work` **or** `task.manage` (a
Manager may self-assign or assign to another Manager).

## Data model (new tables in `supabase/schema.sql`)

Conventions match the existing schema: `uuid primary key default gen_random_uuid()`,
`timestamptz not null default now()`, `create table if not exists`,
`create index if not exists`. RLS enabled on every new table; add all of them to
the `protected_tables` array (app uses service-role which bypasses RLS).

### `tasks`
```
id            uuid pk
title         text not null
description   text
status        text not null default 'backlog'
              check (status in ('backlog','todo','in_progress','waiting','done'))
priority      text not null default 'medium'
              check (priority in ('low','medium','high','urgent'))
category_id   uuid references task_categories(id) on delete set null
assignee_email text                         -- null = unassigned (Backlog)
reporter_email text not null                -- creator
due_date      date
waiting_reason text                         -- check in ('customer','carrier','documents','other')
                                            -- only meaningful when status='waiting'
position      double precision not null default 0   -- ordering within a column
created_at    timestamptz default now()
updated_at    timestamptz default now()
archived_at   timestamptz                   -- soft archive
```
Indexes: `assignee_email`, `(status, position)`, `category_id`, `due_date`.

**Invariant:** `status='backlog'` ⇒ `assignee_email is null`. Assigning a backlog
task sets `assignee_email` and moves `status` to `todo`. CS-created tasks start at
`status='todo'` with `assignee_email = creator`. Cards drag freely both directions
(reopen = drag `done → in_progress`).

### `task_categories`
```
id          uuid pk
name        text not null
color       text
position    int not null default 0
is_active   boolean not null default true   -- soft delete; old tasks keep ref
created_by  text                            -- email
created_at  timestamptz default now()
```

### `task_comments` (one-level replies)
```
id          uuid pk
task_id     uuid not null references tasks(id) on delete cascade
parent_id   uuid references task_comments(id) on delete cascade  -- null = top-level
author_email text not null
body        text not null
created_at  timestamptz default now()
updated_at  timestamptz default now()
deleted_at  timestamptz                     -- soft delete to preserve threads
```
Index: `(task_id, created_at)`. Replies are limited to one level (a reply's
`parent_id` must point to a top-level comment).

### `task_attachments` (Supabase Storage)
```
id           uuid pk
task_id      uuid not null references tasks(id) on delete cascade
comment_id   uuid references task_comments(id) on delete cascade  -- optional
storage_path text not null                  -- tasks/{task_id}/{uuid}-{filename}
file_name    text not null
mime_type    text
size_bytes   bigint
uploaded_by  text                           -- email
created_at   timestamptz default now()
```
Private bucket **`task-attachments`**. Downloads use **signed URLs** generated
server-side via the service-role client; files are never public.

### `task_activity`
```
id          uuid pk
task_id     uuid not null references tasks(id) on delete cascade
actor_email text not null
type        text not null   -- created|assigned|status_changed|priority_changed|
                            -- due_changed|category_changed|comment_added|
                            -- attachment_added|reopened|edited|archived
meta        jsonb           -- e.g. {"from":"todo","to":"in_progress"}
created_at  timestamptz default now()
```
Index: `(task_id, created_at)`.

### `task_notifications` (in-app)
```
id             uuid pk
recipient_email text not null
task_id        uuid not null references tasks(id) on delete cascade
type           text not null   -- assigned|mentioned|commented
actor_email    text not null
comment_id     uuid
is_read        boolean not null default false
created_at     timestamptz default now()
```
Index: `(recipient_email, is_read, created_at)`.

## API surface

Route handlers under `src/app/api/tasks/...`, following the existing pattern:
`auth()` → `can/canAny` → `getSupabaseAdmin()`, `export const dynamic = "force-dynamic"`.
Every mutation re-checks authorization per the matrix above (never trust client).

- `GET /api/tasks` — list tasks, scoped (Manager: all; CS: own). Client groups by status.
- `POST /api/tasks` — create (Manager may set assignee/backlog; CS forced self-assign, non-backlog).
- `GET /api/tasks/[id]` — detail (task + comments + activity + attachments).
- `PATCH /api/tasks/[id]` — update fields / status / assignee; authorizes each change.
- `DELETE /api/tasks/[id]` — soft archive.
- `POST /api/tasks/[id]/comments` — body `{ body, parentId?, mentions: email[] }`.
- `PATCH|DELETE /api/tasks/[id]/comments/[cid]` — author only.
- `POST /api/tasks/[id]/attachments` — multipart upload → Storage + row; returns signed URL.
- `GET /api/tasks/[id]/attachments/[aid]` — returns a fresh signed URL.
- `DELETE /api/tasks/[id]/attachments/[aid]` — uploader or Manager.
- `GET|POST /api/tasks/categories`, `PATCH|DELETE /api/tasks/categories/[id]` — manage = Manager.
- `GET /api/tasks/assignees` — Manager only; accounts with `task.work` or `task.manage` → `[{email,name}]`.
- `GET /api/tasks/notifications`, `POST /api/tasks/notifications/read`.

Listing assignable users: query `user_roles` → `role_permissions` where
`permission_key in ('task.work','task.manage')` → distinct user ids →
`portal_account` (email, name).

## UI (`src/app/(authed)/tasks/`)

- `page.tsx` (server component): `requireAnyPermission([task.manage, task.work])`;
  passes `isManager` and current user email to the client.
- **Tabs:** Board (everyone) + Backlog (Manager only).
- `KanbanBoard` — dnd-kit (`DndContext` + sortable columns) with 4 columns
  To Do / In Progress / Waiting / Done. Drag a card → optimistic move + `PATCH`
  status, then refetch. CS sees only their own cards.
- `BacklogList` (Manager) — unassigned tasks with an **Assign** action (assignee
  picker) that moves the task onto the board.
- `TaskCard` — title, priority color, category chip, assignee initials/avatar,
  due badge (red when overdue), Waiting-reason tag, comment count.
- `TaskDetailDrawer` — slide-over; fields editable per permission; tabs
  **Comments** (one-level replies, @mention picker) / **Activity**; attachments
  list + upload.
- `NewTaskDialog`, `CategoryManager` (Manager).
- **Notification bell** in `TopBar` — unread badge, dropdown, mark-read; polls on
  mount + light interval.
- Add **"Tasks" → `/tasks`** to `Sidebar.tsx` (`menuData`, gated by
  `anyPermission: [task.manage, task.work]`) and register `/tasks` in
  `src/lib/rbac/routes.ts`.
- Styling matches the portal: brand `#0f2849`, Tailwind, lucide-react icons.

## Notifications & @mentions

The comment composer has a mention picker; the client submits `mentions: email[]`.
The server validates each mentioned email is a board user, then creates
notifications. Notifications fire on: **assigned to me**, **@mentioned**, and
**new comment on a task I'm assigned to**. Status changes do **not** notify
(avoids noise).

## Dependencies & infra

- Add `@dnd-kit/core` and `@dnd-kit/sortable`.
- Create the private Supabase Storage bucket `task-attachments`.
- No new env vars (reuses `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`).

## Verification

- `npx tsc --noEmit`, `npx vitest run` — add unit tests for: permission/scope
  helpers, status-transition rules (backlog↔assign invariant), mention parsing.
- Schema: run the updated `supabase/schema.sql` in the Supabase SQL editor
  (idempotent); create the `task-attachments` bucket.
- Manual: create one Manager (`task.manage`) and one CS (`task.work`) via Account
  Manager / Role Manager. Verify CS sees only their own tasks and no Backlog; API
  denies cross-role actions; drag/drop, comment+reply, @mention → notification,
  attachment upload/download all work.

## Open questions

None — all design decisions resolved during brainstorming.
