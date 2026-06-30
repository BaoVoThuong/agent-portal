import { getSupabaseAdmin } from "@/lib/supabase";
import { attachAssigneesToTasks, fetchAssignedTaskIdsForEmail } from "./assignees";
import { fetchAgentsForCs } from "./membership";
import { fetchParticipantTaskIds } from "./participants";
import type { TaskActor, TaskRow } from "./types";

export const TASK_COLUMNS =
  "id,title,description,fub_link,status,priority,category_id,agent_email,assignee_email,reporter_email,waiting_reason,position,created_at,updated_at,archived_at";

export async function fetchTasksForActor(actor: TaskActor): Promise<TaskRow[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .is("archived_at", null)
    .order("position", { ascending: true });

  // Manager sees everything; worker sees their own assigned tasks plus any task
  // they participate in (e.g. were @mentioned on).
  if (!actor.isManager) {
    const [agents, assignedIds, participantIds] = await Promise.all([
      fetchAgentsForCs(actor.email),
      fetchAssignedTaskIdsForEmail(actor.email, supabase),
      fetchParticipantTaskIds(actor.email),
    ]);
    const ors: string[] = [`assignee_email.eq."${actor.email}"`];
    if (agents.length > 0) ors.push(`agent_email.in.(${agents.map((a) => `"${a}"`).join(",")})`);
    if (assignedIds.length > 0) ors.push(`id.in.(${assignedIds.join(",")})`);
    if (participantIds.length > 0) ors.push(`id.in.(${participantIds.join(",")})`);
    query =
      ors.length > 0
        ? query.or(ors.join(","))
        : query.eq("id", "00000000-0000-0000-0000-000000000000");
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return attachAssigneesToTasks((data ?? []) as unknown as TaskRow[], supabase);
}
