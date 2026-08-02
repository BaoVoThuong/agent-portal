import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  fetchTaskAgentCandidates,
  fetchTaskAgents,
  fetchTaskAssignees,
} from "@/lib/tasks/assignees";
import { loadConfigAdmin } from "@/lib/table-config/access";
import {
  fetchAllTableColumnOptions,
  fetchAllTableColumns,
} from "@/lib/table-config/queries";
import { ConfigClient } from "./_components/ConfigClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Health Table Configuration",
};

export default async function ConfigPage() {
  const admin = await loadConfigAdmin();
  if (!admin.ok) {
    redirect(admin.status === 401 ? "/api/auth/signin" : "/unauthorized");
  }

  const supabase = getSupabaseAdmin();
  const [columns, options, agents, candidates, assignees, memberResult] = await Promise.all([
    fetchAllTableColumns(supabase),
    fetchAllTableColumnOptions(supabase),
    fetchTaskAgents(),
    fetchTaskAgentCandidates(),
    fetchTaskAssignees(),
    supabase
      .from("agent_members")
      .select("agent_email,cs_email,is_assistant")
      .eq("is_assistant", true),
  ]);

  if (memberResult.error) {
    throw new Error(memberResult.error.message);
  }

  return (
    <ConfigClient
      initialColumns={columns}
      initialOptions={options}
      initialAgents={agents}
      candidates={candidates}
      assignees={assignees}
      initialMembers={(memberResult.data ?? []).map((row) => {
        const member = row as {
          agent_email: string;
          cs_email: string;
          is_assistant: boolean;
        };
        return member;
      })}
    />
  );
}
