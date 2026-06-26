import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchParticipantTaskIds } from "./participants";
import type { TaskActor, TaskRow } from "./types";

const TASK_COLUMNS =
  "id,title,description,status,priority,category_id,agent_email,assignee_email,reporter_email,due_date,waiting_reason,position,created_at,updated_at,archived_at";

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
    const participantIds = await fetchParticipantTaskIds(actor.email);
    if (participantIds.length > 0) {
      query = query.or(
        `assignee_email.eq."${actor.email}",id.in.(${participantIds.join(",")})`
      );
    } else {
      query = query.eq("assignee_email", actor.email);
    }
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TaskRow[];
}
