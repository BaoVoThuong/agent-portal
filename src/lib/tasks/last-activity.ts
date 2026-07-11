import type { SupabaseClient } from "@supabase/supabase-js";

export async function touchLastActivity(
  supabase: SupabaseClient,
  taskId: string,
  nowIso: string
): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({ last_activity_at: nowIso, stale_reminded_at: null })
    .eq("id", taskId);
  if (error) throw new Error(error.message);
}
