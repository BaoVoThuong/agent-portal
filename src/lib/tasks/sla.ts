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

export function isTaskOverdue(
  task: Pick<TaskRow, "status" | "in_progress_at" | "priority" | "category_id">,
  rules: Pick<TaskSlaRule, "priority" | "category_id" | "duration_minutes">[],
  now: Date = new Date()
): boolean {
  if (task.status !== "in_progress" || !task.in_progress_at) return false;
  const minutes = resolveSlaMinutes(task.priority, task.category_id, rules);
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
