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
