import type { SupabaseClient } from "@supabase/supabase-js";

/** Notification content is checked against live membership, without the board's 60s cache. */
export async function freshNotificationMembership(email: string, supabase: SupabaseClient) {
  const [agent, assistants] = await Promise.all([
    supabase.from("task_agents").select("email").eq("email", email).maybeSingle(),
    supabase.from("agent_members").select("agent_email")
      .eq("cs_email", email).eq("is_assistant", true),
  ]);
  if (agent.error) throw new Error(agent.error.message);
  if (assistants.error) throw new Error(assistants.error.message);
  return {
    isSelectedAgent: Boolean(agent.data),
    assistantAgentEmails: [...new Set(
      ((assistants.data ?? []) as { agent_email: string }[]).map((row) => row.agent_email),
    )],
  };
}
