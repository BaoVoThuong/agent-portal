import { isSlaActiveInProgress, isTaskOverdue, slaRemainingSeconds } from "./sla";
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

/**
 * Có nên nhắc "task không có hoạt động" không.
 *
 * `stale` từng chạy ở To Do, In Progress, Waiting và Billing. Ba chặng kia đã có
 * lời nhắc riêng (`todo_reminder`, `waiting_reminder`), nên cùng một task nhận
 * hai lời nhắc trong cùng một lượt cron: 14 ngày tới 15/09/2026 có
 * stale + waiting_reminder 28 lần, stale + todo_reminder 3 lần. In Progress đang
 * quá hạn SLA cũng đã có `overdue_reminder`. Chỉ còn In Progress CHƯA quá hạn —
 * SLA dài, hoặc SLA đã ngừng chạy sau khi mở khoá — là không ai nhắc.
 */
export function shouldSendStaleReminder(
  task: Parameters<typeof isTaskOverdue>[0] & {
    last_activity_at: string | null;
    stale_reminded_at: string | null;
  },
  rules: Pick<TaskSlaRule, "priority" | "category_id" | "duration_minutes">[],
  staleHours: number,
  now: Date
): boolean {
  if (task.status !== "in_progress") return false;
  if (isTaskOverdue(task, rules, now)) return false;
  return (
    isStale(task, staleHours, now) &&
    intervalDue(task.stale_reminded_at, staleHours * 3600_000, now)
  );
}
