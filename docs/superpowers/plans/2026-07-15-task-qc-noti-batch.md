# Task Board — QC / Notifications / Filters batch (7 items)

Implementation roadmap. Claude implements + verifies (`npm run typecheck && lint && test:run && build`) + commits each item. No push. `insertNotifications` **throws** on a bad type, so every new notification type must be added to the `task_notifications_type_check` constraint in `schema.sql` (and the DB re-run).

## Current-state findings (verified in code)
- **#5 QC-on-done already exists** — `[id]/route.ts:376-433` emits `qc_needed` to the agent owner + assistants when a task transitions into `done`. `NotificationBell` renders it. → Verify only; if it doesn't fire live, the DB likely predates the expanded `task_notifications_type_check`.
- **#1 overdue filter** — the `overdue` `QuickFilter` + `matchesQuick` logic exist; only a toolbar toggle is missing (PRESETS has just `mine`, managerOnly).
- **#2 reason-overdue** — `overdue-unlock` route only logs an `overdue_unlocked` **activity** (reason in `meta`); it sends **no notification**.
- **#4 (edited)** — comments already store `updated_at`; no edit is logged and no history table exists.
- notifications table has **no meta/reason column** — a notification is `{recipient, task_id, type, actor, comment_id}` only. Reason text lives in the activity log; a noti just alerts + deep-links.

---

## Item 1 — Overdue filter (all 3 roles)  · SMALL
**Approach:** expose the existing `overdue` quick filter as a toolbar toggle for everyone.
- `TaskToolbar.tsx` `PRESETS`: add `{ key: "overdue", label: "Overdue" }` (NOT `managerOnly`).
- Confirm `overdueIds` already flows into `filterTasks` (it does, via `matchesQuick`). No role gate.
**Files:** `TaskToolbar.tsx`.

## Item 3 — "Created by" (reporter) in the task modal  · SMALL
**Approach:** show `task.reporter_email` as a name in the drawer sidebar.
- `TaskDetailDrawer.tsx`: add a `Created by` row (next to Agent/Assignees, ~line 327) rendering `personLabel(task.reporter_email, ...)`. Reuse `personLabelByEmail` (already built).
**Files:** `TaskDetailDrawer.tsx`.

## Item 4 — Comment edit: "(edited)" marker + logged history  · MED
**Approach (two parts):**
- **4a marker (small):** a non-deleted comment with `updated_at > created_at` shows a muted `(edited)` next to the timestamp in `CommentThread`.
- **4b history (med):** on each comment PATCH, snapshot the previous body.
  - Schema: new `task_comment_edits (id, comment_id fk, previous_body, edited_by, edited_at)`.
  - `[id]/comments/[cid]/route.ts` PATCH: before updating, insert the OLD body into `task_comment_edits`.
  - UI: `(edited)` is a button → small popover/list of previous versions (fetched from a new `GET /api/tasks/[id]/comments/[cid]/edits`). Decision: per-comment popover (not a 4th drawer tab) — keeps it in context.
**Files:** `schema.sql`, `comments/[cid]/route.ts`, new `comments/[cid]/edits/route.ts`, `CommentThread.tsx`.

## Item 5 — QC noti when CS marks Done  · VERIFY ONLY
Already implemented. Verify `qc_needed` is in `task_notifications_type_check` and fires. If broken live → re-run `schema.sql`.

## Item 6 — Cancel also needs QC  · MED
**Approach:** treat `cancel` like `done` for QC.
- `transitions.ts`: the QC guard `if (nextStatus !== "done")` → allow `done` **or** `cancel`.
- `[id]/route.ts`: `shouldNotifyQcNeeded = enters done OR enters cancel`.
- UI: show the `DoneReviewPanel` (QC review) for `cancel` too (drawer + row/board QC affordances gate on `status === "done"` → add `cancel`).
- Reuse the `done_reviewed_by_email` / `done_reviewed_at` columns for both.
**Files:** `transitions.ts` (+ test), `[id]/route.ts`, `TaskDetailDrawer.tsx`, `TaskRowItem.tsx`/`TaskListView.tsx`, `KanbanBoard.tsx`.

## Item 2 — Reason-overdue notification to admin + agent  · MED
**Approach:** when an overdue is resolved (overdue-unlock, which requires a reason), notify the task's agent owner/assistant **and** all admins.
- New helper `fetchAdminEmails()` in membership (or rbac) — `portal_account where role='admin' and is_active` (pattern exists in `role-management.ts:284`).
- `overdue-unlock/route.ts`: after the update, `insertNotifications` type `overdue_unlocked` to `[...fetchAgentOwnerAndAssistantEmails(agent_email), ...fetchAdminEmails()]` minus the actor. Reason stays in the activity `meta` (deep-link shows it).
- Add `overdue_unlocked` to the notifications type-check if not already there; `NotificationBell` label for it.
**Files:** `membership.ts` (or new `admins.ts`), `overdue-unlock/route.ts`, `schema.sql` (type check), `NotificationBell.tsx`.

## Item 7 — Notify when a task awaits QC too long (SLA-configurable)  · MED-LARGE
**Approach:** a done/cancel task that isn't QC-reviewed after `qcHours` gets a reminder to the QC owners.
- Settings: add `qcHours` to `ReminderSettings` (`reminder-settings.ts`, default 24) + `qc_hours` column on `task_reminder_settings` + input in `SlaRulesModal`.
- Schema: `tasks.qc_reminded_at timestamptz` to throttle (once per `qcHours`, like the other reminders).
- Cron `check-overdue/route.ts`: select tasks `status in (done,cancel)` AND `done_reviewed_by_email is null` AND `closed_at <= now - qcHours` AND `intervalDue(qc_reminded_at, …)` → notify `fetchAgentOwnerAndAssistantEmails(agent_email)`, stamp `qc_reminded_at`. New noti type `qc_stale` (add to check + bell).
**Files:** `reminder-settings.ts`, `schema.sql`, `SlaRulesModal.tsx`, `admin/task-reminder-settings/route.ts`, `check-overdue/route.ts`, `NotificationBell.tsx`.

---

## Order of execution (batches)
1. **Batch 1 (small, independent):** #1, #3, #4a marker. Commit.
2. **Batch 2:** #6 cancel-needs-QC. Commit.
3. **Batch 3:** #2 reason-overdue noti (+ admin helper). Commit.
4. **Batch 4:** #7 QC-stale (setting + schema + cron + UI). Commit.
5. **Batch 5:** #4b comment edit history (table + route + popover). Commit.
6. Verify #5 live (re-run `schema.sql` reminder to user).

## Decisions taken (flag if you disagree)
- **#2 recipients:** agent owner/assistant **+ all admins** (minus the actor). Reason viewable via deep-link, not stored on the noti.
- **#4b history UI:** per-comment popover from the `(edited)` label (not a new drawer tab).
- **#7 threshold:** one global `qcHours` in SLA settings (default 24 h), throttled once per window; notifies the QC owners (agent + assistants), same recipients as `qc_needed`.
- **#6:** cancel reuses the same `done_reviewed_*` columns + QC UI; QC allowed on done **or** cancel.

## Deployment note
Items 4b, 7, and possibly 2 add columns/constraints → **re-run `supabase/schema.sql`** in Supabase after those land.
