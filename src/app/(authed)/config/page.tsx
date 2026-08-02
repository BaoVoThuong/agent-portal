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
    // Đếm usage TỐI GIẢN — KHÔNG load nguyên enrollment records.
    supabase
      .from("enrollment_records")
      .select("program,stage_id,carrier_id,platform_id,consent_id,payment_status_id,aca_status_id")
      .is("archived_at", null),
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

  function buildUsageCounts(program: "aca" | "medicare"): Record<string, number> {
    const counts: Record<string, number> = {};
    const bump = (id: string | null) => {
      if (id) counts[id] = (counts[id] ?? 0) + 1;
    };
    for (const row of usageCountResult.data ?? []) {
      const record = row as {
        program: string;
        stage_id: string | null;
        carrier_id: string | null;
        platform_id: string | null;
        consent_id: string | null;
        payment_status_id: string | null;
        aca_status_id: string | null;
      };
      if (record.program !== program) continue;
      bump(record.stage_id);
      bump(record.carrier_id);
      bump(record.platform_id);
      bump(record.consent_id);
      bump(record.payment_status_id);
      bump(record.aca_status_id);
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
      enrollmentUsageCounts={{ aca: buildUsageCounts("aca"), medicare: buildUsageCounts("medicare") }}
    />
  );
}
