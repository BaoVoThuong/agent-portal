"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Loader2, RotateCcw, X, Clock } from "lucide-react";
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
import {
  DEFAULT_REMINDER_SETTINGS,
  type ReminderSettings,
} from "@/lib/tasks/reminder-settings";
import { useAnchoredMenu } from "./use-anchored-menu";

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
];

type ReminderSettingsResponse = {
  settings?: ReminderSettings;
  error?: string;
};

type SettingsView = "priority" | "reminders";

function formatDuration(minutes: number): string {
  return formatDurationMinutes(minutes);
}

export function SlaRulesModal({
  open,
  categories,
  rules,
  onRulesChange,
  onClose,
}: {
  open: boolean;
  categories: TaskCategory[];
  rules: TaskSlaRule[];
  onRulesChange: (rules: TaskSlaRule[]) => void;
  onClose: () => void;
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
    if (!open) return;

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
  }, [open]);

  if (!open) return null;

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/45 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[min(680px,calc(100vh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded bg-white shadow-[0_18px_54px_rgba(9,30,66,0.34)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-[#dfe1e6] bg-[#fafbfc] px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-[#deebff] text-[#0c66e4]">
              <Clock className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold text-[#172b4d]">SLA Times</h2>
              <p className="mt-1 text-xs font-semibold text-[#626f86]">
                Time before an In Progress task becomes Overdue
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-[#dfe1e6] md:grid-cols-[14rem_minmax(0,1fr)] md:divide-x md:divide-y-0">
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
      </div>
    </div>
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
  minutes,
  showReset,
  saving,
  onSave,
  onReset,
}: {
  label: string;
  minutes: number;
  showReset: boolean;
  saving: boolean;
  onSave: (totalMinutes: number) => void;
  onReset: () => void;
}) {
  const [hours, setHours] = useState(Math.floor(minutes / 60));
  const [mins, setMins] = useState(minutes % 60);

  function commit(nextHours: number, nextMins: number) {
    setHours(nextHours);
    setMins(nextMins);
    onSave(nextHours * 60 + nextMins);
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded border border-[#dfe1e6] bg-white px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#172b4d]">
        {label}
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
