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
  SLA_PRIORITY_ORDER,
  TASK_PRIORITY_LABEL,
  isSlaDurationInBounds,
  normalizeSlaMinutesForHours,
  slaMinuteOptionsForHours,
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
  const minuteOptions = slaMinuteOptionsForHours(hours);
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
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        <DurationDropdown
          value={hours}
          options={SLA_HOUR_OPTIONS}
          suffix="h"
          ariaLabel={`${label} — hours`}
          onChange={(next) => commit(next, normalizeSlaMinutesForHours(next, mins))}
        />
        <DurationDropdown
          value={mins}
          options={minuteOptions}
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
  options: readonly number[];
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
