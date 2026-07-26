import { effectiveSlaMinutes } from "./sla";
import type { TaskRow, TaskSlaRule } from "./types";

type RotationTask = Pick<TaskRow, "priority" | "category_id" | "sla_minutes">;
type RotationRule = Pick<TaskSlaRule, "priority" | "category_id" | "duration_minutes">;
type RpcResult = { data: unknown; error: { message: string } | null };
type RotationSupabaseClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
};

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeAssignmentRotationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function computeAssignmentQueueDueAt(
  currentQueueDueAt: string | null | undefined,
  addedSlaMinutes: number,
  now: Date = new Date()
): Date {
  const current = timestamp(currentQueueDueAt);
  const base = Math.max(current ?? 0, now.getTime());
  return new Date(base + Math.max(0, addedSlaMinutes) * 60_000);
}

export async function bumpAssignmentRotation(
  supabase: RotationSupabaseClient,
  email: string,
  task: RotationTask,
  rules: RotationRule[],
  now: Date = new Date()
): Promise<void> {
  const normalizedEmail = normalizeAssignmentRotationEmail(email);
  if (!normalizedEmail) return;

  const minutes = effectiveSlaMinutes(task, rules);
  const { error } = await supabase.rpc("bump_task_assignment_rotation", {
    p_email: normalizedEmail,
    p_minutes: minutes,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(error.message);
}
