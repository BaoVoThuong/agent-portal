import { getSupabaseAdmin } from "@/lib/supabase";
import type { PcEntry } from "@/lib/domain/pc-entry.types";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";
import { buildVisibleEntriesFilter } from "@/lib/agent-name";
import PcEntryGrid from "./PcEntryGrid";

export const dynamic = "force-dynamic";

export default async function PcRegistrationPage() {
  const session = await requirePermission(PERMISSIONS.CUSTOMER_REGISTRATION_PC);
  const email = session!.user!.email!;
  const canViewAll = can(
    session.user.permissions,
    PERMISSIONS.COMPANY_VIEW_ALL
  );

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("pc_entries")
    .select("*")
    .order("created_at", { ascending: false });

  if (!canViewAll) {
    query = query.or(buildVisibleEntriesFilter(email, session.user.name));
  }

  const { data } = await query;
  const initialHistory = (data ?? []) as PcEntry[];
  const agentOptions = await fetchPcAgentNames();

  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[#16233a]">
          P&amp;C Registration
        </h1>
        <p className="mt-1 text-sm text-[#667085]">
          Manage P&amp;C customer registrations with the same batch workflow and
          centralized sync used for Health.
        </p>
      </header>
      <PcEntryGrid agentOptions={agentOptions} initialHistory={initialHistory} />
    </div>
  );
}

async function fetchPcAgentNames() {
  const supabase = getSupabaseAdmin();
  const names = new Set<string>();
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("pc_mart")
      .select("agent_name")
      .order("agent_name", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);

    for (const row of (data ?? []) as { agent_name: string | null }[]) {
      const name = row.agent_name?.trim();
      if (name) names.add(name);
    }

    if (!data || data.length < pageSize) break;
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}
