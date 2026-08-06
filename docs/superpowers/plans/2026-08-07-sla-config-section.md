# Move SLA Times into Table Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the "SLA Times" admin UI (SLA duration rules per priority/category + reminder timing settings) out of its own modal on the CS Task Board header and into a new tab inside `/config` (Health Table Configuration), alongside Table Columns / Dropdown Values / Assistant Membership / Data Import Review.

**Architecture:** `/config`'s `ConfigClient.tsx` already renders 4 tabs, each backed by its own section component and (mostly) server-fetched initial data from `config/page.tsx`. This plan adds a 5th tab, `"sla"`, backed by a new `ConfigSlaSection.tsx` component that is the existing `SlaRulesModal.tsx` content with the modal chrome (backdrop, dialog wrapper, header with a close button) stripped off and replaced with the same plain `<section>` wrapper the other tabs use. `task_sla_rules` gets SSR-fetched in `config/page.tsx` alongside the other initial data, matching how `task_categories` is already fetched there.

The CS Task Board (`TaskBoardClient.tsx`) keeps its own `slaRules` state, its `reloadSlaRules()` fetch, and every place that *reads* `slaRules` (`isTaskOverdue`, the props passed into `TaskListView`/`KanbanBoard`) — those are unrelated to the admin-editing UI and must not be touched. Only the modal, the button that opens it, and the `managingSlaRules` open/close state are removed.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, Supabase (service-role client), Tailwind.

## Global Constraints

- Never run `next build` while the dev server may be running.
- Before deleting `.next`, confirm with the user the dev server is fully stopped.
- Only push to `origin` automatically; push to `vercel` only if explicitly asked.
- Log this change in `agent-portal/changelog.md` (this is a logic-relevant move: it changes who can reach the SLA-editing UI and how, even though the underlying `task_sla_rules`/reminder-settings business logic is untouched).
- After every task: `npx tsc --noEmit`, `npx vitest run`, and `rtk proxy npx eslint <touched files>` must all be clean before moving to the next task.
- Reply to the user in Vietnamese, concise, once the plan is executed.

---

### Task 1: SSR-fetch `task_sla_rules` in `config/page.tsx`

**Files:**
- Modify: `src/app/(authed)/config/page.tsx`

**Interfaces:**
- Produces: a new `initialSlaRules: TaskSlaRule[]` prop passed into `<ConfigClient>`, matching the exact row shape `GET /api/admin/task-sla-rules` already returns (`id, priority, category_id, duration_minutes`) — see `src/app/api/admin/task-sla-rules/route.ts:22-28`.

- [ ] **Step 1: Add `TaskSlaRule` to the existing type import**

In `src/app/(authed)/config/page.tsx`, change:

```ts
import type { TaskCategory } from "@/lib/tasks/types";
```

to:

```ts
import type { TaskCategory, TaskSlaRule } from "@/lib/tasks/types";
```

- [ ] **Step 2: Add the `task_sla_rules` fetch to the existing `Promise.all`**

In the same file, the current fetch block is:

```ts
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
    // Đếm usage TỐI GIẢN — KHÔNG load nguyên enrollment records.
    supabase
      .from("enrollment_records")
      .select("program,stage_id,carrier_id,platform_id,consent_id,payment_status_id,aca_status_id")
      .is("archived_at", null),
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

Replace it with (adds `slaRulesResult` to both the destructured array and the `Promise.all` array, plus its own error check):

```ts
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
    // Đếm usage TỐI GIẢN — KHÔNG load nguyên enrollment records.
    supabase
      .from("enrollment_records")
      .select("program,stage_id,carrier_id,platform_id,consent_id,payment_status_id,aca_status_id")
      .is("archived_at", null),
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

- [ ] **Step 3: Pass the new prop into `<ConfigClient>`**

The current return statement:

```ts
  return (
    <ConfigClient
      initialColumns={columns}
      initialOptions={options}
      initialAgents={agents}
      candidates={candidates}
      assignees={assignees}
      initialMembers={(memberResult.data ?? []).map((row) => {
        const member = row as {
          agent_email: string;
          cs_email: string;
          is_assistant: boolean;
        };
        return member;
      })}
      initialCategories={(categoriesResult.data ?? []) as TaskCategory[]}
      initialOptionData={{ aca: acaOptionData, medicare: medicareOptionData }}
      enrollmentUsageCounts={{ aca: buildUsageCounts("aca"), medicare: buildUsageCounts("medicare") }}
    />
  );
```

