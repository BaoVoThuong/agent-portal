import { isSlaActiveInProgress, slaRemainingSeconds } from "./sla";
import type { TaskRow, TaskSlaRule } from "./types";

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
  if (
    task.status === "done" ||
    task.status === "cancel" ||
    task.status === "backlog"
  ) {
    return false;
  }
  if (!task.last_activity_at) return false;

  const last = new Date(task.last_activity_at).getTime();
  if (Number.isNaN(last)) return false;
  return now.getTime() - last >= staleHours * 3600_000;
}
