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
| `NEW` | An unread `assigned` notification exists for the viewer on this task | "Work arrived and I haven't looked at it" |
| `💬 n` | `n` unread `commented` notifications for the viewer on this task | "Someone is waiting on my reply" |
| `@` | An unread `mentioned` notification exists for the viewer on this task | "Someone asked for me by name" |

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

`NEW` already renders here as `NewAssignedBadge` (`board-ui.tsx:95`) — a blue text pill, not a
`RowFlagIcon`. **Keep it exactly as it is.** The two new badges join the same strip as
`RowFlagIcon` flags:

| Badge | Component | Icon | Tone | Tooltip |
|---|---|---|---|---|
| `NEW` | `NewAssignedBadge` (unchanged) | — | — | — |
| `💬 n` | `RowFlagIcon` | `MessageSquare` | `info` | "n new comments since you last opened this." |
| `@` | `RowFlagIcon` | `AtSign` | `warning` | "You were mentioned in a comment." |

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
@ mentioned        →  💬 new comments  →  NEW unopened since assignment
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

## 3. Data model — none required

**No new table.** The first draft of this spec proposed `task_views` and a `task_signal_badges` RPC.
Both were unnecessary: exploring the code before planning showed the mechanism already exists.

`task_notifications` already stores per-recipient read state and already carries exactly the three
event types this feature needs, out of a vocabulary of nineteen:

```text
'assigned'   -> NEW
'commented'  -> 💬
'mentioned'  -> @
```

The read/unread lifecycle is already wired end to end:

| Piece | Location | Today |
|---|---|---|
| Badge component | `board-ui.tsx:95` `NewAssignedBadge` | Rendered, styled |
| Load unread ids | `GET /api/tasks/notifications` | Returns `unreadAssignedTaskIds` |
| Render in list + board | `TaskRowItem.tsx:343,436`, `TaskCard.tsx:105` | `isNewAssigned` prop |
| Clear on drawer open | `TaskBoardClient.tsx:379-383` | Calls `markNewAssignedTaskSeen` |
| Persist read | `POST /api/tasks/notifications/read` `{taskId, type}` | Marks that type read |

So `NEW` already works, including the behaviour requested in review: reassignment inserts a fresh
`assigned` notification, which is unread, which lights the badge again. No timestamp comparison and
no `task_assignment_cycles` join is needed — the notification row *is* the signal.

## 4. What actually has to change

Four changes, all extensions of the existing path.

1. **Return unread ids per type, not just `assigned`.** `GET /api/tasks/notifications` currently
   exposes `unreadAssignedTaskIds`. It gains `unreadCommentedTaskIds` (with counts) and
   `unreadMentionedTaskIds`, keeping the existing field so nothing breaks mid-deploy.

2. **Render two more badges.** `TaskRowFlags` gains the comment and mention flags beside the
   existing `NewAssignedBadge`. `💬` carries a count, so `RowFlagIcon` needs an optional
   `count?: number` that widens the pill; overdue and reopened pass none and look unchanged.

3. **Clear all three types on drawer open.** `markNewAssignedTaskSeen` currently posts
   `type: "assigned"` only. It must clear `commented` and `mentioned` for that task too.

4. **Add the ranking band** described in §2.

### Your own actions never light your own badges

Already true and unchanged: `resolveCommentRecipients` excludes the actor when building recipients,
so commenting on a task never creates a notification addressed to yourself.

## 5. Edge cases

| Case | Behaviour |
|---|---|
| Task unassigned from the viewer | The `unassigned` notification type already exists and the task leaves their scope; stale unread rows are harmless because the task no longer appears in their list. |
| Task reassigned **to** the viewer, who had opened it before | `NEW` fires again — reassignment inserts a fresh unread `assigned` notification. Already the behaviour today. |
| Task archived | Already excluded from the list; badges are irrelevant. |
| Task closed / done | Badges still **render** (a comment on a closed task is still worth seeing) but do **not** pin — the badge band applies to open statuses only. Otherwise a closed task with one late comment would outrank live work. |
| Multiple assignees | Each has independent read state. Two people see different badges on the same row. |
| A third assignee is added to a task | The existing two get **no** `NEW` — `resolveCommentRecipients` and the assignee route only notify the newly added email. |
| Assignee removed, then added back later | `NEW` fires again: a second `assigned` notification row is inserted. |
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

**API** (`GET /api/tasks/notifications`):

- Returns unread ids split by type, and `unreadAssignedTaskIds` is still present for compatibility
  during a rolling deploy.
- A viewer with no unread notifications gets empty arrays, not an error.
- Comment counts exclude notifications already marked read.

**Manual**, on the list and the Kanban board:

- Assign a task to yourself in a second browser: `NEW` appears; opening the drawer clears it and it
  stays cleared after a reload.
- Comment as another user: `💬 1` appears, becomes `💬 2` on a second comment, clears on open.
- Mention the viewer: `@` appears alongside `💬`, ranked above a task with comments only.
- Comment on your own task as yourself: **no badge** — you are excluded from your own recipients.
- A closed task with an unread comment shows `💬` but does not jump to the top.

## 7. Deferred

**Mark as read without opening.** A task with `💬` that the viewer chooses not to act on stays
pinned. That is arguably correct — it *is* waiting on them — but it can be annoying. A dismiss
action is deliberately omitted from the first round: given the button, people will clear badges to
tidy the list rather than to reflect having dealt with the work, and the signal loses its meaning.
Revisit only if real usage shows the pin is genuinely stuck.

**Agent owner / assistant badges.** Out of scope by decision. Extending later is a filter change,
not a schema change — the design does not need to anticipate it.
