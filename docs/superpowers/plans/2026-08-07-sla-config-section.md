# Move SLA Times into Table Config — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plan version:** v2 — refreshed 2026-08-09 against `HEAD = 8d08351`.
**v1 was written 2026-08-07 and is now unexecutable** — see "What changed since v1" below before doing anything.

**Goal:** Move the "SLA Times" admin UI (SLA duration rules per priority/category + reminder timing settings) out of its own modal on the CS Task Board header into a new tab inside `/config` (Health Table Configuration) — **and, in the same pass, pull every hardcoded SLA constant out of the component into one named, tested module** so nothing about SLA behaviour lives in a UI file where nobody can find it.

---

## What changed since v1 (read this first)

v1 quoted real code, which was the right call — but 124 commits landed between v1 and now (`df561ef..8d08351`, the go-live fix batch). **Three of v1's anchor snippets no longer exist.** An implementer running v1 verbatim would fail to find them and start improvising, which is exactly what quoting real code is supposed to prevent.

| v1 assumed | Reality at `8d08351` | Consequence |
|---|---|---|
| `type Tab = "table" \| "value" \| "assistant" \| "imports";` | `type Tab = "table" \| "value" \| "assistant";` (`ConfigClient.tsx:65`) | The `"imports"` tab was deleted in `4fdac30 feat(config): remove import workflow, preserve export`. v1's find-string does not exist. |
| Insert the new tab render next to `{tab === "imports" ? <ImportReviewSection … /> : null}` | `ImportReviewSection` — **0 occurrences**, component deleted | v1's insertion anchor does not exist. |
| `config/page.tsx` `Promise.all` ends with a raw `enrollment_records.select(...)` usage-count query | It is now `supabase.rpc("enrollment_option_usage_counts")` (`page.tsx:59`, commit `3ea385e`) | v1's quoted block does not match. |
| `npx vitest run` → `PASS (424)` | **60 files / 458 tests** | Stale expectation. |
| Line refs: import `48`, `managingSlaRules` `127`, modal block `1471-1477` | `49`, `143`, `1755` | All shifted. |

Everything in this v2 was re-read from the working tree on 2026-08-09.

---

## Architecture

`/config`'s `ConfigClient.tsx` renders 3 tabs today (Table Columns / Dropdown Values / Assistant Membership), each backed by its own section component and server-fetched initial data from `config/page.tsx`. This plan adds a 4th tab, `"sla"`, backed by a new `ConfigSlaSection.tsx` — the existing `SlaRulesModal.tsx` content with the modal chrome (backdrop, `role="dialog"` wrapper, header + X button, `open`/`onClose` props, `if (!open) return null`) stripped and replaced with the same plain `<section>` wrapper the other tabs use. `task_sla_rules` gets SSR-fetched in `config/page.tsx`, matching how `task_categories` already is.

**The CS Task Board keeps everything that *reads* SLA.** `TaskBoardClient.tsx` keeps its `slaRules` state, its `reloadSlaRules()` fetch, and every read (`isTaskOverdue`, the `rules={slaRules}` props into `TaskListView`/`KanbanBoard`). Those render overdue badges and countdowns for **every** user, not just admins, and are unrelated to the admin-editing UI. Only the modal, its trigger button, and the `managingSlaRules` open/close state are removed.

**Tech stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (service-role server client), Tailwind v4, Vitest.

---

## The hardcode problem this plan also fixes

The stated ask: *"viết tất cả logic thật tốt để tránh hardcode trong code mà không biết."* Below is every hardcoded SLA value found by reading the working tree. A straight modal→section port would carry all of it across unchanged, just to a new file.

| # | Value | Currently at | Also defined at | Risk |
|---|---|---|---|---|
| **H1** | SLA defaults `low 1440 / medium 480 / high 240 / urgent 60` | `src/lib/tasks/sla.ts:11-16` (`DEFAULT_SLA_MINUTES`) | `supabase/schema.sql:1588-1593` (seed `do $$` block) | **Two independent sources of the same four numbers.** Currently identical — verified. Nothing locks them. Change one, the fallback silently disagrees with the DB. |
| **H2** | Reminder defaults `15 / 24 / 24 / 24 / 48 / 24` | `src/lib/tasks/reminder-settings.ts:10-17` | `supabase/schema.sql:1608-1620` (column `default`s) | Same duplication. Currently identical — verified. |
| **H3** | `HOUR_OPTIONS = Array.from({ length: 169 })` → 0–168h | `SlaRulesModal.tsx:32` | — | The "max SLA is 1 week" business rule exists **only** as an array length in a UI file, with a trailing comment. |
| **H4** | `MINUTE_OPTIONS = [0,5,…,55]` | `SlaRulesModal.tsx:33` | — | "SLA is set in 5-minute steps" is an unnamed convention. |
| **H5** | `PRIORITY_LABEL` | `SlaRulesModal.tsx:24-29` | — | Only copy in the repo (verified by grep), but it lives in a modal, not next to `TASK_PRIORITIES` in `types.ts`. |
| **H6** | `REMINDER_ROWS` (key → label + unit) | `SlaRulesModal.tsx:34-45` | `ReminderSettings` type, `reminder-settings.ts:1-8` | **Silent-omission bug:** add a field to `ReminderSettings` and forget a row here → the setting exists, is saved by the API, and is **invisible and un-editable** in the UI. Nothing catches it. |
| **H7** | `DEFAULT_ROW_KEY = "__default__"` | `SlaRulesModal.tsx:31` | — | Sentinel for "no category"; fine, but belongs with the rest. |
| **H8** | **No upper bound server-side** | `api/admin/task-sla-rules/route.ts:52` only checks `> 0` | UI caps at 168h (H3) | **UI and API disagree.** `POST { duration_minutes: 999999 }` is accepted. Not a security hole (admin-only), but a task could get a ~2-year SLA that the UI can neither display sensibly nor edit back. |

**Approach:** Tasks 1–3 create one module — `src/lib/tasks/sla-config.ts` — that owns H3–H8, add tests that lock H1/H2 against the SQL file, and close the H8 asymmetry. Tasks 4–7 then do the actual move, consuming that module instead of re-declaring constants.

**Explicitly out of scope:** no change to SLA *business logic* (`resolveSlaMinutes`, `isTaskOverdue`, `effectiveSlaMinutes`, `slaRemainingSeconds`, `currentStintDueAt`), to the storage shape, or to who may edit. `lib/tasks/sla.ts` is modified **only** to re-export bounds for backwards compatibility — its functions are untouched.

---

## Global Constraints

- Never run `next build` while the dev server may be running.
- Before deleting `.next`, confirm with the user the dev server is fully stopped.
- Only push to `origin` automatically; push to `vercel` only if explicitly asked.
- Log this change in `agent-portal/changelog.md` — it is logic-relevant: it changes where the SLA-editing UI lives and adds a server-side validation bound.
- After every task: `npx tsc --noEmit`, `npx vitest run`, and `rtk proxy npx eslint <touched files>` must all be clean before moving on.
- **Baseline at plan time (`8d08351`), all green — any regression against these is a stop:** `typecheck` 0 errors · `lint` "No issues found" · `vitest` **60 files / 458 tests** · `build` exit 0.
- Reply to the user in Vietnamese, concise, once the plan is executed.

---

### Task 1: Create `src/lib/tasks/sla-config.ts` — one home for every SLA UI/validation constant

