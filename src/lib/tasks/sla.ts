// Pure SLA resolution + overdue computation. "Overdue" is never stored — a
// task is overdue when it's in_progress and now() has passed
// in_progress_at + the resolved SLA duration. No cron: this is recomputed
// wherever it's needed (board render, filters).
import type { TaskPriority, TaskRow, TaskSlaRule } from "./types";

// Fallback if rules haven't loaded yet — mirrors the DB seed in schema.sql.
export const DEFAULT_SLA_MINUTES: Record<TaskPriority, number> = {
  low: 1440,
  medium: 480,
  high: 240,
  urgent: 60,
};

export function resolveSlaMinutes(
  priority: TaskPriority,
  categoryId: string | null,
  rules: Pick<TaskSlaRule, "priority" | "category_id" | "duration_minutes">[]
): number {
  if (categoryId) {
    const exact = rules.find(
      (r) => r.priority === priority && r.category_id === categoryId
    );
    if (exact) return exact.duration_minutes;
  }
  const fallback = rules.find(
    (r) => r.priority === priority && r.category_id === null
  );
  if (fallback) return fallback.duration_minutes;
  return DEFAULT_SLA_MINUTES[priority];
}

export function slaDeadline(inProgressAt: string, minutes: number): Date {
  return new Date(new Date(inProgressAt).getTime() + minutes * 60_000);
}

// Prefers the snapshot taken when the task first entered In Progress over a
// live recomputation from the task's current priority/category. The budget is
// locked once (see transitions.ts), so editing priority/category on an
// already-started task never moves it — the same anti-gaming property, now
// permanent for the task's whole lifetime rather than per-run. Falls back to
// live resolution only for rows with no snapshot yet (never started, or
// predates this column).
export function effectiveSlaMinutes(
  task: Pick<TaskRow, "priority" | "category_id" | "sla_minutes">,
  rules: Pick<TaskSlaRule, "priority" | "category_id" | "duration_minutes">[]
): number {
  if (typeof task.sla_minutes === "number") return task.sla_minutes;
  return resolveSlaMinutes(task.priority, task.category_id, rules);
}

function secondsBetween(startIso: string, now: Date): number {
  const start = new Date(startIso).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.round((now.getTime() - start) / 1000));
}

type InProgressMeter = Pick<TaskRow, "status" | "in_progress_at"> & {
  in_progress_seconds?: number | null;
};

// Total seconds the task has spent In Progress across ALL stints: the banked
// accumulator plus the current open stint when it's In Progress right now.
// This is the single source of truth for "how much of the SLA budget has been
// burned" — it never decreases, so leaving and re-entering In Progress can't
// reset it.
export function inProgressConsumedSeconds(
  task: InProgressMeter,
  now: Date = new Date()
): number {
  const base = task.in_progress_seconds ?? 0;
  if (task.status === "in_progress" && task.in_progress_at) {
    return base + secondsBetween(task.in_progress_at, now);
  }
  return base;
}

// Seconds left before the SLA budget is exhausted. Negative once overdue —
// the magnitude is how long it's been overdue (counts up).
export function slaRemainingSeconds(
  task: Pick<TaskRow, "status" | "in_progress_at" | "priority" | "category_id"> & {
    sla_minutes?: number | null;
    in_progress_seconds?: number | null;
  },
  rules: Pick<TaskSlaRule, "priority" | "category_id" | "duration_minutes">[],
  now: Date = new Date()
): number {
  const budgetSeconds = effectiveSlaMinutes(
    { priority: task.priority, category_id: task.category_id, sla_minutes: task.sla_minutes ?? null },
    rules
  ) * 60;
  return budgetSeconds - inProgressConsumedSeconds(task, now);
}

export function isTaskOverdue(
  task: Pick<
    TaskRow,
    "status" | "in_progress_at" | "priority" | "category_id"
  > & { sla_minutes?: number | null; in_progress_seconds?: number | null },
  rules: Pick<TaskSlaRule, "priority" | "category_id" | "duration_minutes">[],
  now: Date = new Date()
): boolean {
  if (task.status !== "in_progress" || !task.in_progress_at) return false;
  return slaRemainingSeconds(task, rules, now) <= 0;
}

// The wall-clock instant the current In Progress stint will cross (or already
// crossed) the SLA budget — used only for audit/log records (task_overdue_events,
// cron due_at). Accounts for budget already burned in earlier stints.
export function currentStintDueAt(
  task: Pick<TaskRow, "in_progress_at" | "priority" | "category_id"> & {
    sla_minutes?: number | null;
    in_progress_seconds?: number | null;
  },
  rules: Pick<TaskSlaRule, "priority" | "category_id" | "duration_minutes">[]
): Date | null {
  if (!task.in_progress_at) return null;
  const budgetSeconds = effectiveSlaMinutes(
    { priority: task.priority, category_id: task.category_id, sla_minutes: task.sla_minutes ?? null },
    rules
  ) * 60;
  const remainingToBudget = Math.max(0, budgetSeconds - (task.in_progress_seconds ?? 0));
  return new Date(new Date(task.in_progress_at).getTime() + remainingToBudget * 1000);
}

// Cumulative time (seconds) in a stage: the banked accumulator plus the
// current open stint. `startedAtIso` is non-null only while the task is in
// that stage right now (see the *_started_at columns), so its presence is
// what tells us to add the live stint.
export function stageElapsedSeconds(
  accumulatorSeconds: number | null | undefined,
  startedAtIso: string | null | undefined,
  now: Date = new Date()
): number {
  const base = accumulatorSeconds ?? 0;
  return startedAtIso ? base + secondsBetween(startedAtIso, now) : base;
}

// Same string, different sign, driven by remaining SECONDS (consumption-based
// SLA): "2h 15m left" while under budget, "Overdue by 45m" once the budget is
// burned (remaining <= 0). The magnitude counts up as it goes further over.
export function formatSlaRemaining(remainingSeconds: number): string {
  const overdue = remainingSeconds <= 0;
  const totalMinutes = Math.max(1, Math.round(Math.abs(remainingSeconds) / 60));
  const label = formatDurationMinutes(totalMinutes);
  return overdue ? `Overdue by ${label}` : `${label} left`;
}

export function formatDurationMinutes(totalMinutes: number): string {
  const roundedMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  if (roundedMinutes >= 24 * 60) {
    const days = Math.floor(roundedMinutes / (24 * 60));
    const remainingHours = Math.floor((roundedMinutes % (24 * 60)) / 60);
    return `${days}d ${remainingHours}h`;
  }
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// Plain elapsed time (from a seconds total) for stage clocks like To Do,
// In Progress, and Waiting.
export function formatDurationSeconds(totalSeconds: number): string {
  return formatDurationMinutes(Math.round(Math.max(0, totalSeconds) / 60));
}
