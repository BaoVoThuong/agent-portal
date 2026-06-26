import { getSupabaseAdmin } from "@/lib/supabase";

// People who can see a task without being its assignee (added via @mention or
// explicitly). All helpers degrade gracefully if the table doesn't exist yet
// (additive rollout) — visibility simply stays "assignee only".

export async function fetchParticipantTaskIds(email: string): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("task_participants")
    .select("task_id")
    .eq("email", email);
  if (error) return [];
  return [...new Set((data ?? []).map((r) => (r as { task_id: string }).task_id))];
}

export async function isTaskParticipant(taskId: string, email: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("task_participants")
    .select("task_id")
    .eq("task_id", taskId)
    .eq("email", email)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

export async function addParticipants(
  taskId: string,
  emails: string[],
  source: "mention" | "added" = "mention"
): Promise<void> {
  const unique = [...new Set(emails.filter(Boolean))];
  if (unique.length === 0) return;
  await getSupabaseAdmin()
    .from("task_participants")
    .upsert(
      unique.map((email) => ({ task_id: taskId, email, source })),
      { onConflict: "task_id,email", ignoreDuplicates: true }
    );
  // Best-effort: a failure (e.g. table missing) just means visibility doesn't widen.
}
