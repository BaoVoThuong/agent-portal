import { getSupabaseAdmin } from "@/lib/supabase";
import type { TaskActor, TaskRow } from "./types";

const TASK_COLUMNS =
  "id,title,description,status,priority,category_id,assignee_email,reporter_email,due_date,waiting_reason,position,created_at,updated_at,archived_at";

export async function fetchTasksForActor(actor: TaskActor): Promise<TaskRow[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .is("archived_at", null)
    .order("position", { ascending: true });

  // Manager sees everything; worker sees only their own assigned tasks.
  if (!actor.isManager) {
    query = query.eq("assignee_email", actor.email);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TaskRow[];
}