**Files:**
- Create: `src/lib/tasks/sla-config.ts`

**Interfaces:**
- Consumes: `TASK_PRIORITIES`, `TaskPriority` from `@/lib/tasks/types`; `ReminderSettings` from `@/lib/tasks/reminder-settings`.
- Produces: `SLA_DURATION_BOUNDS`, `SLA_MINUTE_STEP`, `SLA_HOUR_OPTIONS`, `SLA_MINUTE_OPTIONS`, `SLA_DEFAULT_CATEGORY_ROW_KEY`, `TASK_PRIORITY_LABEL`, `REMINDER_FIELDS`, `isSlaDurationInBounds`.

Why a new file rather than adding to `sla.ts`: `sla.ts` is imported by cron routes, API routes, and pure-logic tests. These are presentation/validation constants, not SLA math. Keeping them separate means a UI copy change can never touch a file the overdue engine depends on.

- [x] **Step 1: Write the file**

```ts
// Presentation + validation constants for the SLA admin UI.
//
// These used to live as bare literals inside SlaRulesModal.tsx, which meant
// three business rules ("SLA caps at one week", "SLA is set in 5-minute
// steps", "these six reminder fields are editable") existed only as an array
// length, an array literal, and a hand-maintained row list inside a component
// nobody greps when changing behaviour.
//
// SLA *math* stays in ./sla.ts. This file is deliberately free of logic that
// the cron/overdue engine depends on.
import { TASK_PRIORITIES, type TaskPriority } from "./types";
import type { ReminderSettings } from "./reminder-settings";

/**
 * Allowed range for a single SLA rule, in minutes.
 *
 * `max` is the real business rule "an SLA never exceeds one week", which
 * previously existed only as `Array.from({ length: 169 })` in the modal. It is
 * now enforced in BOTH places that can write a rule:
 *   - the admin UI (dropdown options are generated from it), and
 *   - POST /api/admin/task-sla-rules (see Task 3).
 * Before Task 3 the API accepted any positive integer, so the UI cap was
 * cosmetic and a direct API call could store e.g. 999999 minutes.
 */
export const SLA_DURATION_BOUNDS = {
  minMinutes: 1,
  maxMinutes: 168 * 60, // 168h = 7 days
} as const;

/** SLA durations are chosen in 5-minute increments. */
export const SLA_MINUTE_STEP = 5;

/** Hour choices: 0h … 168h, derived from the bound above — never re-typed. */
export const SLA_HOUR_OPTIONS: readonly number[] = Array.from(
  { length: Math.floor(SLA_DURATION_BOUNDS.maxMinutes / 60) + 1 },
  (_, index) => index
);

/** Minute choices: 0, 5, … 55 — derived from the step above. */
export const SLA_MINUTE_OPTIONS: readonly number[] = Array.from(
  { length: Math.floor(60 / SLA_MINUTE_STEP) },
  (_, index) => index * SLA_MINUTE_STEP
);

/**
 * Sentinel row id for "no category" in the rules table. `task_sla_rules`
 * stores this as `category_id = null`; React needs a non-null key.
 */
export const SLA_DEFAULT_CATEGORY_ROW_KEY = "__default__";

/**
 * Display labels for task priorities. Typed as a total Record over
 * TaskPriority, so adding a priority to TASK_PRIORITIES fails the build here
 * instead of rendering a blank row.
 */
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

/**
 * The editable reminder fields, in display order.
 *
 * `key` is typed as `keyof ReminderSettings`, and Task 2 adds a test asserting
 * this list covers EVERY key of ReminderSettings. That combination is what
 * stops the silent-omission bug: adding a field to ReminderSettings without
 * adding it here previously produced a setting that the API happily stored but
 * no admin could ever see or change.
 */
export const REMINDER_FIELDS: ReadonlyArray<{
  key: keyof ReminderSettings;
  label: string;
  unit: string;
}> = [
  { key: "dueSoonMinutes", label: "Due soon", unit: "min" },
  { key: "todoHours", label: "To Do reminders", unit: "h" },
  { key: "overdueReminderHours", label: "Overdue reminders", unit: "h" },
  { key: "waitingHours", label: "Waiting reminders", unit: "h" },
  { key: "staleHours", label: "Stale reminders", unit: "h" },
  { key: "qcHours", label: "QC reminders", unit: "h" },
];

/** Shared by the UI and the API so both reject the same values. */
export function isSlaDurationInBounds(totalMinutes: number): boolean {
  return (
    Number.isFinite(totalMinutes) &&
    Number.isInteger(totalMinutes) &&
    totalMinutes >= SLA_DURATION_BOUNDS.minMinutes &&
    totalMinutes <= SLA_DURATION_BOUNDS.maxMinutes
  );
}

/** Priority order for the left-hand nav — re-exported so the UI never re-lists it. */
export const SLA_PRIORITY_ORDER = TASK_PRIORITIES;
```

