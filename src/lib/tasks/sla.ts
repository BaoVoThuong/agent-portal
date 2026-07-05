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

// Prefers the snapshot taken when in_progress_at was last (re)stamped over a
// live recomputation from the task's current priority/category. Without
// this, editing priority/category on an already-overdue task (allowed for
// the agent owner and the reporter, not just managers) would silently move
// the deadline and un-flag it as overdue — no reason required, same class of
// gaming as the status-bounce loophole already closed in transitions.ts.
// Falls back to live resolution only for rows with no snapshot yet (not
// started, or predates this column).
export function effectiveSlaMinutes(
  task: Pick<TaskRow, "priority" | "category_id" | "sla_minutes">,
  rules: Pick<TaskSlaRule, "priority" | "category_id" | "duration_minutes">[]
): number {
  if (typeof task.sla_minutes === "number") return task.sla_minutes;
  return resolveSlaMinutes(task.priority, task.category_id, rules);
}

export function isTaskOverdue(
  task: Pick<
    TaskRow,
    "status" | "in_progress_at" | "priority" | "category_id"
  > & { sla_minutes?: number | null },
  rules: Pick<TaskSlaRule, "priority" | "category_id" | "duration_minutes">[],
  now: Date = new Date()
): boolean {
  if (task.status !== "in_progress" || !task.in_progress_at) return false;
  const minutes = effectiveSlaMinutes(
    { priority: task.priority, category_id: task.category_id, sla_minutes: task.sla_minutes ?? null },
    rules
  );
  return now.getTime() >= slaDeadline(task.in_progress_at, minutes).getTime();
}

// Same string, different sign: "2h 15m left" while running, "Overdue by 45m"
// once past deadline.
export function formatSlaRemaining(deadline: Date, now: Date = new Date()): string {
  const diffMs = deadline.getTime() - now.getTime();
  const overdue = diffMs < 0;
  const totalMinutes = Math.max(1, Math.round(Math.abs(diffMs) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const label = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return overdue ? `Overdue by ${label}` : `${label} left`;
}

// A task that has ever gone overdue (overdue_count > 0) shows this instead
// of a fresh countdown once reopened/unlocked — a "time left" framing would
// look like a clean slate, which is misleading for a task already flagged as
// high-risk. Plain elapsed time since the current in_progress_at instead.
export function formatElapsedSince(sinceIso: string, now: Date = new Date()): string {
  const totalMinutes = Math.max(
    0,
    Math.round((now.getTime() - new Date(sinceIso).getTime()) / 60_000)
  );
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