Add `initialSlaRules` right after `initialCategories`:

```ts
  return (
    <ConfigClient
      initialColumns={columns}
      initialOptions={options}
      initialAgents={agents}
      candidates={candidates}
      assignees={assignees}
      initialMembers={(memberResult.data ?? []).map((row) => {
        const member = row as {
          agent_email: string;
          cs_email: string;
          is_assistant: boolean;
        };
        return member;
      })}
      initialCategories={(categoriesResult.data ?? []) as TaskCategory[]}
      initialSlaRules={(slaRulesResult.data ?? []) as TaskSlaRule[]}
      initialOptionData={{ aca: acaOptionData, medicare: medicareOptionData }}
      enrollmentUsageCounts={{ aca: buildUsageCounts("aca"), medicare: buildUsageCounts("medicare") }}
    />
  );
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: a new error in `ConfigClient.tsx` saying `initialSlaRules` does not exist on the props type — that's expected, Task 3 adds it. Confirm there are no OTHER new errors from this file (i.e. the only new error is the one caused by the not-yet-updated `ConfigClient` props).

---

### Task 2: Create `ConfigSlaSection.tsx` (adapted from `SlaRulesModal.tsx`)

**Files:**
- Create: `src/app/(authed)/config/_components/ConfigSlaSection.tsx`
- Read (for reference, not modified in this task): `src/app/(authed)/tasks/_components/SlaRulesModal.tsx`

**Interfaces:**
- Consumes: `TaskCategory[]`, `TaskSlaRule[]` from `@/lib/tasks/types`; `DEFAULT_SLA_MINUTES`, `formatDurationMinutes`, `resolveSlaMinutes` from `@/lib/tasks/sla`; `DEFAULT_REMINDER_SETTINGS`, `type ReminderSettings` from `@/lib/tasks/reminder-settings`; `taskCategoryPalette` from `@/lib/tasks/category-colors`; `useAnchoredMenu` from `../../tasks/_components/use-anchored-menu` (the hook lives under `tasks/_components`, this file lives under `config/_components` — the relative import must cross that boundary).
- Produces: `export function ConfigSlaSection({ categories, rules, onRulesChange }: { categories: TaskCategory[]; rules: TaskSlaRule[]; onRulesChange: (rules: TaskSlaRule[]) => void })` — a plain in-page `<section>`, no `open`/`onClose` (the parent only mounts it while its tab is active, so there is no separate "closed" state to model).

This is the entire content of `SlaRulesModal.tsx` (lines 1-579, already read in full) with exactly these changes:
1. Drop the `open`/`onClose` props and the `if (!open) return null;` early return.
2. Drop the `useEffect`'s `if (!open) return;` guard at the top (the effect now just runs on mount, since mount only happens when the tab is active).
3. Replace the outer `<div className="fixed inset-0 z-50 ...">` backdrop + inner `role="dialog"` wrapper + `<header>` (icon, title, subtitle, X-close button) with a `<section>` wrapper matching `ConfigTableSection`'s convention (`src/app/(authed)/config/_components/ConfigClient.tsx:522-529`).
4. Keep `SlaRuleRow`, `ReminderSettingRow`, `DurationDropdown`, `PRIORITY_LABEL`, `DEFAULT_ROW_KEY`, `HOUR_OPTIONS`, `MINUTE_OPTIONS`, `REMINDER_ROWS`, `formatDuration`, `ReminderSettingsResponse`, `SettingsView`, and every piece of `save`/`reset`/`saveReminderSetting`/`loadReminderSettings` logic byte-for-byte identical — only the outer chrome changes.

- [ ] **Step 1: Write the file**

```tsx
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Loader2, RotateCcw, Clock } from "lucide-react";
import {
  TASK_PRIORITIES,
  type TaskCategory,
  type TaskPriority,
  type TaskSlaRule,
} from "@/lib/tasks/types";
import {
  DEFAULT_SLA_MINUTES,
  formatDurationMinutes,
  resolveSlaMinutes,
} from "@/lib/tasks/sla";
import { taskCategoryPalette } from "@/lib/tasks/category-colors";
import {
  DEFAULT_REMINDER_SETTINGS,
  type ReminderSettings,
} from "@/lib/tasks/reminder-settings";
import { useAnchoredMenu } from "../../tasks/_components/use-anchored-menu";

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const DEFAULT_ROW_KEY = "__default__";
const HOUR_OPTIONS = Array.from({ length: 169 }, (_, i) => i); // 0-168h (1 week)
const MINUTE_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const REMINDER_ROWS: Array<{
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

  const rows = [{ id: DEFAULT_ROW_KEY, name: "Default (no category)", color: null }, ...categories];

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
    if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
      setError("Duration must be greater than 0 minutes.");
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
          {TASK_PRIORITIES.map((p) => {
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
                {PRIORITY_LABEL[p]}
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
                const categoryId = row.id === DEFAULT_ROW_KEY ? null : row.id;
                const key = `${priority}:${row.id}`;
                const saving = savingKey === key;
                return (
                  <SlaRuleRow
                    key={key}
                    label={row.name}
                    color={row.color}
                    minutes={minutesFor(categoryId)}
                    showReset={row.id !== DEFAULT_ROW_KEY && hasOverride(categoryId)}
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
                {REMINDER_ROWS.map((row) => (
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

function ReminderSettingRow({
  label,
  value,
  unit,
  saving,
  disabled,
  onSave,
}: {
  label: string;
  value: number;
  unit: string;
  saving: boolean;
  disabled: boolean;
  onSave: (value: number) => void;
}) {
  function commit(input: HTMLInputElement) {
    const next = Number(input.value);
    if (!Number.isFinite(next) || next <= 0) {
      input.value = String(value);
      return;
    }

    const rounded = Math.round(next);
    input.value = String(rounded);
    if (rounded !== value) onSave(rounded);
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded border border-[#dfe1e6] bg-white px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#172b4d]">
        {label}
      </span>
      <label className="flex h-8 w-[6.25rem] shrink-0 items-center rounded border-2 border-[#dfe1e6] bg-white px-2 text-sm font-semibold text-[#172b4d] transition focus-within:border-[#0c66e4]">
        <input
          type="number"
          min={1}
          step={1}
          defaultValue={value}
          disabled={disabled || saving}
          aria-label={label}
          onBlur={(event) => commit(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.currentTarget.value = String(value);
              event.currentTarget.blur();
            }
          }}
          className="min-w-0 flex-1 bg-transparent outline-none disabled:cursor-not-allowed disabled:text-[#97a0af]"
        />
        <span className="ml-1 shrink-0 text-[#6b778c]">{unit}</span>
      </label>
      {saving ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0c66e4]" />
      ) : (
        <span className="w-4 shrink-0" />
      )}
    </li>
  );
}

function SlaRuleRow({
  label,
  color,
  minutes,
  showReset,
  saving,
  onSave,
  onReset,
}: {
  label: string;
  color: string | null;
  minutes: number;
  showReset: boolean;
  saving: boolean;
  onSave: (totalMinutes: number) => void;
  onReset: () => void;
}) {
  const [hours, setHours] = useState(Math.floor(minutes / 60));
  const [mins, setMins] = useState(minutes % 60);
  const palette = color
    ? taskCategoryPalette({ id: label, name: label, color })
    : null;

  function commit(nextHours: number, nextMins: number) {
    setHours(nextHours);
    setMins(nextMins);
    onSave(nextHours * 60 + nextMins);
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded border border-[#dfe1e6] bg-white px-3 py-2">
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-sm font-semibold text-[#172b4d]">
        {palette ? (
          <span
            className="h-3 w-3 shrink-0 rounded-sm"
            style={{ backgroundColor: palette.background }}
          />
        ) : null}
        <span className="min-w-0 truncate">
          {label}
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        <DurationDropdown
          value={hours}
          options={HOUR_OPTIONS}
          suffix="h"
          ariaLabel={`${label} — hours`}
          onChange={(next) => commit(next, mins)}
        />
        <DurationDropdown
          value={mins}
          options={MINUTE_OPTIONS}
          suffix="m"
          ariaLabel={`${label} — minutes`}
          onChange={(next) => commit(hours, next)}
        />
      </div>
      {showReset ? (
        <button
          type="button"
          title="Reset to default"
          onClick={onReset}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#6b778c] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span className="w-7 shrink-0" />
      )}
      {saving ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0c66e4]" />
      ) : (
        <span className="w-4 shrink-0" />
      )}
    </li>
  );
}

function DurationDropdown({
  value,
  options,
  suffix,
  ariaLabel,
  onChange,
}: {
  value: number;
  options: number[];
  suffix: string;
  ariaLabel: string;
  onChange: (value: number) => void;
}) {
  const { isOpen, setIsOpen, toggle, triggerRef, menuRef, menuStyle } = useAnchoredMenu();

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className={`flex h-8 w-[4.5rem] shrink-0 items-center justify-between gap-1 rounded border-2 px-2 text-sm font-semibold transition ${
          isOpen
            ? "border-[#0c66e4] text-[#172b4d]"
            : "border-[#dfe1e6] text-[#172b4d] hover:border-[#c1c7d0]"
        }`}
      >
        <span>
          {value}
          {suffix}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[#7a869a] transition ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              aria-label={ariaLabel}
              style={menuStyle}
              className="z-[100] max-h-56 w-20 overflow-auto rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_12px_32px_rgba(9,30,66,0.18)]"
            >
              {options.map((option) => {
                const selected = option === value;
                return (
                  <button
                    key={option}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(option);
                      setIsOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm transition ${
                      selected
                        ? "bg-[#e9f2ff] font-semibold text-[#0c66e4]"
                        : "text-[#172b4d] hover:bg-[#f4f5f7]"
                    }`}
                  >
                    {option}
                    {selected ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
```

Note the `Clock` import is unused in this draft (the icon moves to the tab button in Task 3, not the section header) — remove it from the import line so lint stays clean:

```ts
import { Check, ChevronDown, Loader2, RotateCcw } from "lucide-react";
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no NEW errors from `ConfigSlaSection.tsx` itself (the file isn't imported anywhere yet, so it just needs to type-check standalone). The Task-1-caused error in `ConfigClient.tsx` about the missing `initialSlaRules` prop is still expected at this point.

Run: `rtk proxy npx eslint "src/app/(authed)/config/_components/ConfigSlaSection.tsx"`
Expected: clean (no unused-import warnings — this is exactly why the `Clock` import was dropped in Step 1).

---

### Task 3: Wire the new tab into `ConfigClient.tsx`

**Files:**
- Modify: `src/app/(authed)/config/_components/ConfigClient.tsx`

**Interfaces:**
- Consumes: `ConfigSlaSection` from `./ConfigSlaSection` (Task 2); `initialSlaRules: TaskSlaRule[]` prop (Task 1).
- Produces: `slaRules` state + `setSlaRules` setter available to the new tab.

- [ ] **Step 1: Import `TaskSlaRule` and `ConfigSlaSection`**

Change:

```ts
import type { TaskCategory } from "@/lib/tasks/types";
```

to:

```ts
import type { TaskCategory, TaskSlaRule } from "@/lib/tasks/types";
```

Add, near the other `_components`-relative imports (there are none yet in this file — add it right after the `enrollment/types` import block, i.e. after the closing `} from "@/lib/enrollment/types";` line):

```ts
import { ConfigSlaSection } from "./ConfigSlaSection";
```

- [ ] **Step 2: Add `Clock` to the lucide-react import**

Change:

```ts
import {
  ChevronDown,
  Check,
  FileCheck2,
  GripVertical,
  Plus,
  Settings2,
  SlidersHorizontal,
  Trash2,
  UserRoundCog,
  X,
} from "lucide-react";
```

to:

```ts
import {
  ChevronDown,
  Check,
  Clock,
  FileCheck2,
  GripVertical,
  Plus,
  Settings2,
  SlidersHorizontal,
  Trash2,
  UserRoundCog,
  X,
} from "lucide-react";
```

- [ ] **Step 3: Extend the `Tab` union**

Change:

```ts
type Tab = "table" | "value" | "assistant" | "imports";
```

to:

```ts
type Tab = "table" | "value" | "assistant" | "imports" | "sla";
```

- [ ] **Step 4: Add the `initialSlaRules` prop and `slaRules` state**

In the `ConfigClient` function signature, change:

```ts
export function ConfigClient({
  initialColumns,
  initialOptions,
  initialAgents,
  candidates,
  assignees,
  initialMembers,
  initialCategories,
  initialOptionData,
  enrollmentUsageCounts,
}: {
  initialColumns: Record<TableScope, TableColumn[]>;
  initialOptions: Record<TableScope, TableColumnOption[]>;
  initialAgents: TaskAgent[];
  candidates: TaskAssignee[];
  assignees: TaskAssignee[];
  initialMembers: AssistantMember[];
  initialCategories: TaskCategory[];
  initialOptionData: Record<"aca" | "medicare", EnrollmentOptionData>;
  enrollmentUsageCounts: Record<"aca" | "medicare", Record<string, number>>;
}) {
  const [tab, setTab] = useState<Tab>("table");
  const [scope, setScope] = useState<TableScope>("cs");
  const [columns, setColumns] = useState(initialColumns);
  const [options, setOptions] = useState(initialOptions);
  const [agents, setAgents] = useState(initialAgents);
  const [members, setMembers] = useState(initialMembers);
  const [categories, setCategories] = useState(initialCategories);
  const [optionData, setOptionData] = useState(initialOptionData);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
```

to:

```ts
export function ConfigClient({
  initialColumns,
  initialOptions,
  initialAgents,
  candidates,
  assignees,
  initialMembers,
  initialCategories,
  initialSlaRules,
  initialOptionData,
  enrollmentUsageCounts,
}: {
  initialColumns: Record<TableScope, TableColumn[]>;
  initialOptions: Record<TableScope, TableColumnOption[]>;
  initialAgents: TaskAgent[];
  candidates: TaskAssignee[];
  assignees: TaskAssignee[];
  initialMembers: AssistantMember[];
  initialCategories: TaskCategory[];
  initialSlaRules: TaskSlaRule[];
  initialOptionData: Record<"aca" | "medicare", EnrollmentOptionData>;
  enrollmentUsageCounts: Record<"aca" | "medicare", Record<string, number>>;
}) {
  const [tab, setTab] = useState<Tab>("table");
  const [scope, setScope] = useState<TableScope>("cs");
  const [columns, setColumns] = useState(initialColumns);
  const [options, setOptions] = useState(initialOptions);
  const [agents, setAgents] = useState(initialAgents);
  const [members, setMembers] = useState(initialMembers);
  const [categories, setCategories] = useState(initialCategories);
  const [slaRules, setSlaRules] = useState(initialSlaRules);
  const [optionData, setOptionData] = useState(initialOptionData);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
```

- [ ] **Step 5: Add the tab button**

Change:

```tsx
        <div className="flex w-fit rounded bg-[#f1f2f4] p-1">
          <TabButton active={tab === "table"} onClick={() => setTab("table")}>
            <Settings2 className="h-4 w-4" /> Table Columns
          </TabButton>
          <TabButton active={tab === "value"} onClick={() => setTab("value")}>
            <SlidersHorizontal className="h-4 w-4" /> Dropdown Values
          </TabButton>
          <TabButton active={tab === "assistant"} onClick={() => setTab("assistant")}>
            <UserRoundCog className="h-4 w-4" /> Assistant Membership
          </TabButton>
          <TabButton active={tab === "imports"} onClick={() => setTab("imports")}>
            <FileCheck2 className="h-4 w-4" /> Data Import Review
          </TabButton>
        </div>
```

to:

```tsx
        <div className="flex w-fit rounded bg-[#f1f2f4] p-1">
          <TabButton active={tab === "table"} onClick={() => setTab("table")}>
            <Settings2 className="h-4 w-4" /> Table Columns
          </TabButton>
          <TabButton active={tab === "value"} onClick={() => setTab("value")}>
            <SlidersHorizontal className="h-4 w-4" /> Dropdown Values
          </TabButton>
          <TabButton active={tab === "assistant"} onClick={() => setTab("assistant")}>
            <UserRoundCog className="h-4 w-4" /> Assistant Membership
          </TabButton>
          <TabButton active={tab === "imports"} onClick={() => setTab("imports")}>
            <FileCheck2 className="h-4 w-4" /> Data Import Review
          </TabButton>
          <TabButton active={tab === "sla"} onClick={() => setTab("sla")}>
            <Clock className="h-4 w-4" /> SLA Times
          </TabButton>
        </div>
```

- [ ] **Step 6: Render the section when the tab is active**

Change:

```tsx
        {tab === "imports" ? (
          <ImportReviewSection scope={scope} busy={busy} run={run} />
        ) : null}
      </div>
    </main>
  );
}
```

to:

```tsx
        {tab === "imports" ? (
          <ImportReviewSection scope={scope} busy={busy} run={run} />
        ) : null}
        {tab === "sla" ? (
          <ConfigSlaSection
            categories={categories}
            rules={slaRules}
            onRulesChange={setSlaRules}
          />
        ) : null}
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found` — this closes out the `initialSlaRules`-missing error from Task 1.

Run: `npx vitest run`
Expected: `PASS (424) FAIL (0)` (no test touches this UI, so the count should be unchanged from before this plan).

Run: `rtk proxy npx eslint "src/app/(authed)/config/_components/ConfigClient.tsx" "src/app/(authed)/config/page.tsx" "src/app/(authed)/config/_components/ConfigSlaSection.tsx"`
Expected: clean.

- [ ] **Step 8: Manual check**

With the dev server running (confirm with the user it's already up — do not start a second one), open `/config`, click the new "SLA Times" tab, confirm:
- Priority rows show the same durations as the old modal did.
- Switching Priority in the left nav updates the right pane.
- "Reminder Setup" shows the 6 reminder rows with their current values.
- Editing a duration/reminder value saves (spinner appears briefly, value persists after a manual page refresh).
- The section is NOT reachable by anyone who can't reach `/config` at all (already true — `/config`'s page-level gate is `loadConfigAdmin()`, unchanged by this plan).

---

### Task 4: Remove the old modal trigger from the CS Task Board

**Files:**
- Modify: `src/app/(authed)/tasks/_components/TaskBoardClient.tsx`
- Delete: `src/app/(authed)/tasks/_components/SlaRulesModal.tsx`
- Modify: `agent-portal/changelog.md`

**Interfaces:**
- Consumes: nothing new.
- Removes: the `SlaRulesModal` import, the `managingSlaRules` state, the "SLA Times" header button, and the `<SlaRulesModal>` JSX block.
- **Must NOT remove:** `slaRules` state, `setSlaRules`, `reloadSlaRules()`, or any of the places `slaRules` is read (`isTaskOverdue(task, slaRules, now)` inside the `overdueIds`/stats `useMemo`s, and the `rules={slaRules}` props passed into `TaskListView`/`KanbanBoard`) — those are unrelated to the admin-editing UI; they're what makes overdue badges/countdowns render correctly for every user on the board, and stay exactly as they are today (still populated by `reloadSlaRules()`'s `GET /api/admin/task-sla-rules` call, now just never *written* to from this file anymore since the write UI moved to `/config`).

- [ ] **Step 1: Drop the `SlaRulesModal` import**

Delete this line (around line 48):

```ts
import { SlaRulesModal } from "./SlaRulesModal";
```

- [ ] **Step 2: Drop `Clock` from the lucide-react import**

Change:

```ts
import { ChevronDown, Clock, Download, FileUp, Loader2, Plus } from "lucide-react";
```

to:

```ts
import { ChevronDown, Download, FileUp, Loader2, Plus } from "lucide-react";
```

(`Clock` is only used inside the button removed in Step 4 below — confirm with `rtk proxy grep -n "Clock" src/app/(authed)/tasks/_components/TaskBoardClient.tsx` after Step 4 that no other usage remains before deleting the import, in case something changed between when this plan was written and when it's executed.)

- [ ] **Step 3: Drop the `managingSlaRules` state**

Delete this line (around line 127):

```ts
  const [managingSlaRules, setManagingSlaRules] = useState(false);
```

- [ ] **Step 4: Remove the "SLA Times" button**

Find and delete this whole block (around line 1259-1272):

```tsx
                {isManager && (
                  <>
                    <button
                      type="button"
                      onClick={() => setManagingSlaRules(true)}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d8dee8] bg-white px-3 text-sm font-bold text-[#42526e] shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4]"
                    >
                      <Clock className="h-4 w-4" />
                      SLA Times
                    </button>
                  </>
                )}
```

Leave the surrounding `{canCreateTasks && (...)}` and `{canExportImport ? (...) : null}` blocks exactly as they are (those are the "New task" and "Import / Export" buttons from the earlier button-order fix — this task doesn't touch them).

- [ ] **Step 5: Remove the `<SlaRulesModal>` render block**

Find and delete (around line 1471-1477 — check the exact current line numbers first, since earlier edits in this session shifted them):

```tsx
      <SlaRulesModal
        open={managingSlaRules}
        categories={categories}
        rules={slaRules}
        onRulesChange={setSlaRules}
        onClose={() => setManagingSlaRules(false)}
      />
```

- [ ] **Step 6: Delete `SlaRulesModal.tsx`**

```bash
rm "src/app/(authed)/tasks/_components/SlaRulesModal.tsx"
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`.

Run: `npx vitest run`
Expected: `PASS (424) FAIL (0)`.

Run: `rtk proxy npx eslint "src/app/(authed)/tasks/_components/TaskBoardClient.tsx"`
Expected: clean (no unused `isManager`-only-used-here regression — `isManager` is used elsewhere in this file for other gates, so it stays imported/used; only confirm no other now-unused symbol was left behind).

- [ ] **Step 8: Manual check**

On `/tasks`, confirm:
- The "SLA Times" button is gone from the header (only "Import / Export" then "New task" remain, per the earlier fix).
- Overdue badges/countdowns on task rows still render correctly (proves `slaRules`/`reloadSlaRules` still work — unaffected by this task).

- [ ] **Step 9: Update `changelog.md`**

Add a new entry at the top of the `## Unreleased` section (see the file's own format block at the top for the exact template) describing: SLA Times admin UI moved from a CS Task Board modal into a new "SLA Times" tab inside `/config`; no change to `task_sla_rules`/reminder-settings business logic, storage, or who can edit them (`/config`'s gate and the old button's `isManager` gate resolve to the identical manager population, both ultimately from `buildTaskActor`); CS Task Board keeps computing overdue state from `slaRules` exactly as before.

- [ ] **Step 10: Commit**

Only if the user has asked for a commit — this plan's Global Constraints note commits/pushes happen only when explicitly requested, matching this session's standing instructions.

---

## Self-Review Notes

- **Spec coverage:** "SLA Times" (both the priority/category duration rules AND the Reminder Setup sub-view) moves into `/config` as a new section — covered by Task 2 (full content ported) and Task 3 (tab wiring). The trigger button and modal are removed from the CS board — covered by Task 4. Nothing about `task_sla_rules`/reminder-settings *logic* changes — confirmed no task touches `lib/tasks/sla.ts`, `lib/tasks/reminder-settings.ts`, `api/admin/task-sla-rules/route.ts`, or `api/admin/task-reminder-settings/route.ts`.
- **Permissions:** verified `/config`'s page-level gate (`loadConfigAdmin` → `canManageEnrollmentOptions` → `actor.isManager`) and the old button's gate (`isManager` from `buildTaskActor` in `TaskBoardClient`) resolve through the exact same `buildTaskActor()` function and the same `hasManage && isAdmin` rule — so this move changes *where* the UI lives, not *who* can reach it. This is called out explicitly in Task 4's header and in the changelog entry (Step 9) so it isn't silently assumed.
- **What must NOT move:** `slaRules` state/fetch/read-usage in `TaskBoardClient.tsx` (overdue computation) is explicitly called out as out-of-scope in Task 4's header to prevent an implementer from deleting it by mistake while cleaning up the modal.