- [x] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found` (nothing imports it yet; it must type-check standalone).

Run: `rtk proxy npx eslint "src/lib/tasks/sla-config.ts"`
Expected: clean.

---

### Task 2: Lock the duplicated defaults (H1/H2) and the reminder-field list (H6) with tests

**Files:**
- Create: `src/lib/tasks/sla-config.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_SLA_MINUTES` (`./sla`), `DEFAULT_REMINDER_SETTINGS` (`./reminder-settings`), everything from `./sla-config`, plus `node:fs` to read `supabase/schema.sql`.

This is the core of "avoid hardcode nobody knows about". `DEFAULT_SLA_MINUTES` carries the comment *"mirrors the DB seed in schema.sql"* — that claim is **currently true** (verified: `sla.ts:11-16` vs `schema.sql:1588-1593` both give 1440/480/240/60) but is enforced by nothing. Same for reminder defaults vs the DB column defaults. These tests turn both comments into build failures.

- [x] **Step 1: Write the file**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_SLA_MINUTES } from "./sla";
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from "./reminder-settings";
import {
  REMINDER_FIELDS,
  SLA_DURATION_BOUNDS,
  SLA_HOUR_OPTIONS,
  SLA_MINUTE_OPTIONS,
  SLA_MINUTE_STEP,
  TASK_PRIORITY_LABEL,
  isSlaDurationInBounds,
} from "./sla-config";
import { TASK_PRIORITIES } from "./types";

const schemaSql = readFileSync(
  fileURLToPath(new URL("../../../supabase/schema.sql", import.meta.url)),
  "utf8"
);

describe("SLA defaults stay in sync with the database", () => {
  // sla.ts:11 claims DEFAULT_SLA_MINUTES "mirrors the DB seed in schema.sql".
  // schema.sql:1588-1593 seeds task_sla_rules with the priority-only rows.
  // If either side is edited alone, the app's fallback silently disagrees with
  // what a fresh database actually contains.
  it("DEFAULT_SLA_MINUTES matches the task_sla_rules seed", () => {
    for (const priority of TASK_PRIORITIES) {
      const seeded = new RegExp(`\\('${priority}',\\s*(\\d+)\\)`).exec(schemaSql);
      expect(seeded, `no seed row found for priority "${priority}"`).not.toBeNull();
      expect(Number(seeded![1])).toBe(DEFAULT_SLA_MINUTES[priority]);
    }
  });

  // DEFAULT_REMINDER_SETTINGS is the fallback resolveReminderSettings() uses
  // for any missing column; the DB column defaults are what a fresh row gets.
  // They must agree or a brand-new install behaves differently from a
  // half-migrated one.
  it("DEFAULT_REMINDER_SETTINGS matches the task_reminder_settings column defaults", () => {
    const columnByField: Record<keyof ReminderSettings, string> = {
      dueSoonMinutes: "due_soon_minutes",
      todoHours: "todo_hours",
      overdueReminderHours: "overdue_reminder_hours",
      waitingHours: "waiting_hours",
      staleHours: "stale_hours",
      qcHours: "qc_hours",
    };

    for (const [field, column] of Object.entries(columnByField) as Array<
      [keyof ReminderSettings, string]
    >) {
      const declared = new RegExp(`${column}\\s+integer\\s+not null\\s+default\\s+(\\d+)`).exec(
        schemaSql
      );
      expect(declared, `no column default found for "${column}"`).not.toBeNull();
      expect(Number(declared![1])).toBe(DEFAULT_REMINDER_SETTINGS[field]);
    }
  });

  it("every seeded SLA default is inside the allowed bounds", () => {
    for (const priority of TASK_PRIORITIES) {
      expect(isSlaDurationInBounds(DEFAULT_SLA_MINUTES[priority])).toBe(true);
    }
  });
});

describe("SLA config constants are derived, not re-typed", () => {
  it("REMINDER_FIELDS covers every ReminderSettings key exactly once", () => {
    const listed = REMINDER_FIELDS.map((field) => field.key).sort();
    const actual = (Object.keys(DEFAULT_REMINDER_SETTINGS) as Array<
      keyof ReminderSettings
    >).sort();
    expect(listed).toEqual(actual);
  });

  it("every priority has a display label", () => {
    for (const priority of TASK_PRIORITIES) {
      expect(TASK_PRIORITY_LABEL[priority]).toBeTruthy();
    }
  });

  it("hour options span 0h to the max bound", () => {
    expect(SLA_HOUR_OPTIONS[0]).toBe(0);
    expect(SLA_HOUR_OPTIONS.at(-1)).toBe(SLA_DURATION_BOUNDS.maxMinutes / 60);
  });

  it("minute options follow the declared step and stay under an hour", () => {
    expect(SLA_MINUTE_OPTIONS[0]).toBe(0);
    expect(SLA_MINUTE_OPTIONS.at(-1)).toBe(60 - SLA_MINUTE_STEP);
    for (const minute of SLA_MINUTE_OPTIONS) expect(minute % SLA_MINUTE_STEP).toBe(0);
  });

  it("rejects out-of-bounds durations", () => {
    expect(isSlaDurationInBounds(0)).toBe(false);
    expect(isSlaDurationInBounds(-5)).toBe(false);
    expect(isSlaDurationInBounds(1.5)).toBe(false);
    expect(isSlaDurationInBounds(SLA_DURATION_BOUNDS.maxMinutes + 1)).toBe(false);
    expect(isSlaDurationInBounds(SLA_DURATION_BOUNDS.maxMinutes)).toBe(true);
  });
});
```

- [x] **Step 2: Verify**

Run: `npx vitest run src/lib/tasks/sla-config.test.ts`
Expected: all pass. **If the two sync tests fail on first run, STOP** — that means the TS constants and the SQL already disagree today, which is a real bug to report to the user, not something to "fix" by editing the test.

Run: `npx vitest run`
Expected: **61 files / 469 tests** (60 + this file; 458 + 11 new cases). Exact totals may differ by a case or two — what matters is `FAIL (0)` and that the count went **up**.

---

### Task 3: Enforce the SLA upper bound server-side (H8)

**Files:**
- Modify: `src/app/api/admin/task-sla-rules/route.ts`

**Interfaces:**
- Consumes: `SLA_DURATION_BOUNDS`, `isSlaDurationInBounds` from `@/lib/tasks/sla-config`.

Today the route only rejects `<= 0`, so the UI's 168h cap is decorative — any client can store an arbitrarily large SLA. The UI cannot then render or edit it back, because 999999 is not in `SLA_HOUR_OPTIONS`.

- [x] **Step 1: Import the shared bound**

Add to the imports at the top of `src/app/api/admin/task-sla-rules/route.ts`:

```ts
import { SLA_DURATION_BOUNDS, isSlaDurationInBounds } from "@/lib/tasks/sla-config";
```

- [x] **Step 2: Replace the lower-bound-only check**

Current (`route.ts:51-53`):

```ts
  const durationMinutes = Number(body?.duration_minutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
```

Replace the whole guard with:

```ts
  const durationMinutes = Math.round(Number(body?.duration_minutes));
  if (!isSlaDurationInBounds(durationMinutes)) {
```

and update that guard's error message to name the real range, e.g.:

```ts
    return NextResponse.json(
      {
        error: `duration_minutes must be between ${SLA_DURATION_BOUNDS.minMinutes} and ${SLA_DURATION_BOUNDS.maxMinutes} minutes.`,
      },
      { status: 400 }
    );
```

⚠️ Read the existing guard body before replacing — quote the current `return NextResponse.json(...)` shape and keep its status code. Do not change the surrounding priority/category validation.

- [x] **Step 3: `Math.round` is now applied once**

`route.ts:75` currently stores `duration_minutes: Math.round(durationMinutes)`. Since Step 2 already rounds, change that to plain `duration_minutes: durationMinutes` so the value written is provably the value validated. (Leaving the double-round is harmless but means the validated number and the stored number are computed separately — the class of drift this whole plan is about.)

- [x] **Step 4: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npx vitest run` → same totals as end of Task 2, `FAIL (0)`.
Run: `rtk proxy npx eslint "src/app/api/admin/task-sla-rules/route.ts"` → clean.

Manual (dev server already running — do **not** start a second one):
```bash
curl -X POST localhost:3000/api/admin/task-sla-rules \
  -H 'Content-Type: application/json' \
  -d '{"priority":"urgent","category_id":null,"duration_minutes":999999}'
```
Expected: **400** with the new range message. Before this task it returned 200 and stored the value.

---

### Task 4: SSR-fetch `task_sla_rules` in `config/page.tsx`

**Files:**
- Modify: `src/app/(authed)/config/page.tsx`

**Interfaces:**
- Produces: `initialSlaRules: TaskSlaRule[]` passed into `<ConfigClient>`, matching the row shape `GET /api/admin/task-sla-rules` already returns (`id, priority, category_id, duration_minutes` — see `src/app/api/admin/task-sla-rules/route.ts:25`).

- [x] **Step 1: Extend the type import**

Change:
```ts
import type { TaskCategory } from "@/lib/tasks/types";
```
to:
```ts
import type { TaskCategory, TaskSlaRule } from "@/lib/tasks/types";
```

- [x] **Step 2: Add the fetch to the existing `Promise.all`**

The current block is `page.tsx:30-70` (re-read from HEAD — note the last entry is now an **RPC**, which is what v1 got wrong):

```ts
  const supabase = getSupabaseAdmin();
  const [
    columns,
    options,
    agents,
    candidates,
    assignees,
    memberResult,
    categoriesResult,
    acaOptionData,
    medicareOptionData,
    usageCountResult,
  ] = await Promise.all([
    fetchAllTableColumns(supabase),
    fetchAllTableColumnOptions(supabase),
    fetchTaskAgents(),
    fetchTaskAgentCandidates(),
    fetchTaskAssignees(),
    supabase
      .from("agent_members")
      .select("agent_email,cs_email,is_assistant")
      .eq("is_assistant", true),
    supabase
      .from("task_categories")
      .select("id,name,color")
      .eq("is_active", true)
      .order("position", { ascending: true }),
    fetchEnrollmentOptionData("aca"),
    fetchEnrollmentOptionData("medicare"),
    supabase.rpc("enrollment_option_usage_counts"),
  ]);

  if (memberResult.error) {
    throw new Error(memberResult.error.message);
  }
  if (categoriesResult.error) {
    throw new Error(categoriesResult.error.message);
  }
  if (usageCountResult.error) {
    throw new Error(usageCountResult.error.message);
  }
