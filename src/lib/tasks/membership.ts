import { getSupabaseAdmin } from "@/lib/supabase";

export async function fetchAgentsForCs(email: string): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_members").select("agent_email").eq("cs_email", email);
  if (error) return [];
  return [...new Set((data ?? []).map((r) => (r as { agent_email: string }).agent_email))];
}

export async function fetchCsForAgent(agentEmail: string): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_members").select("cs_email").eq("agent_email", agentEmail);
  if (error) return [];
  return [...new Set((data ?? []).map((r) => (r as { cs_email: string }).cs_email))];
}

// Agents this person is a promoted "Assistant" for — an Assistant gets the
// same rights as the agent owner on that agent's tasks.
export async function fetchAssistantAgentsForCs(email: string): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_members")
    .select("agent_email")
    .eq("cs_email", email)
    .eq("is_assistant", true);
  if (error) return [];
  return [...new Set((data ?? []).map((r) => (r as { agent_email: string }).agent_email))];
}

// The single check used everywhere "agent owner" rights are decided: either
// this actor literally IS the task's agent, or they're a registered
// Assistant for that agent. `agentEmail` is the task's `agent_email` column
// (nullable — a task with no agent has no owner/assistant to grant rights).
export async function isAgentOwnerOrAssistant(
  agentEmail: string | null,
  actorEmail: string
): Promise<boolean> {
  if (!agentEmail) return false;
  if (agentEmail === actorEmail) return true;
  const { data, error } = await getSupabaseAdmin()
    .from("agent_members")
    .select("agent_email")
    .eq("agent_email", agentEmail)
    .eq("cs_email", actorEmail)
    .eq("is_assistant", true)
    .maybeSingle();
  return !error && Boolean(data);
}

export async function fetchAgentOwnerAndAssistantEmails(
  agentEmail: string | null
): Promise<string[]> {
  if (!agentEmail) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("agent_members")
    .select("cs_email")
    .eq("agent_email", agentEmail)
    .eq("is_assistant", true);
  if (error) return [agentEmail];

  return [
    ...new Set([
      agentEmail,
      ...(data ?? []).map((row) => (row as { cs_email: string }).cs_email),
    ]),
  ];
}

// All admin accounts — recipients for oversight notifications (e.g. an overdue
// resolved with a reason). Role lives on portal_account.
export async function fetchAdminEmails(): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("portal_account")
    .select("email")
    .eq("role", "admin")
    .eq("is_active", true);
  if (error) return [];
  return [
    ...new Set((data ?? []).map((row) => (row as { email: string }).email)),
  ];
}
