import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchAgentsForCs } from "./membership";
import { fetchParticipantTaskIds } from "./participants";
import type { TaskActor, TaskRow } from "./types";

const TASK_COLUMNS =
  "id,title,description,status,priority,category_id,agent_email,assignee_email,reporter_email,waiting_reason,position,created_at,updated_at,archived_at";

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
    const [agents, participantIds] = await Promise.all([
      fetchAgentsForCs(actor.email),
      fetchParticipantTaskIds(actor.email),
    ]);
    const ors: string[] = [`assignee_email.eq."${actor.email}"`];
    if (agents.length > 0) ors.push(`agent_email.in.(${agents.map((a) => `"${a}"`).join(",")})`);
    if (participantIds.length > 0) ors.push(`id.in.(${participantIds.join(",")})`);
    query = query.or(ors.join(","));
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TaskRow[];
}