```

Replace with (adds `slaRulesResult` in **both** the destructuring and the array — keep the positions aligned — plus its own error check):

```ts
  const supabase = getSupabaseAdmin();
  const [
    columns,
    options,
    agents,
    candidates,
    assignees,
    memberResult,
    categoriesResult,
    slaRulesResult,
    acaOptionData,
    medicareOptionData,
    usageCountResult,
  ] = await Promise.all([
    fetchAllTableColumns(supabase),
    fetchAllTableColumnOptions(supabase),
    fetchTaskAgents(),
    fetchTaskAgentCandidates(),
    fetchTaskAssignees(),
    supabase
      .from("agent_members")
      .select("agent_email,cs_email,is_assistant")
      .eq("is_assistant", true),
    supabase
      .from("task_categories")
      .select("id,name,color")
      .eq("is_active", true)
      .order("position", { ascending: true }),
    supabase
      .from("task_sla_rules")
      .select("id,priority,category_id,duration_minutes"),
    fetchEnrollmentOptionData("aca"),
    fetchEnrollmentOptionData("medicare"),
    supabase.rpc("enrollment_option_usage_counts"),
  ]);

  if (memberResult.error) {
    throw new Error(memberResult.error.message);
  }
  if (categoriesResult.error) {
    throw new Error(categoriesResult.error.message);
  }
  if (slaRulesResult.error) {
    throw new Error(slaRulesResult.error.message);
  }
  if (usageCountResult.error) {
    throw new Error(usageCountResult.error.message);
  }
```

- [x] **Step 3: Pass the prop**

In the `return (<ConfigClient … />)` block, add `initialSlaRules` immediately after the existing `initialCategories={...}` line (`page.tsx:98`):

```tsx
      initialSlaRules={(slaRulesResult.data ?? []) as TaskSlaRule[]}
```

- [x] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: **exactly one** new error, in `ConfigClient.tsx`, saying `initialSlaRules` is not a known prop. That is expected and closed by Task 6. If any **other** new error appears, stop and re-read Step 2 — the destructuring and the array are position-matched and easy to misalign.

---

### Task 5: Create `ConfigSlaSection.tsx`

**Files:**
- Create: `src/app/(authed)/config/_components/ConfigSlaSection.tsx`
- Read for reference (do **not** modify in this task): `src/app/(authed)/tasks/_components/SlaRulesModal.tsx` (578 lines)

**Interfaces:**
- Consumes: `TaskCategory`, `TaskPriority`, `TaskSlaRule` from `@/lib/tasks/types`; `DEFAULT_SLA_MINUTES`, `formatDurationMinutes`, `resolveSlaMinutes` from `@/lib/tasks/sla`; **everything presentational from `@/lib/tasks/sla-config` (Task 1)**; `DEFAULT_REMINDER_SETTINGS`, `ReminderSettings` from `@/lib/tasks/reminder-settings`; `taskCategoryPalette` from `@/lib/tasks/category-colors`; `useAnchoredMenu` from `../../tasks/_components/use-anchored-menu` (the hook lives under `tasks/_components`; this file is under `config/_components`, so the relative import crosses that boundary — intentional, same as several existing cross-imports).
- Produces: `export function ConfigSlaSection({ categories, rules, onRulesChange })` — a plain in-page `<section>`, no `open`/`onClose` (the parent mounts it only while its tab is active, so there is no "closed" state to model).

**Transformation from `SlaRulesModal.tsx`, exhaustively:**
1. Drop the `open` / `onClose` props, the `if (!open) return null;` early return (`:119`), and the `if (!open) return;` guard at the top of the `useEffect` (`:86`).
2. Replace the `fixed inset-0` backdrop + `role="dialog"` wrapper + `<header>` (icon, title, subtitle, X button) with the `<section>` shell used by `ConfigTableSection` (see `ConfigClient.tsx:215-224` for the sibling convention).
3. **Delete the local constants and import them from `sla-config` instead** — this is the whole point of Tasks 1–3:
   - `PRIORITY_LABEL` (`:24`) → `TASK_PRIORITY_LABEL`
   - `DEFAULT_ROW_KEY` (`:31`) → `SLA_DEFAULT_CATEGORY_ROW_KEY`
   - `HOUR_OPTIONS` (`:32`) → `SLA_HOUR_OPTIONS`
   - `MINUTE_OPTIONS` (`:33`) → `SLA_MINUTE_OPTIONS`
   - `REMINDER_ROWS` (`:34-45`) → `REMINDER_FIELDS`
   - the `TASK_PRIORITIES` map in the left nav → `SLA_PRIORITY_ORDER`
4. Use `isSlaDurationInBounds` in `save()` instead of the local `totalMinutes <= 0` check, so the UI refuses exactly what the API refuses (Task 3).
5. Keep `SlaRuleRow`, `ReminderSettingRow`, `DurationDropdown`, `formatDuration`, `ReminderSettingsResponse`, `SettingsView`, and all `save` / `reset` / `saveReminderSetting` / `loadReminderSettings` logic **byte-for-byte identical** apart from the substitutions above.
6. Do **not** import `Clock` — the icon belongs to the tab button in Task 6, not the section header. (`SlaRulesModal` imports it for its modal header; carrying it over is an unused-import lint failure.)

- [x] **Step 1: Write the file**

```tsx
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Loader2, RotateCcw } from "lucide-react";
import type { TaskCategory, TaskPriority, TaskSlaRule } from "@/lib/tasks/types";
import {
  DEFAULT_SLA_MINUTES,
  formatDurationMinutes,
  resolveSlaMinutes,
} from "@/lib/tasks/sla";
import {
  REMINDER_FIELDS,
  SLA_DEFAULT_CATEGORY_ROW_KEY,
  SLA_HOUR_OPTIONS,
  SLA_MINUTE_OPTIONS,
  SLA_PRIORITY_ORDER,
  TASK_PRIORITY_LABEL,
  isSlaDurationInBounds,
} from "@/lib/tasks/sla-config";
import { taskCategoryPalette } from "@/lib/tasks/category-colors";
import {
  DEFAULT_REMINDER_SETTINGS,
  type ReminderSettings,
} from "@/lib/tasks/reminder-settings";
import { useAnchoredMenu } from "../../tasks/_components/use-anchored-menu";

type ReminderSettingsResponse = {
  settings?: ReminderSettings;
  error?: string;
};

type SettingsView = "priority" | "reminders";

function formatDuration(minutes: number): string {
  return formatDurationMinutes(minutes);
}

