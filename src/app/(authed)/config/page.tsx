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
import { fetchEnrollmentOptionData } from "@/lib/enrollment/options";
import type { TaskCategory } from "@/lib/tasks/types";
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
  const [
    columns,
    options,
    agents,
    candidates,
    assignees,
    memberResult,
    categoriesResult,
    acaOptionData,
    medicareOptionData,
    usageCountResult,
  ] = await Promise.all([
    fetchAllTableColumns(supabase),
    fetchAllTableColumnOptions(supabase),
    fetchTaskAgents(),
    fetchTaskAgentCandidates(),
    fetchTaskAssignees(),
    supabase
      .from("agent_members")
      .select("agent_email,cs_email,is_assistant")
      .eq("is_assistant", true),
    supabase
      .from("task_categories")
      .select("id,name,color")
      .eq("is_active", true)
      .order("position", { ascending: true }),
    fetchEnrollmentOptionData("aca"),
    fetchEnrollmentOptionData("medicare"),
    supabase.rpc("enrollment_option_usage_counts"),
  ]);

  if (memberResult.error) {
    throw new Error(memberResult.error.message);
  }
  if (categoriesResult.error) {
    throw new Error(categoriesResult.error.message);
  }
  if (usageCountResult.error) {
    throw new Error(usageCountResult.error.message);
  }

  function buildUsageCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const row of (usageCountResult.data ?? []) as Array<{
      option_id: string;
      usage_count: number | string;
    }>) {
      counts[row.option_id] = Number(row.usage_count) || 0;
    }
    return counts;
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
      initialCategories={(categoriesResult.data ?? []) as TaskCategory[]}
      initialOptionData={{ aca: acaOptionData, medicare: medicareOptionData }}
      enrollmentUsageCounts={{ aca: buildUsageCounts(), medicare: buildUsageCounts() }}
    />
  );
}
