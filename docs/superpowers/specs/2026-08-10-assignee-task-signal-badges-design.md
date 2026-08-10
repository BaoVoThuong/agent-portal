# Assignee Task Signal Badges — Design

**Date:** 2026-08-10
**Status:** Awaiting review

## Problem

Tasks assigned to a person get lost in the list. The person they were assigned to does not
notice them and has to go looking.

The list already sorts by an opinionated ranking rather than by creation date
(`rankTasks` for workers, `rankTasksForManager` for managers), so a newly created task does
not appear at the top. That is deliberate — the ranking surfaces *urgent* work — but it means
*new* work has no way to announce itself.

## Goal

Give an assignee a small set of personal signals on their own task list, and pin the tasks
carrying those signals near the top, so "what needs me right now" is answerable at a glance
without opening anything.

## Non-goals

- Read state for people who are not the assignee. Agent owners and assistants are explicitly
  out of scope; they are served by the existing `unassigned` and `stalled` bands.
- A notification system. `task_notifications` already exists and is unchanged by this work.
- Marking a task read without opening it. Deliberately omitted — see Deferred.

---

## 1. Badge set

Exactly three badges. Each maps to one already-recorded event.

| Badge | Condition | Question it answers |
|---|---|---|
| `NEW` | The viewer is an assignee and has **never opened** this task | "Work arrived and I haven't looked at it" |
| `💬 n` | `n` comments were added after the viewer last opened the task, authored by someone else | "Someone is waiting on my reply" |
| `@` | The viewer was mentioned after they last opened the task | "Someone asked for me by name" |

A task with nothing new carries **no badge**. That is the load-bearing property: if most rows
are lit, none of them signal anything.

### Deliberately excluded

`stage_changed`, `field_changed`, `priority_changed`, `attachment_added`, and `overdue`.

The first four fire constantly during normal workflow, and most of them are the viewer's own
doing — badging them would light up every row. `overdue` already has its own pinned band at the
top of the ranking; a badge would state the same fact twice and consume space that a real signal
needs.

Adding a badge later is easy. Removing one is not, because people will have learned to look for it.

### Placement — reuse the existing overdue flag mechanism

The row already has a flag strip beside the title. `TaskRowFlags`
(`src/app/(authed)/tasks/_components/TaskRowItem.tsx:1106`) renders overdue, was-overdue, and
reopened; `RowFlagIcon` (`:1143`) draws each one as a 20 px circular bordered icon with a `title`
tooltip in one of three tones:

```ts
    danger:  "border-[#ffbdad] bg-[#ffebe6] text-[#bf2600]",
    warning: "border-[#f8e6a0] bg-[#fff7d6] text-[#7f5f01]",
    info:    "border-[#b3d4ff] bg-[#deebff] text-[#0055cc]",
```

**The three signal badges become three more flags in that same strip**, using the same component and
the same tones. Nothing new is invented, and the badges sit exactly where users already look for
task state.

| Badge | Icon | Tone | Tooltip |
|---|---|---|---|
| `NEW` | `Sparkles` | `info` | "New: assigned to you and not opened yet." |
| `💬 n` | `MessageSquare` | `info` | "n new comments since you last opened this." |
| `@` | `AtSign` | `warning` | "You were mentioned in a comment." |

`overdue` keeps `danger` to itself, so the most severe tone stays unambiguous.

**One extension is required.** `RowFlagIcon` is icon-only at a fixed `h-5 w-5`, but `💬 n` carries a
count. Add an optional `count?: number` prop that, when present, widens the pill to `h-5 min-w-5
px-1.5` and renders the number after the icon. Overdue and reopened pass no count and are visually
unchanged.

`TaskRowFlags` currently takes `{ task, isOverdue }`. It gains a `badges` prop, and the two call
sites (`:344` and `:437`) pass the viewer's badge data down. It keeps its existing behaviour of
returning `null` when there is nothing to show, so an unbadged row is untouched.

**No new column.** The list already carries ~40 optional columns; a dedicated "unread" column would
consume scarce horizontal space and disappear entirely when a user hides it, taking the signal with
it. The flag strip cannot be hidden by column configuration.

---

## 2. Ranking

Badged tasks form a new band directly below `overdue`.

**Worker view** — `rankTuple` in `src/lib/tasks/sorting.ts:200-222` currently returns three bands:

```ts
  if (isTaskOverdue(task, rules, now)) return [0, slaRemainingSeconds(...), 0];
  if (recentlyActive) return [1, -lastActivityMs, 0];
  return [2, ATTENTION_PRIORITY_RANK[task.priority], timestamp(task.created_at)];
```

Band 1 becomes "has a badge", and the existing bands shift down:

```text
0  overdue                (unchanged)
1  has any badge          (new)
2  recently active        (was 1)
3  rest                   (was 2)
```

**Manager view** — `managerRankTuple` gains the same band directly after `overdue`. In practice it
rarely fires there: badges are assignee-scoped and a manager is usually not the assignee. It is
inserted for consistency, so a manager who *is* assigned sees the same behaviour as everyone else.

### Ordering within the badge band

By urgency of the signal, then by how long it has waited:

```text
@ mentioned        →  💬 new comments  →  NEW never opened
```

Ties break on **oldest unread first** — a task ignored for three days must outrank one commented on
five minutes ago.

