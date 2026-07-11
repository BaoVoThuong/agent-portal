# Task Notifications — Implementation Plan

> **For a human implementer:** this is a hand-coding plan. Each task is a small,
> independently testable slice ending in a commit. Pure logic gets a Vitest test
> first (TDD); wiring/UI is verified with `npm run typecheck && npm run lint && npm run build`.

**Goal:** A complete, timely notification set for the task board — instant notifications on actions, plus cron-driven reminders (overdue, due-soon, waiting-too-long, stale) delivered every ~15 minutes via GitHub Actions, with thresholds configurable in the SLA Times settings.

**Architecture:** Instant notifications are inserted inside the mutation routes that cause them (reuse `insertNotifications`). Time-based reminders are computed by the existing `/api/cron/check-overdue` route, which is triggered every 15 min by a GitHub Actions workflow (not Vercel Hobby's once-daily cron). Reminder thresholds live in a new single-row `task_reminder_settings` table, edited in the SLA Times modal. A new `tasks.last_activity_at` column powers the "stale task" reminder and is reused by the card-ordering plan.

**Tech Stack:** Next.js App Router (v16 — see `agent-portal/AGENTS.md`), Supabase (service-role client, server-only), Vitest, GitHub Actions, TypeScript.

## Global Constraints

- Pure logic (dedup/threshold math) lives in `src/lib/tasks/` and MUST be unit-tested. Routes call it.
- Schema changes go in `supabase/schema.sql` (`add column if not exists` / `create table if not exists`); the user re-runs the file manually. Any new table goes in the `protected_tables` RLS array.
- `getSupabaseAdmin()` is server-only. `CRON_SECRET` already guards the cron endpoint (Bearer header or `?secret=`).
- New UI text in English. Do NOT push to the `vercel` remote. Commit after each task.
- Notification channel stays bell + browser popup + sound (already built); this plan only adds new `type` values and triggers, no new channel.

## Notification catalogue (target state)

Existing `type` values (keep): `assigned`, `mentioned`, `commented`, `overdue`, `overdue_reminder`, `waiting_reminder`.

New `type` values this plan adds:

| type | When | Recipient(s) | Trigger |
|---|---|---|---|
| `unassigned` | You're removed from a task | the removed assignee | instant (assignee routes) |
| `reopened` | A Done/Cancel task is reopened to To Do | current assignee(s) | instant (reopen route) |
| `qc_needed` | A task moves to Done | agent owner / Assistant of the task's agent | instant (PATCH route) |
| `due_soon` | `X` minutes before the SLA budget is exhausted | assignee(s) | cron |
| `stale` | Not Done/Cancel + no activity for `X` hours | assignee(s) | cron |

`overdue` stays assignee-only (per decision). No manager/agent-owner copy for overdue.

## File Structure

- `supabase/schema.sql` — new columns + `task_reminder_settings` table + RLS entry.
- `src/lib/tasks/reminder-settings.ts` (new) — types + defaults + a pure `resolveReminderSettings(row)` parser. Tested.
- `src/lib/tasks/reminders.ts` (new) — pure predicates: `isDueSoon`, `isStale`, `reminderDue`. Tested.
- `src/app/api/admin/task-reminder-settings/route.ts` (new) — GET/PUT, manager-only.
- `src/app/api/cron/check-overdue/route.ts` — extend: read settings, detect due_soon + stale, use configurable intervals, set markers.
- `src/app/api/tasks/[id]/route.ts`, `reopen/route.ts`, `assignees/route.ts`, `assignees/[email]/route.ts`, `comments/route.ts` — instant notifications + bump `last_activity_at`.
- `src/lib/tasks/last-activity.ts` (new) — one `touchLastActivity(supabase, taskId, nowIso)` helper so every action site is one line.
- `src/app/(authed)/tasks/_components/SlaRulesModal.tsx` — add a "Reminders" section.
- Notification label sites (bell dropdown / `ActivityFeed.tsx`) — add human labels for new types.
- `.github/workflows/task-reminders.yml` (new); `vercel.json` — remove the `check-overdue` cron entry.

---

## Task 1: Schema — new columns, settings table, RLS

**Files:** Modify `supabase/schema.sql`.

- [ ] **Step 1:** In the `tasks` column-additions block (near the other `alter table tasks add column if not exists …`), add:

```sql
-- Bumped on every meaningful action (status change, comment, assignment,
-- edit). Powers the "stale task" reminder and the card-ordering "recent
-- activity" tier. Backfilled from updated_at for existing rows.
alter table tasks add column if not exists last_activity_at timestamptz;
update tasks set last_activity_at = coalesce(updated_at, created_at)
where last_activity_at is null;

-- Anti-duplicate markers for the new cron reminders (mirror the existing
-- overdue_reminded_at / waiting_reminded_at). Cleared when the relevant clock
-- restarts so the reminder can re-arm.
alter table tasks add column if not exists due_soon_notified_at timestamptz;
alter table tasks add column if not exists stale_reminded_at timestamptz;
```

- [ ] **Step 2:** Add the single-row settings table (near `task_sla_rules`):

```sql
-- Global reminder thresholds (one row). Managed in the SLA Times modal.
create table if not exists task_reminder_settings (
  id boolean primary key default true check (id),        -- enforces a single row
  due_soon_minutes integer not null default 15 check (due_soon_minutes > 0),
  overdue_reminder_hours integer not null default 24 check (overdue_reminder_hours > 0),
  waiting_hours integer not null default 24 check (waiting_hours > 0),
  stale_hours integer not null default 48 check (stale_hours > 0),
  updated_at timestamptz not null default now()
);
insert into task_reminder_settings (id) values (true) on conflict (id) do nothing;
```

- [ ] **Step 3:** Add `'task_reminder_settings'` to the `protected_tables` array in the RLS `do $$ … $$` block.

- [ ] **Step 4:** Commit.

```bash
git add supabase/schema.sql
git commit -m "schema(tasks): last_activity_at + reminder markers + task_reminder_settings"
```

> After merging, re-run `supabase/schema.sql` in the Supabase SQL editor.

---

## Task 2: Reminder settings type + parser (pure, tested)

**Files:** Create `src/lib/tasks/reminder-settings.ts`, `src/lib/tasks/reminder-settings.test.ts`.

**Interfaces:**
- Produces: `type ReminderSettings = { dueSoonMinutes: number; overdueReminderHours: number; waitingHours: number; staleHours: number }`, `DEFAULT_REMINDER_SETTINGS`, and `resolveReminderSettings(row: unknown): ReminderSettings` (falls back to defaults for missing/invalid fields — the settings row may not exist yet).

- [ ] **Step 1: Failing test** `reminder-settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_REMINDER_SETTINGS, resolveReminderSettings } from "@/lib/tasks/reminder-settings";

describe("resolveReminderSettings", () => {
  it("returns defaults for null/empty", () => {
    expect(resolveReminderSettings(null)).toEqual(DEFAULT_REMINDER_SETTINGS);
  });
  it("maps snake_case DB row to camelCase", () => {
    expect(
      resolveReminderSettings({
        due_soon_minutes: 10,
        overdue_reminder_hours: 12,
        waiting_hours: 6,
        stale_hours: 72,
      })
    ).toEqual({ dueSoonMinutes: 10, overdueReminderHours: 12, waitingHours: 6, staleHours: 72 });
  });
  it("falls back per-field for invalid values", () => {
    const r = resolveReminderSettings({ due_soon_minutes: 0, stale_hours: -1 });
    expect(r.dueSoonMinutes).toBe(DEFAULT_REMINDER_SETTINGS.dueSoonMinutes);
    expect(r.staleHours).toBe(DEFAULT_REMINDER_SETTINGS.staleHours);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/tasks/reminder-settings.test.ts` → FAIL.

- [ ] **Step 3: Implement** `reminder-settings.ts`:

```ts
export type ReminderSettings = {
  dueSoonMinutes: number;
  overdueReminderHours: number;
  waitingHours: number;
  staleHours: number;
};

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  dueSoonMinutes: 15,
  overdueReminderHours: 24,
  waitingHours: 24,
  staleHours: 48,
};

function posInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

export function resolveReminderSettings(row: unknown): ReminderSettings {
  const r = (row ?? {}) as Record<string, unknown>;
  return {
    dueSoonMinutes: posInt(r.due_soon_minutes, DEFAULT_REMINDER_SETTINGS.dueSoonMinutes),
    overdueReminderHours: posInt(r.overdue_reminder_hours, DEFAULT_REMINDER_SETTINGS.overdueReminderHours),
    waitingHours: posInt(r.waiting_hours, DEFAULT_REMINDER_SETTINGS.waitingHours),
    staleHours: posInt(r.stale_hours, DEFAULT_REMINDER_SETTINGS.staleHours),
  };
}
```

- [ ] **Step 4:** Test PASS. **Step 5:** Commit (`feat(tasks): reminder settings type + parser`).

---

## Task 3: Reminder predicates (pure, tested)

**Files:** Create `src/lib/tasks/reminders.ts`, `src/lib/tasks/reminders.test.ts`.

**Interfaces:**
- Consumes: `slaRemainingSeconds`, `isSlaActiveInProgress` from `sla.ts`.
- Produces:
  - `intervalDue(lastIso: string | null | undefined, intervalMs: number, now: Date): boolean` — true if never sent or `≥ intervalMs` since last (replaces the private `reminderDue` in the cron).
  - `isDueSoon(task, rules, dueSoonMinutes, now): boolean` — SLA active, not yet overdue, and `remaining ≤ dueSoonMinutes*60`.
  - `isStale(task: { status; last_activity_at }, staleHours, now): boolean` — status not done/cancel/backlog, and `now - last_activity_at ≥ staleHours*3600e3`.

- [ ] **Step 1: Failing test** `reminders.test.ts` (representative cases):

```ts
import { describe, expect, it } from "vitest";
import { intervalDue, isDueSoon, isStale } from "@/lib/tasks/reminders";

const rules = [{ priority: "urgent" as const, category_id: null, duration_minutes: 60 }];
const base = {
  status: "in_progress" as const,
  in_progress_at: "2026-07-05T00:00:00.000Z",
  priority: "urgent" as const,
  category_id: null,
  sla_minutes: 60,
  in_progress_seconds: 0,
  overdue_count: 0,
};

describe("intervalDue", () => {
  const now = new Date("2026-07-05T10:00:00.000Z");
  it("true when never sent", () => expect(intervalDue(null, 3600e3, now)).toBe(true));
  it("false within the interval", () =>
    expect(intervalDue("2026-07-05T09:30:00.000Z", 3600e3, now)).toBe(false));
  it("true once the interval has elapsed", () =>
    expect(intervalDue("2026-07-05T08:00:00.000Z", 3600e3, now)).toBe(true));
});

describe("isDueSoon", () => {
  it("true inside the lead window before breach", () => {
    // 50 min in, 10 min left, lead = 15 → due soon
    expect(isDueSoon(base, rules, 15, new Date("2026-07-05T00:50:00.000Z"))).toBe(true);
  });
  it("false when already overdue", () => {
    expect(isDueSoon(base, rules, 15, new Date("2026-07-05T01:05:00.000Z"))).toBe(false);
  });
  it("false when the SLA isn't active (post-Waiting / post-overdue)", () => {
    expect(isDueSoon({ ...base, overdue_count: 1 }, rules, 15, new Date("2026-07-05T00:50:00.000Z"))).toBe(false);
  });
});

describe("isStale", () => {
  const now = new Date("2026-07-05T00:00:00.000Z");
  it("true when a live task has had no activity past the threshold", () => {
    expect(isStale({ status: "todo", last_activity_at: "2026-07-02T00:00:00.000Z" }, 48, now)).toBe(true);
  });
  it("false for done/cancel/backlog", () => {
    expect(isStale({ status: "done", last_activity_at: "2026-01-01T00:00:00.000Z" }, 48, now)).toBe(false);
    expect(isStale({ status: "backlog", last_activity_at: "2026-01-01T00:00:00.000Z" }, 48, now)).toBe(false);
  });
  it("false within the threshold", () => {
    expect(isStale({ status: "todo", last_activity_at: "2026-07-04T18:00:00.000Z" }, 48, now)).toBe(false);
  });
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement** `reminders.ts`:

```ts
import type { TaskRow, TaskSlaRule } from "./types";
import { isSlaActiveInProgress, slaRemainingSeconds } from "./sla";

export function intervalDue(
  lastIso: string | null | undefined,
  intervalMs: number,
  now: Date
): boolean {
  if (!lastIso) return true;
  const last = new Date(lastIso).getTime();
  return Number.isNaN(last) || now.getTime() - last >= intervalMs;
}

export function isDueSoon(
  task: Parameters<typeof slaRemainingSeconds>[0] & {
    status: TaskRow["status"];
    in_progress_at: string | null;
    overdue_count: number;
  },
  rules: Pick<TaskSlaRule, "priority" | "category_id" | "duration_minutes">[],
  dueSoonMinutes: number,
  now: Date
): boolean {
  if (!isSlaActiveInProgress(task)) return false;
  const remaining = slaRemainingSeconds(task, rules, now);
  return remaining > 0 && remaining <= dueSoonMinutes * 60;
}

export function isStale(
  task: { status: TaskRow["status"]; last_activity_at: string | null },
  staleHours: number,
  now: Date
): boolean {
  if (task.status === "done" || task.status === "cancel" || task.status === "backlog") return false;
  if (!task.last_activity_at) return false;
  const last = new Date(task.last_activity_at).getTime();
  if (Number.isNaN(last)) return false;
  return now.getTime() - last >= staleHours * 3600_000;
}
```

- [ ] **Step 4:** Test PASS. **Step 5:** Commit (`feat(tasks): reminder predicates (due-soon, stale, interval)`).

---

## Task 4: `touchLastActivity` helper + wire into every action site

**Files:** Create `src/lib/tasks/last-activity.ts`; modify `src/app/api/tasks/[id]/route.ts` (PATCH), `reopen/route.ts`, `overdue-unlock/route.ts`, `assignees/route.ts` (POST), `assignees/[email]/route.ts` (DELETE), `comments/route.ts` (POST).

**Interfaces:** Produces `touchLastActivity(supabase, taskId, nowIso, extra?): Promise<void>` — sets `last_activity_at = nowIso` and clears `stale_reminded_at = null` (so the stale clock re-arms after activity). `extra` optionally merges more fields in the same update.

- [ ] **Step 1: Implement** `last-activity.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export async function touchLastActivity(
  supabase: SupabaseClient,
  taskId: string,
  nowIso: string
): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({ last_activity_at: nowIso, stale_reminded_at: null })
    .eq("id", taskId);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 2: Wire it in.** In each route below, after the successful primary write, add `await touchLastActivity(...)` to the `Promise.all(...)` batch (or as its own await where there's no batch). Use the route's existing `nowIso`/`id`/`supabase`:
  - `[id]/route.ts` PATCH — inside the existing `Promise.all([...])` audit batch.
  - `reopen/route.ts` — inside its `Promise.all([...])`.
  - `overdue-unlock/route.ts` — inside its `Promise.all([...])`.
  - `assignees/route.ts` POST and `assignees/[email]/route.ts` DELETE — after the task update.
  - `comments/route.ts` POST — after the comment insert (comments count as activity per the design). Compute a `nowIso` if the route doesn't have one.

  > Note: PATCH already writes `last_activity_at`? No — it writes `updated_at`. Keep both; `updated_at` is a generic row-touch, `last_activity_at` is the semantic "someone acted" clock the stale check reads.

- [ ] **Step 3:** `npm run typecheck && npm run lint && npm run build` → green. Commit (`feat(tasks): bump last_activity_at on every task action`).

---

## Task 5: Instant notifications — unassigned, reopened, qc_needed

**Files:** modify `assignees/[email]/route.ts` (DELETE), `reopen/route.ts`, `[id]/route.ts` (PATCH).

- [ ] **Step 1:** In `assignees/[email]/route.ts` DELETE, after removal, if the removed `email !== actor.email`, `insertNotifications([{ recipient_email: email, task_id: id, type: "unassigned", actor_email: actor.email }])`.

- [ ] **Step 2:** In `reopen/route.ts`, after the update, notify each current assignee (fetch via `fetchTaskAssigneeEmails(id, supabase)`), excluding the actor: `type: "reopened"`.

- [ ] **Step 3:** In `[id]/route.ts` PATCH, when `resolved.patch.status === "done"` and `r.task.status !== "done"`, resolve the agent owner + Assistants of `r.task.agent_email` (use `fetchCsForAgent` filtered by `is_assistant`, or `isAgentOwnerOrAssistant` per candidate — reuse existing membership helpers) and `insertNotifications` `type: "qc_needed"` to each (excluding the actor). Add to the existing `Promise.all`.

- [ ] **Step 4:** Verify build. Commit (`feat(tasks): instant notifications for unassign / reopen / qc-needed`).

---

## Task 6: Cron — configurable intervals + due_soon + stale

**Files:** modify `src/app/api/cron/check-overdue/route.ts`.

- [ ] **Step 1:** Load settings once: `const settings = resolveReminderSettings((await supabase.from("task_reminder_settings").select("*").maybeSingle()).data)`.

- [ ] **Step 2:** Replace the hardcoded `REMINDER_INTERVAL_MS` / `WAITING_REMINDER_AFTER_MS` and the private `reminderDue` with `intervalDue(...)` + settings-derived millisecond values (`settings.overdueReminderHours*3600e3`, etc.).

- [ ] **Step 3:** Select the extra columns the new checks need in the task query: add `last_activity_at`, `due_soon_notified_at`. Add a second query (or widen the first) for **all non-terminal tasks** (not just `in_progress`) for the stale check: `status in ('todo','in_progress','waiting')`, `archived_at is null`.

- [ ] **Step 4:** After the existing overdue/waiting handling, add two passes:
  - **due_soon:** for `in_progress` tasks where `isDueSoon(task, rules, settings.dueSoonMinutes, now)` AND `intervalDue(task.due_soon_notified_at, budgetMs, now)` — but simplest dedup: fire once per active SLA window → send only if `due_soon_notified_at is null`; set `due_soon_notified_at = nowIso`. (It's cleared when In Progress restarts — Step 5.) Notify assignees `type: "due_soon"`.
  - **stale:** for non-terminal tasks where `isStale(task, settings.staleHours, now)` AND `intervalDue(task.stale_reminded_at, settings.staleHours*3600e3, now)` — notify assignees `type: "stale"`; set `stale_reminded_at = nowIso`.

- [ ] **Step 5:** In `transitions.ts`, where the patch enters `in_progress` (the block that already sets `overdue_flagged_at = null; overdue_reminded_at = null;`), also set `patch.due_soon_notified_at = null;` so due_soon re-arms each active run. (`stale_reminded_at` is cleared by `touchLastActivity` on any action.)

- [ ] **Step 6:** Verify build. Commit (`feat(cron): configurable reminder intervals + due-soon + stale`).

---

## Task 7: Reminder-settings API + SLA Times "Reminders" section

**Files:** create `src/app/api/admin/task-reminder-settings/route.ts`; modify `src/app/(authed)/tasks/_components/SlaRulesModal.tsx`.

- [ ] **Step 1:** API route — `GET` returns the single row (or defaults); `PUT` upserts `{ id: true, ...validated }`. Both gated: reuse the pattern in `src/app/api/admin/task-sla-rules/route.ts` (`buildTaskActor` + `actor.isManager` for writes, `canAccessBoard` for reads).

- [ ] **Step 2:** In `SlaRulesModal.tsx`, add a "Reminders" section below the SLA rules: four number inputs (due-soon minutes, overdue-reminder hours, waiting hours, stale hours) loaded from / saved to the new route. Reuse the existing dropdown/number styling in that modal.

- [ ] **Step 3:** Verify build. Commit (`feat(tasks): reminder thresholds in the SLA Times modal`).

---

## Task 8: Notification labels for the new types

**Files:** modify wherever notification/activity types are turned into text — `src/app/(authed)/tasks/_components/ActivityFeed.tsx` `describe()` and the notification-bell dropdown component (search for the existing `"assigned"`/`"overdue"` label switch).

- [ ] **Step 1:** Add human-readable labels for `unassigned`, `reopened`, `qc_needed`, `due_soon`, `stale` (e.g. "was removed from a task", "reopened this task", "a Done task needs QC", "is due soon", "has had no activity"). Match the existing tone/format.

- [ ] **Step 2:** Verify build. Commit (`feat(tasks): bell/activity labels for new notification types`).

---

## Task 9: GitHub Actions cron every 15 min; drop Vercel cron

**Files:** create `.github/workflows/task-reminders.yml`; modify `vercel.json`.

- [ ] **Step 1: Create the workflow:**

```yaml
name: Task reminders cron
on:
  schedule:
    - cron: "*/15 * * * *"   # every 15 minutes (GitHub may delay under load)
  workflow_dispatch: {}        # manual trigger for testing
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Hit the overdue/reminder cron endpoint
        run: |
          curl -fsS -X GET \
            -H "Authorization: Bearer ${{ secrets.TASK_CRON_SECRET }}" \
            "${{ secrets.TASK_CRON_URL }}"
```

- [ ] **Step 2:** In the repo's GitHub settings → Secrets and variables → Actions, add `TASK_CRON_SECRET` (= the deployed `CRON_SECRET`) and `TASK_CRON_URL` (= `https://<your-vercel-domain>/api/cron/check-overdue`).

- [ ] **Step 3:** Remove the `check-overdue` entry from `vercel.json` `crons` (leave `sync-data`).

- [ ] **Step 4:** Commit (`ci(tasks): run reminder cron every 15m via GitHub Actions`). Verify by triggering the workflow manually (`workflow_dispatch`) and confirming a `200` with the JSON summary.

---

## Self-Review

- **Coverage:** unassigned/reopened/qc_needed → Task 5; due_soon/stale + configurable intervals → Tasks 3+6; timely delivery → Task 9; thresholds in settings → Tasks 1+2+7; stale clock → Tasks 1+4. `overdue` stays assignee-only (Task 5 adds no manager copy). ✓
- **Dependency:** `tasks.last_activity_at` (Task 1) is also required by the card-ordering plan's "recent activity" tier — do Task 1 before that plan's ranking task.
- **Placeholders:** pure-logic tasks contain full code + tests; wiring tasks name exact files and the exact insertion points.
- **Type consistency:** `ReminderSettings` camelCase used in `reminders.ts`/cron/API; `resolveReminderSettings` maps snake_case once. `intervalDue`/`isDueSoon`/`isStale` signatures match their call sites in Task 6.
