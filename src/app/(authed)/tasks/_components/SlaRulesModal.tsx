"use client";

import { useMemo, useState } from "react";
import { Check, Clock, Loader2, X } from "lucide-react";
import {
  TASK_PRIORITIES,
  type TaskCategory,
  type TaskPriority,
  type TaskSlaRule,
} from "@/lib/tasks/types";
import { DEFAULT_SLA_MINUTES, resolveSlaMinutes } from "@/lib/tasks/sla";

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const DEFAULT_ROW_KEY = "__default__";
const MINUTES_PER_HOUR = 60;

function formatHours(hours: number): string {
  return `${Number(hours.toFixed(2))}h`;
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
  const [priority, setPriority] = useState<TaskPriority>("urgent");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () => [{ id: DEFAULT_ROW_KEY, name: "Default (no category)", color: null }, ...categories],
    [categories]
  );

  if (!open) return null;

  function hoursFor(categoryId: string | null): number {
    return resolveSlaMinutes(priority, categoryId, rules) / MINUTES_PER_HOUR;
  }

  async function save(categoryId: string | null, hours: number, key: string) {
    if (!Number.isFinite(hours) || hours <= 0) return;
    setSavingKey(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/task-sla-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priority,
          category_id: categoryId,
          duration_minutes: Math.round(hours * MINUTES_PER_HOUR),
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
                Hours before an In Progress task becomes Overdue
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
              const active = p === priority;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
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
          </section>

          <section className="flex min-h-0 flex-col overflow-y-auto p-4">
            <ul className="space-y-1.5">
              {rows.map((row) => {
                const categoryId = row.id === DEFAULT_ROW_KEY ? null : row.id;
                const key = `${priority}:${row.id}`;
                const saving = savingKey === key;
                return (
                  <SlaRuleRow
                    key={key}
                    label={row.name}
                    hours={hoursFor(categoryId)}
                    saving={saving}
                    onSave={(hours) => save(categoryId, hours, key)}
                  />
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-[#97a0af]">
              System default: {formatHours(DEFAULT_SLA_MINUTES[priority] / MINUTES_PER_HOUR)}.
              Categories without an override use the &quot;Default&quot; row above.
            </p>
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

function SlaRuleRow({
  label,
  hours,
  saving,
  onSave,
}: {
  label: string;
  hours: number;
  saving: boolean;
  onSave: (hours: number) => void;
}) {
  const [draft, setDraft] = useState(String(hours));

  return (
    <li className="flex items-center justify-between gap-3 rounded border border-[#dfe1e6] bg-white px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#172b4d]">
        {label}
      </span>
      <input
        type="number"
        min={0.25}
        step={0.25}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = Number(draft);
          if (next !== hours) onSave(next);
        }}
        className="h-8 w-20 shrink-0 rounded border-2 border-[#dfe1e6] px-2 text-right text-sm font-semibold text-[#172b4d] outline-none focus:border-[#0c66e4]"
      />
      <span className="w-12 shrink-0 text-xs text-[#97a0af]">hours</span>
      {saving ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0c66e4]" /> : null}
    </li>
  );
}