export function ConfigSlaSection({
  categories,
  rules,
  onRulesChange,
}: {
  categories: TaskCategory[];
  rules: TaskSlaRule[];
  onRulesChange: (rules: TaskSlaRule[]) => void;
}) {
  const [view, setView] = useState<SettingsView>("priority");
  const [priority, setPriority] = useState<TaskPriority>("urgent");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings>(
    DEFAULT_REMINDER_SETTINGS
  );
  const [loadingReminders, setLoadingReminders] = useState(false);
  const [savingReminderKey, setSavingReminderKey] = useState<
    keyof ReminderSettings | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const rows = [
    { id: SLA_DEFAULT_CATEGORY_ROW_KEY, name: "Default (no category)", color: null },
    ...categories,
  ];

  useEffect(() => {
    let ignore = false;

    async function loadReminderSettings() {
      setLoadingReminders(true);
      try {
        const res = await fetch("/api/admin/task-reminder-settings");
        const data = (await res.json().catch(() => null)) as
          | ReminderSettingsResponse
          | null;
        if (!res.ok || !data?.settings) {
          throw new Error(data?.error ?? "Could not load reminder settings.");
        }
        if (!ignore) setReminderSettings(data.settings);
      } catch (err) {
        if (!ignore) {
          setError(
            err instanceof Error ? err.message : "Could not load reminder settings."
          );
        }
      } finally {
        if (!ignore) setLoadingReminders(false);
      }
    }

    loadReminderSettings();

    return () => {
      ignore = true;
    };
  }, []);

  function minutesFor(categoryId: string | null): number {
    return resolveSlaMinutes(priority, categoryId, rules);
  }

  function hasOverride(categoryId: string | null): boolean {
    return rules.some((r) => r.priority === priority && r.category_id === categoryId);
  }

  async function save(categoryId: string | null, totalMinutes: number, key: string) {
    // Same predicate the API enforces (lib/tasks/sla-config.ts), so the UI can
    // never offer or accept a value the server will reject.
    if (!isSlaDurationInBounds(totalMinutes)) {
      setError("Duration must be between 1 minute and 168 hours.");
      return;
    }
    setSavingKey(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/task-sla-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priority,
          category_id: categoryId,
          duration_minutes: totalMinutes,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { rule?: TaskSlaRule; error?: string }
        | null;
      if (!res.ok || !data?.rule) throw new Error(data?.error ?? "Save failed");

      const next = rules.filter(
        (r) => !(r.priority === priority && r.category_id === categoryId)
      );
      onRulesChange([...next, data.rule]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this rule.");
    } finally {
      setSavingKey(null);
    }
  }

  async function reset(categoryId: string | null, key: string) {
    setSavingKey(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/task-sla-rules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority, category_id: categoryId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Reset failed");
      }
      onRulesChange(
        rules.filter((r) => !(r.priority === priority && r.category_id === categoryId))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset this rule.");
    } finally {
      setSavingKey(null);
    }
  }

  async function saveReminderSetting(key: keyof ReminderSettings, value: number) {
    if (!Number.isFinite(value) || value <= 0) {
      setError("Reminder values must be greater than 0.");
      return;
    }

    const nextSettings = {
      ...reminderSettings,
      [key]: Math.round(value),
    };

    setSavingReminderKey(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/task-reminder-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextSettings),
      });
      const data = (await res.json().catch(() => null)) as
        | ReminderSettingsResponse
        | null;
      if (!res.ok || !data?.settings) {
        throw new Error(data?.error ?? "Could not save reminder settings.");
      }
      setReminderSettings(data.settings);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save reminder settings."
      );
    } finally {
      setSavingReminderKey(null);
    }
  }

  return (
    <section className="overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-sm">
      <div className="border-b border-[#dfe1e6] px-6 py-4">
        <h2 className="text-lg font-bold">SLA Times</h2>
        <p className="mt-1 text-sm text-[#6b778c]">
          Time before an In Progress task becomes Overdue, plus reminder timing.
        </p>
      </div>

      <div className="grid grid-cols-1 divide-y divide-[#dfe1e6] md:grid-cols-[14rem_minmax(0,1fr)] md:divide-x md:divide-y-0">
        <section className="flex min-h-0 flex-col bg-[#f7f8f9] p-3">
          <span className="mb-2 px-1 text-xs font-bold uppercase text-[#6b778c]">
            Priority
          </span>
          {SLA_PRIORITY_ORDER.map((p) => {
            const active = view === "priority" && p === priority;
            return (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setView("priority");
                  setPriority(p);
                }}
                className={`mb-1 flex items-center justify-between rounded border px-3 py-2 text-left text-sm font-semibold transition ${
                  active
                    ? "border-[#85b8ff] bg-[#e9f2ff] text-[#0c66e4]"
                    : "border-transparent text-[#172b4d] hover:bg-white"
                }`}
              >
                {TASK_PRIORITY_LABEL[p]}
                {active ? <Check className="h-4 w-4" /> : null}
              </button>
            );
          })}

          <div className="mt-4 border-t border-[#dfe1e6] pt-3">
            <button
              type="button"
              onClick={() => setView("reminders")}
              className={`flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm font-semibold transition ${
                view === "reminders"
                  ? "border-[#85b8ff] bg-[#e9f2ff] text-[#0c66e4]"
                  : "border-transparent text-[#172b4d] hover:bg-white"
              }`}
            >
              Reminder Setup
              {view === "reminders" ? <Check className="h-4 w-4" /> : null}
            </button>
          </div>
        </section>

        <section className="flex min-h-0 flex-col overflow-y-auto p-4">
          {view === "priority" ? (
            <>
              <ul className="space-y-1.5">
                {rows.map((row) => {
                  const categoryId =
                    row.id === SLA_DEFAULT_CATEGORY_ROW_KEY ? null : row.id;
                  const key = `${priority}:${row.id}`;
                  const saving = savingKey === key;
                  return (
                    <SlaRuleRow
                      key={key}
                      label={row.name}
                      color={row.color}
                      minutes={minutesFor(categoryId)}
                      showReset={
                        row.id !== SLA_DEFAULT_CATEGORY_ROW_KEY && hasOverride(categoryId)
                      }
                      saving={saving}
                      onSave={(totalMinutes) => save(categoryId, totalMinutes, key)}
                      onReset={() => reset(categoryId, key)}
                    />
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-[#97a0af]">
                System default: {formatDuration(DEFAULT_SLA_MINUTES[priority])}. Categories
                without an override use the &quot;Default&quot; row above.
              </p>
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-xs font-bold uppercase text-[#6b778c]">
                  Reminder Setup
                </h3>
                {loadingReminders ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0c66e4]" />
                ) : null}
              </div>
              <ul className="space-y-1.5">
                {REMINDER_FIELDS.map((row) => (
                  <ReminderSettingRow
                    key={`${row.key}:${reminderSettings[row.key]}`}
                    label={row.label}
                    value={reminderSettings[row.key]}
                    unit={row.unit}
                    saving={savingReminderKey === row.key}
                    disabled={loadingReminders}
                    onSave={(value) => saveReminderSetting(row.key, value)}
                  />
                ))}
              </ul>
            </>
          )}
          {error ? (
            <div className="mt-3 rounded bg-[#ffebe6] px-3 py-2 text-sm font-medium text-[#ae2a19]">
              {error}
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}
```

- [x] **Step 2: Port the three sub-components unchanged**

Append `ReminderSettingRow`, `SlaRuleRow`, and `DurationDropdown` to the same file, copied verbatim from `SlaRulesModal.tsx:360-577`, with exactly two substitutions inside `SlaRuleRow`:

```tsx
        <DurationDropdown
          value={hours}
          options={SLA_HOUR_OPTIONS}      // was HOUR_OPTIONS
          suffix="h"
          ariaLabel={`${label} — hours`}
          onChange={(next) => commit(next, mins)}
        />
        <DurationDropdown
          value={mins}
          options={SLA_MINUTE_OPTIONS}    // was MINUTE_OPTIONS
          suffix="m"
          ariaLabel={`${label} — minutes`}
          onChange={(next) => commit(hours, next)}
        />
```

and one signature widening in `DurationDropdown` (the shared constants are `readonly number[]`):

```tsx
  options: readonly number[];   // was: number[]
```

- [x] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: still only the Task-4 `initialSlaRules` error in `ConfigClient.tsx`. Nothing new from this file (it isn't imported yet, so it must type-check standalone).

Run: `rtk proxy npx eslint "src/app/(authed)/config/_components/ConfigSlaSection.tsx"`
Expected: clean — in particular **no unused import** (this is why `Clock` was dropped in the transformation list).

---

### Task 6: Wire the new tab into `ConfigClient.tsx`

**Files:**
- Modify: `src/app/(authed)/config/_components/ConfigClient.tsx`

- [x] **Step 1: Imports**

Change:
```ts
import type { TaskCategory } from "@/lib/tasks/types";
```
to:
```ts
import type { TaskCategory, TaskSlaRule } from "@/lib/tasks/types";
```

Add, immediately after the `} from "@/lib/enrollment/types";` import block:
```ts
import { ConfigSlaSection } from "./ConfigSlaSection";
```

Add `Clock` to the `lucide-react` import list, keeping alphabetical order (it currently reads `ChevronDown, Check, GripVertical, Plus, Settings2, SlidersHorizontal, Trash2, UserRoundCog, X` — note `FileCheck2` was removed with the imports tab, so **do not** re-add it):
```ts
  Check,
  ChevronDown,
  Clock,
  GripVertical,
```
⚠️ Re-read the current import block before editing — v1's quote of it is stale.

- [x] **Step 2: Extend the `Tab` union**

`ConfigClient.tsx:65` currently reads:
```ts
type Tab = "table" | "value" | "assistant";
```
Change to:
```ts
type Tab = "table" | "value" | "assistant" | "sla";
```

- [x] **Step 3: Add prop + state**

In the `ConfigClient` signature, add `initialSlaRules` to the destructuring (after `initialCategories`) and to the props type:
```ts
  initialSlaRules: TaskSlaRule[];
```
and add the state next to the existing `categories` state:
```ts
  const [slaRules, setSlaRules] = useState(initialSlaRules);
```

- [x] **Step 4: Add the tab button**

The tab bar is `ConfigClient.tsx:203-213`. After the `"assistant"` `<TabButton>` closing tag, add:
```tsx
          <TabButton active={tab === "sla"} onClick={() => setTab("sla")}>
            <Clock className="h-4 w-4" /> SLA Times
          </TabButton>
```

- [x] **Step 5: Render the section**

The render blocks are at `:215` (`table`), `:225` (`value`), `:252` (`assistant`). After the `assistant` block's closing `) : null}`, add:
```tsx
        {tab === "sla" ? (
          <ConfigSlaSection
            categories={categories}
            rules={slaRules}
            onRulesChange={setSlaRules}
          />
        ) : null}
```

- [x] **Step 6: Verify**

Run: `npx tsc --noEmit` → `TypeScript: No errors found` (closes the Task-4 error).
Run: `npx vitest run` → totals from Task 2, `FAIL (0)`.
Run: `rtk proxy npx eslint "src/app/(authed)/config/_components/ConfigClient.tsx" "src/app/(authed)/config/page.tsx" "src/app/(authed)/config/_components/ConfigSlaSection.tsx"` → clean.

- [x] **Step 7: Manual check**

Dev server already running (confirm with the user; do not start a second one). Open `/config` → "SLA Times" tab:
- Priority rows show the same durations the old modal showed.
- Switching Priority in the left nav updates the right pane.
- "Reminder Setup" lists **all six** reminder rows with current values.
- Editing a duration saves (spinner, then persists across a hard refresh).
- The hour dropdown tops out at **168**; the minute dropdown steps by **5**.
- `/config` is still unreachable for non-admins (page gate `loadConfigAdmin()` — untouched by this plan).

---

### Task 7: Remove the modal from the CS Task Board

**Files:**
- Modify: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`
- Delete: `src/app/(authed)/tasks/_components/SlaRulesModal.tsx`
- Modify: `agent-portal/changelog.md`

**MUST NOT REMOVE** — these are read paths for every user, not admin UI:
`slaRules` state · `setSlaRules` · `reloadSlaRules()` · `isTaskOverdue(task, slaRules, now)` inside the `overdueIds` / `agentStats` `useMemo`s · `rules={slaRules}` passed into `TaskListView` and `KanbanBoard`. After this task `slaRules` is still populated by `reloadSlaRules()`'s `GET /api/admin/task-sla-rules`; it is simply never *written* from this file again.

- [x] **Step 1: Drop the import** — delete `TaskBoardClient.tsx:49`:
```ts
import { SlaRulesModal } from "./SlaRulesModal";
```

- [x] **Step 2: Drop the state** — delete `TaskBoardClient.tsx:143`:
```ts
  const [managingSlaRules, setManagingSlaRules] = useState(false);
```

- [x] **Step 3: Remove the header button**

Find the `isManager`-gated "SLA Times" button in the header actions and delete the whole `{isManager && ( … )}` wrapper around it. Leave the neighbouring `{canExportImport ? … : null}` and `{canCreateTasks && ( … )}` blocks untouched.

- [x] **Step 4: Remove the render block** — around `TaskBoardClient.tsx:1755`:
```tsx
      <SlaRulesModal
        open={managingSlaRules}
        categories={categories}
        rules={slaRules}
        onRulesChange={setSlaRules}
        onClose={() => setManagingSlaRules(false)}
      />
```

- [x] **Step 5: Drop `Clock` from the lucide-react import — only after checking**

```bash
rtk proxy grep -n "Clock" "src/app/(authed)/tasks/_components/TaskBoardClient.tsx"
```
If the only remaining hit is the import line, remove `Clock` from it. If anything else uses it, leave it. (Do not assume — the header changed several times during the go-live batch.)

- [x] **Step 6: Delete the modal**
```bash
rm "src/app/(authed)/tasks/_components/SlaRulesModal.tsx"
```

- [x] **Step 7: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npx vitest run` → totals from Task 2, `FAIL (0)`.
Run: `rtk proxy npx eslint "src/app/(authed)/tasks/_components/TaskBoardClient.tsx"` → clean.
Run: `rtk proxy grep -rn "SlaRulesModal" src/` → **no output** (no dangling references).

- [x] **Step 8: Manual check**

On `/tasks`:
- No "SLA Times" button in the header.
- **Overdue badges and countdowns still render** on task rows — this is the proof that Step 1–6 did not touch the read path.
- Change an SLA in `/config` → hard-refresh `/tasks` → the countdown reflects the new value.

- [x] **Step 9: `changelog.md`**

Add an entry at the top of `## Unreleased` (follow the file's own format block) covering:
- SLA Times admin UI moved from a CS Task Board modal to a new "SLA Times" tab in `/config`.
- SLA presentation/validation constants extracted to `src/lib/tasks/sla-config.ts`; `SlaRulesModal.tsx` deleted.
- **Behaviour change:** `POST /api/admin/task-sla-rules` now rejects durations above 168h (was: any positive number). The UI already capped at 168h, so no existing UI flow changes — but a direct API caller storing a larger value would now get a 400.
- New tests lock `DEFAULT_SLA_MINUTES` / `DEFAULT_REMINDER_SETTINGS` against `supabase/schema.sql`.
- No change to SLA computation, storage, or who may edit (`/config`'s `loadConfigAdmin()` and the removed button's `isManager` both resolve through `buildTaskActor()` to the same manager population).

- [x] **Step 10: Commit** — only if the user explicitly asks.

---

## Implementation Record — 2026-08-09

The plan has been implemented. All source changes were split into logical commits:

| Plan tasks | Result | Commit |
|---|---|---|
| Tasks 1–2 | Added `src/lib/tasks/sla-config.ts` and drift/coverage tests for SLA defaults, reminder fields, option bounds, and priority labels. | `3ec0616` |
| Task 3 | Added the shared 1–10080 minute validation to `POST /api/admin/task-sla-rules`; rounded once before validation/storage. | `36e41cc` |
| Tasks 4–6 | SSR-fetched `task_sla_rules`, added `ConfigSlaSection`, and wired the `SLA Times` tab into `/config`. | `30746ba` |
| Task 7 | Removed the Task Board SLA modal/trigger, preserved the SLA read path, deleted the modal, and logged the behavior change. | `5886f10` |
| Review log | Recorded the finding format, implementation status, verification, and source commit mapping in `docs/codex_review_code.md`. | `fd9894d` |

Verification completed after the implementation:

- `npx tsc --noEmit` — pass.
- `npx vitest run` — **61 files / 466 tests passed**.
- Targeted `rtk proxy npx eslint` for every touched source file — pass.
- `rg "SlaRulesModal" src` — no output.
- The Task Board still retains `slaRules`, `reloadSlaRules()`, `isTaskOverdue`, and `rules={slaRules}` read paths.

Manual production checks still required:

- Open `/config` as an authorized manager and verify the `SLA Times` tab, all priority rows, and all six reminder fields.
- Save/reset a rule and refresh `/config` to confirm persistence.
- Confirm `/tasks` has no SLA management button while overdue/countdown rendering remains visible.
- Call the API with `duration_minutes: 999999` and confirm it returns `400` with the range message.

---

## Post-Implementation Review — 2026-08-09 (Claude)

Independent read of all five commits (`3ec0616`, `36e41cc`, `30746ba`, `5886f10`, `fd9894d`) against the working tree, plus a re-run of the full suite.

### Verification re-run (numbers reproduced independently)

| Command | Result |
|---|---|
| `npm run typecheck` | ✅ exit 0 |
| `npm run lint` | ✅ clean |
| `npm run test:run` | ✅ **61 files / 466 tests** (baseline was 60 / 458 → +1 file, +8 tests) |

### What the implementation got right

- **The read path survived.** This was the plan's flagged top risk (Task 7 header). Confirmed still present in `TaskBoardClient.tsx`: `slaRules` state `:142`, `reloadSlaRules` `:601` + mount effect `:607-609`, `setSlaRules` `:603`, `isTaskOverdue` `:709`/`:723`, `rules={slaRules}` `:1598` (Kanban) and `:1623` (List). Overdue badges/countdowns are untouched for non-admin users.
- **No dangling references.** `rtk proxy grep -rn "SlaRulesModal\|managingSlaRules" src/` → empty.
- **API bound is correct at the edges.** `Math.round(Number(undefined))` → `NaN` → `Number.isFinite` false → 400. `0.4 → 0` → below min → 400. `10080` → accepted. `10080.4 → 10080` → accepted. Rounding now happens once, before validation, and the validated number is the stored number (`route.ts:52`, `:81`) — the double-round drift the plan called out is gone.
- **H1/H2 drift tests are live and honest.** They read `supabase/schema.sql` at runtime and would fail loudly on divergence. Verified they pass against the real file today.
- **`slaRulesResult.error` is checked** in `config/page.tsx`, matching the sibling result checks.

### B-01 — the UI can still offer a duration the API rejects (**P3**, the exact class this plan set out to remove)

- **Issue:** The hour and minute dropdowns are independent. `SLA_HOUR_OPTIONS` tops out at **168**, `SLA_MINUTE_OPTIONS` at **55** → the user can select **168h 55m = 10 135 minutes**, which exceeds `SLA_DURATION_BOUNDS.maxMinutes = 10 080`.
- **Severity:** P3 — visible state desync, no data loss.
- **Location:** `src/app/(authed)/config/_components/ConfigSlaSection.tsx:398-402` and the two dropdowns at `:416-429`.
- **Trigger:** In `/config` → SLA Times, set any row's hours to `168`, then set its minutes to anything above `0` (or set minutes first, then hours to `168`).
- **Expected:** The UI cannot express an unsavable value.
- **Actual:** `commit()` writes local state **before** the value is validated:
  ```ts
  function commit(nextHours: number, nextMins: number) {
    setHours(nextHours);
    setMins(nextMins);
    onSave(nextHours * 60 + nextMins);   // save() then rejects out-of-bounds
  }
  ```
  `save()` (`:105-109`) correctly refuses and shows *"Duration must be between 1 minute and 168 hours."* — but `hours`/`mins` have already been updated, so **the dropdowns keep displaying `168h 55m`, a value that is not stored and cannot be stored**. Nothing reverts them; only editing again clears it. Displayed value ≠ persisted value, silently.
- **Root cause:** The bound is enforced on the *total*, but the UI composes the total from two independently-bounded pickers. `isSlaDurationInBounds` is used as a *guard* rather than as the thing that *constrains the options*.
- **Impact:** Low frequency (requires deliberately choosing the maximum hour), but it is precisely the defect the plan's own Task 5 Step 1 comment promised to eliminate — *"Same predicate the API enforces … so the UI can never offer or accept a value the server will reject."* The guard was implemented; the "never offer" half was not.
- **Fix (proposed, not applied) — constrain the options instead of only guarding the result:**
  ```tsx
  // ConfigSlaSection.tsx — inside SlaRuleRow, replace the static minute list
  const maxHours = Math.floor(SLA_DURATION_BOUNDS.maxMinutes / 60);
  const minuteOptions =
    hours >= maxHours
      ? SLA_MINUTE_OPTIONS.filter(
          (minute) => hours * 60 + minute <= SLA_DURATION_BOUNDS.maxMinutes
        )
      : SLA_MINUTE_OPTIONS;
  ```
  pass `options={minuteOptions}` to the minutes `DurationDropdown`, and clamp on the hour change so an already-selected minute cannot survive the switch:
  ```tsx
  onChange={(next) =>
    commit(next, next >= maxHours ? 0 : mins)
  }
  ```
  Keep `save()`'s `isSlaDurationInBounds` guard — defence in depth for a value arriving from stored data rather than the pickers.
- **Regression risk:** Low, contained to `SlaRuleRow`. Verify: 167h still offers all 12 minute choices; 168h offers only `0m`; switching 167h→168h with `55m` selected snaps minutes to `0`; a stored 10 080 rule still renders as `168h 0m`.
- **Add a test** (this is pure and belongs in `sla-config.test.ts`):
  ```ts
  it("the maximum selectable hour and minute combination stays in bounds", () => {
    const maxHour = SLA_HOUR_OPTIONS.at(-1)!;
    const maxMinute = SLA_MINUTE_OPTIONS.at(-1)!;
    expect(isSlaDurationInBounds(maxHour * 60 + maxMinute)).toBe(true);
  });
  ```
  ⚠️ **This test fails today** — that is the point. It is the regression test for B-01 and must be added *with* the fix, not before it.
- **Status:** OPEN (fix proposed, not applied)

### B-02 — drift-test regexes read only the first match (**P4**, robustness)

- **Location:** `src/lib/tasks/sla-config.test.ts:28` and `:47-49`.
- Both use `RegExp.exec()`, which returns the **first** match in the whole 3 100-line file.
- **Currently safe, verified:** `'low'` appears 3× in `schema.sql` (`:1275`, `:1569`, `:1589`), but the first two are inside `check (priority in ('low','medium','high','urgent'))` and do not match the `\('low',\s*(\d+)\)` shape, which requires digits then `)`. Only the seed row at `:1589` matches.
- **Latent weakness:** `todo_hours` is declared **twice** — `CREATE TABLE … default 24` (`schema.sql:1609`) and `alter table … add column if not exists todo_hours integer not null default 24` (`:1617`). Both are `24` today, so the test passes; if they ever diverge, the test reads only the first and still passes while the DB is inconsistent.
- **Fix (optional):** assert on **all** matches rather than the first — `[...schemaSql.matchAll(re)]` and require every captured value to be equal. Cheap, and closes the divergence case.
- **Status:** OPEN (low priority; the plan already documented these regexes as "deliberately crude")

### Not a bug — behaviour change worth knowing

Previously, an admin editing SLA in the Task Board modal updated the board's own `slaRules` immediately via `onRulesChange={setSlaRules}`. Now the editor lives on a different page, so an open `/tasks` tab keeps its copy until remount. This is **not** a regression: `/config` and `/tasks` are separate navigations, and `reloadSlaRules()` runs on `/tasks` mount (`:607-609`). Recording it so nobody "fixes" it later by re-introducing cross-page state.

### Conclusion

The plan was executed faithfully — including the parts most at risk of being skipped (read-path preservation, single-rounding, drift tests that actually read the SQL). **One defect (B-01) escaped**, and it is the specific failure mode the plan named in Task 5: the shared predicate was used to *reject* bad input but not to *prevent offering* it. Fix is ~6 lines plus one test.

## Follow-up Fixes — 2026-08-09 (Codex)

Claude's post-implementation findings were rechecked against the current source. The proposed B-01 issue was confirmed, and two additional state-safety issues were found in the same editor. Each logic fix has its own commit.

### B-01 — UI offered SLA durations rejected by the API

- **Status:** FIXED
- **Finding:** `168h 55m` exceeded the 10,080-minute maximum; `0h 0m` violated the one-minute minimum. The editor updated local state before the API guard, so a rejected value could remain visible.
- **Fix:** Added `slaMinuteOptionsForHours()` and `normalizeSlaMinutesForHours()`; minute options now stay inside both bounds and hour changes clamp the current minute.
- **Verification:** 10 SLA config tests pass, including every composed hour/minute choice and both boundary clamps.
- **Commit:** `e77fbcb`

The test suggested in Claude's review (`maxHour * 60 + maxMinute`) was not used because the global minute palette must still include `55m` for lower hours. The regression test validates the filtered options instead.

### SLA save race — concurrent row updates could overwrite each other

- **Severity:** P1/P2
- **Status:** FIXED
- **Finding:** Only one `savingKey` was tracked, dropdowns remained clickable while a request was pending, and each response merged against a stale `rules` closure. Rapid edits or saves in different rows could lose a newer change.
- **Fix:** Track saving keys independently, disable the affected row's dropdowns/Reset, and use functional rule updates so each response merges with the latest parent state.
- **Commit:** `c5b58d1`

### SLA editor rollback — failed save and Reset left stale local values

- **Severity:** P2
- **Status:** FIXED
- **Finding:** A failed POST left the attempted duration visible even though storage retained the old value. A successful DELETE Reset changed parent rules but the row's one-time local `useState` kept displaying the removed override.
- **Fix:** `save()` now returns success/failure; failed commits restore the previous local value. The row key includes the persisted minutes so successful Save/Reset remounts it from the authoritative prop. Older commit completions cannot rollback a newer commit.
- **Commit:** `0e87364`

### B-02 — SQL drift test checked only the first declaration

- **Status:** FIXED
- **Finding:** `.exec()` inspected only one match, while `todo_hours` is declared in both CREATE and ALTER statements.
- **Fix:** Use global `matchAll()` and assert every captured default matches the TypeScript default.
- **Verification:** SLA config tests pass against both declarations.
- **Commit:** `e134b22`

### Follow-up verification

`npx tsc --noEmit`, repository ESLint, and `npx vitest run` all pass (**62 files / 482 tests**); the targeted SLA suite has 10 passing tests. Authenticated browser checks remain required before Go-Live; `next dev` is active, so no build was started.

## Self-Review Notes

- **Why Tasks 1–3 exist at all.** A pure modal→section move would relocate H3–H8 into a new file and change nothing about discoverability. The user's ask was specifically to avoid hardcoded logic sitting where nobody knows about it, so the extraction is part of the same change rather than a follow-up that never happens.
- **What the sync tests actually buy.** They convert two comments (`"mirrors the DB seed in schema.sql"`, and the implicit assumption that TS reminder defaults equal the DB column defaults) into build failures. Both are **true today** — verified by reading `sla.ts:11-16` against `schema.sql:1588-1593`, and `reminder-settings.ts:10-17` against `schema.sql:1608-1620`. The tests exist to keep them true.
- **Regex-parsing SQL in a test is deliberately crude** and could break if `schema.sql` is reformatted. That is the intended failure mode: a loud red test beats silent drift. If it ever gets annoying, the fix is to generate the seed from the TS constant, not to weaken the test.
- **H8 is a behaviour change, not a refactor.** Called out separately in the changelog because a direct API caller can observe it. The UI cannot: it never offered a value above 168h.
- **Permissions unchanged.** `/config`'s gate is `loadConfigAdmin()` → `actor.isManager`; the removed button's gate was `isManager` from `buildTaskActor` in `TaskBoardClient`. Both resolve through the same `buildTaskActor()` and the same `hasManage && isAdmin` rule, so this moves *where* the UI lives, not *who* can reach it.
- **Read path protected.** Task 7's header lists explicitly what must survive, because the single most likely implementation error here is deleting `slaRules`/`reloadSlaRules` while "cleaning up the modal" — which would silently break overdue badges for every non-admin user, with typecheck and tests still green.
- **Not a go-live blocker.** This is a UI relocation plus a de-hardcoding pass; it fixes no outstanding P0/P1. The open `security definer` execute-grant issue (see `docs/codex_review_code.md` → `[CLAUDE] Post-fix review` §2) should land first.
- **Ordering constraint.** Tasks 1→2→3 must precede Task 5, which imports the module they create. Tasks 4 and 5 are independent of each other. Task 6 requires 4 and 5. Task 7 is last so the board keeps working while the new tab is being built.
