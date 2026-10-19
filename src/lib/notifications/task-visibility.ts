import type { SupabaseClient } from "@supabase/supabase-js";
import { canViewTask } from "@/lib/tasks/access";
import { isTaskAssigneesMissingError } from "@/lib/tasks/assignees";
import { isMissingTaskParticipantsError } from "@/lib/tasks/participants";
import type { TaskActor } from "@/lib/tasks/types";
import { freshNotificationMembership } from "./membership";

export type NotificationTaskScopeRow = {
  id: string;
  agent_email: string | null;
  assignee_email: string | null;
  reporter_email: string | null;
};

/** The same visibility flags used by task detail, applied to notification rows in one batch. */
export async function visibleNotificationTaskIds(
  actor: TaskActor,
  tasks: readonly NotificationTaskScopeRow[],
  supabase: SupabaseClient,
): Promise<Set<string>> {
  if (!actor.isWorker) return new Set();
  if (actor.isManager) return new Set(tasks.map((task) => task.id));
  if (tasks.length === 0) return new Set();

  const ids = tasks.map((task) => task.id);
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += 200) {
    chunks.push(ids.slice(start, start + 200));
  }
  const [membership, assignees, participants] = await Promise.all([
    freshNotificationMembership(actor.email, supabase),
    Promise.all(chunks.map((chunk) => supabase.from("task_assignees")
      .select("task_id").eq("email", actor.email).in("task_id", chunk))),
    Promise.all(chunks.map((chunk) => supabase.from("task_participants")
      .select("task_id").eq("email", actor.email).in("task_id", chunk))),
  ]);
  for (const result of assignees) {
    if (result.error && !isTaskAssigneesMissingError(result.error)) {
      throw new Error(result.error.message);
    }
  }
  for (const result of participants) {
    if (result.error && !isMissingTaskParticipantsError(result.error)) {
      throw new Error(result.error.message);
    }
  }
  const assignedIds = new Set(assignees.flatMap((result) =>
    ((result.data ?? []) as { task_id: string }[]).map((row) => row.task_id)));
  const participantIds = new Set(participants.flatMap((result) =>
    ((result.data ?? []) as { task_id: string }[]).map((row) => row.task_id)));
  const seesAllTasks = !membership.isSelectedAgent && membership.assistantAgentEmails.length === 0;
  return new Set(tasks.filter((task) => canViewTask(actor, task, {
    seesAllTasks,
    isAssignee: assignedIds.has(task.id) || task.assignee_email === actor.email,
    isAgentOwner: Boolean(task.agent_email &&
      (task.agent_email === actor.email || membership.assistantAgentEmails.includes(task.agent_email))),
    isAgentMember: Boolean(task.agent_email && membership.assistantAgentEmails.includes(task.agent_email)),
    isParticipant: participantIds.has(task.id),
    isReporter: task.reporter_email === actor.email,
  })).map((task) => task.id));
}

/** Summary polling has only task IDs; fetch their scope in bounded batches. */
export async function visibleNotificationTaskIdsById(
  actor: TaskActor,
  taskIds: readonly string[],
  supabase: SupabaseClient,
): Promise<Set<string>> {
  if (!actor.isWorker || taskIds.length === 0) return new Set();
  const rows: NotificationTaskScopeRow[] = [];
  const uniqueIds = [...new Set(taskIds)];
  for (let start = 0; start < uniqueIds.length; start += 200) {
    const { data, error } = await supabase.from("tasks")
      .select("id,agent_email,assignee_email,reporter_email")
      .in("id", uniqueIds.slice(start, start + 200));
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as NotificationTaskScopeRow[]));
  }
  return visibleNotificationTaskIds(actor, rows, supabase);
}