### Why this band drains

Badges apply only to the viewer's own assigned tasks, and opening the task clears them. The band is
therefore self-limiting: it holds only work that is genuinely waiting on that person, and shrinks
as they work through it.

This is the difference from an earlier version of this design, where every viewer saw a badge on
every task they *could* see. Under company-wide CS visibility that meant one new task became unread
for ~50 people, 49 of whom would never open it, and the band would have grown without bound until it
displaced the bands below it. Scoping to assignee is what makes the pin safe.

---

## 3. Data model

One new table.

```sql
create table if not exists task_views (
  task_id  uuid not null references tasks(id) on delete cascade,
  email    text not null,
  seen_at  timestamptz not null default now(),
  primary key (task_id, email)
);

create index if not exists task_views_email_idx on task_views (email);
```

- One row per (task, viewer). Written when the viewer **opens the detail drawer**.
- `seen_at` is overwritten on each open, so it always holds the most recent view.
- Absence of a row is what `NEW` tests for.
- `on delete cascade` keeps it tidy when a task is hard-deleted; archiving is a soft delete and
  leaves rows in place, which is correct — an unarchived task keeps its read state.

### Growth

Bounded by (tasks × their assignees), not (tasks × all staff), because only assignees are tracked.
At current volume — 431 tasks, typically one to two assignees each — this is under a thousand rows.

### Why "opened the drawer" and not "appeared in the list"

If rendering a row counted as seeing it, every badge would clear on the first page load and the
feature would do nothing. The write happens in the drawer's existing detail fetch.

---

## 4. Computing badges

Badges are **per viewer**, so this data cannot be shared or cached across users. One RPC per list
load, keyed by the viewer's email:

```sql
create or replace function task_signal_badges(p_email text, p_task_ids uuid[])
returns table (
  task_id       uuid,
  never_opened  boolean,
  new_comments  integer,
  mentioned     boolean
)
```

For each task the viewer is assigned to:

- `never_opened` — no `task_views` row for `(task_id, p_email)`
- `new_comments` — count of `task_comments` where `created_at > seen_at`, `author_email <> p_email`,
  and `deleted_at is null`
- `mentioned` — a `task_notifications` row of type `mentioned` for this recipient created after
  `seen_at`

One round trip, no N+1. Returns only rows with at least one signal, so the payload stays small.

### Your own actions never light your own badges

Every condition excludes the viewer: comments filter on `author_email <> p_email`, and mentions are
already recipient-scoped. Without this, commenting on a task would push it to the top of your own
list — visibly wrong on day one.

The task-level equivalent, `tasks.last_activity_by_email`, exists as of the 2026-08-09 work (audit
finding F10) if a coarser check is ever needed.

---

## 5. Edge cases

| Case | Behaviour |
|---|---|
| Task unassigned from the viewer | Badges disappear immediately. Not their task, not their signal. `task_views` row is left alone so read state survives a reassignment. |
| Task reassigned **to** the viewer, who had opened it before | No `NEW` — a `task_views` row exists. See Deferred. |
| Task archived | Already excluded from the list; badges are irrelevant. |
| Task closed / done | Badges still **render** (a comment on a closed task is still worth seeing) but do **not** pin — the badge band applies to open statuses only. Otherwise a closed task with one late comment would outrank live work. |
| Multiple assignees | Each has independent read state. Two people see different badges on the same row. |
| Comment added then deleted before the viewer looks | Not counted — the count filters `deleted_at is null`. |
| Viewer opens the drawer, closes it, comes back | Badges stay clear; `seen_at` was updated on open. |
| Task with all three signals | All three chips render; ranks by the highest (`@`). |

---

## 6. Testing

**Pure logic** (`src/lib/tasks/sorting.ts`, node environment — the repo has no DOM harness, so
anything to be tested must live in a `.ts` helper):

- Badged task outranks a recently-active task and is outranked by an overdue one.
- Within the band: `@` before `💬` before `NEW`; ties break oldest-first.
- A closed task with a badge does not enter the band.

**SQL assertions** (`supabase/rollouts/`, following the existing
`2026-08-09-enrollment-stage-time-test.sql` convention — `begin; do $$ ... $$; rollback;`):

- `never_opened` true with no view row, false after one.
- `new_comments` excludes the viewer's own comments and deleted comments.
- Re-opening updates `seen_at` and drops the count to zero.
- A non-assignee gets no rows back.

---

## 7. Deferred

**Reassignment does not re-trigger `NEW`.** If a task is moved to someone who had opened it in a
previous life, they get no signal. A fourth badge (`→ you`, fired by an `assigned` activity newer
than `seen_at`) would close this. Left out of the first round to keep the set at three; worth
revisiting once the feature has been used.

**Mark as read without opening.** A task with `💬` that the viewer chooses not to act on stays
pinned. That is arguably correct — it *is* waiting on them — but it can be annoying. A dismiss
action is deliberately omitted from the first round: given the button, people will clear badges to
tidy the list rather than to reflect having dealt with the work, and the signal loses its meaning.
Revisit only if real usage shows the pin is genuinely stuck.

**Agent owner / assistant badges.** Out of scope by decision. Extending later is a filter change,
not a schema change — the design does not need to anticipate it.
