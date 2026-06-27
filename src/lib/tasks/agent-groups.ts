import { getSupabaseAdmin } from "@/lib/supabase";

export async function fetchAgentsAndCs(): Promise<{
  agents: { email: string; name: string | null }[];
  cs: { email: string; name: string | null }[];
}> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("portal_account")
    .select("email,name,role,is_active")
    .eq("is_active", true);

  const rows = (data ?? []) as {
    email: string;
    name: string | null;
    role: string | null;
  }[];

  return {
    agents: rows
      .filter((r) => r.role === "agent")
      .map((r) => ({ email: r.email, name: r.name })),
    cs: rows.map((r) => ({ email: r.email, name: r.name })),
  };
}
