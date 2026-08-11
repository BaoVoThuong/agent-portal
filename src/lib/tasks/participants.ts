import { getSupabaseAdmin } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

// People who can see a task without being its assignee (added via @mention or
// explicitly). During the additive rollout only a missing relation is treated
// as the documented assignee-only fallback. Any other database failure must be
// visible to the caller instead of becoming a misleading authorization miss.

export async function fetchParticipantTaskIds(email: string): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("task_participants")
    .select("task_id")
    .eq("email", email);
  if (error) {
    if (isMissingTaskParticipantsError(error)) return [];
    throw new Error(error.message);
  }
  return [...new Set((data ?? []).map((r) => (r as { task_id: string }).task_id))];
}

export async function fetchTaskParticipantEmails(
  taskId: string,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<string[]> {
  const { data, error } = await supabase
    .from("task_participants")
    .select("email")
    .eq("task_id", taskId);
  if (error) {
    if (isMissingTaskParticipantsError(error)) return [];
    throw new Error(error.message);
  }
  return [
    ...new Set(
      (data ?? [])
        .map((row) => (row as { email: string }).email?.trim())
        .filter(Boolean)
    ),
  ];
}

export async function isTaskParticipant(taskId: string, email: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("task_participants")
    .select("task_id")
    .eq("task_id", taskId)
    .eq("email", email)
    .maybeSingle();
  if (error) {
    if (isMissingTaskParticipantsError(error)) return false;
    throw new Error(error.message);
  }
  return Boolean(data);
}

export async function addParticipants(
  taskId: string,
  emails: string[],
  source: "mention" | "added" = "mention"
): Promise<void> {
  const unique = [...new Set(emails.filter(Boolean))];
  if (unique.length === 0) return;
  const { error } = await getSupabaseAdmin()
    .from("task_participants")
    .upsert(
      unique.map((email) => ({ task_id: taskId, email, source })),
      { onConflict: "task_id,email", ignoreDuplicates: true }
    );
  if (error) throw new Error(error.message);
}

export function isMissingTaskParticipantsError(error: {
  code?: string;
  message?: string;
}): boolean {
  if (error.code === "42P01") return true;
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "PGRST205" &&
    message.includes("schema cache") &&
    message.includes("task_participants")
  );
}
