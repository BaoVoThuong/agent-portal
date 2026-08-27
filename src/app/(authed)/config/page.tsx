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
import type { TableColumnOption, TableScope } from "@/lib/table-config/types";
import {
  emptyEnrollmentOptionsBySet,
  fetchEnrollmentOptionData,
  type EnrollmentOptionData,
} from "@/lib/enrollment/options";
import type { TaskCategory, TaskSlaRule } from "@/lib/tasks/types";
import { ConfigClient } from "./_components/ConfigClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Health Table Configuration",
};

type LoadResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function loadOptional<T>(label: string, loader: () => Promise<T>): Promise<LoadResult<T>> {
  try {
    return { ok: true, data: await loader() };
  } catch (error) {
    const raw = error instanceof Error ? error.message.toLowerCase() : "";
    const schemaMissing =
      raw.includes("42p01") ||
      raw.includes("pgrst205") ||
      raw.includes("does not exist") ||
      raw.includes("schema cache");
    return {
      ok: false,
      error: schemaMissing
        ? `${label} schema is not available. Apply the table-config migration before editing this section.`
        : `Could not load ${label}. Retry after checking the connection or permissions.`,
    };
  }
}

function emptyEnrollmentOptionData(): EnrollmentOptionData {
  return {
    sets: [],
    options: [],
    optionsBySet: emptyEnrollmentOptionsBySet(),
    optionsById: new Map(),
  };
}

export default async function ConfigPage() {
  const admin = await loadConfigAdmin();
  if (!admin.ok) {
    redirect(admin.status === 401 ? "/api/auth/signin" : "/unauthorized");
  }

  const supabase = getSupabaseAdmin();
  const [
    columnsResult,
    optionsResult,
    agentsResult,
    candidatesResult,
    assigneesResult,
    membersResult,
    categoriesResult,
    slaRulesResult,
    acaOptionDataResult,
    medicareOptionDataResult,
  ] = await Promise.all([
    loadOptional("Table columns", () => fetchAllTableColumns(supabase)),
    loadOptional("Custom dropdown values", () => fetchAllTableColumnOptions(supabase)),
    loadOptional("Agents", () => fetchTaskAgents()),
    loadOptional("Agent candidates", () => fetchTaskAgentCandidates()),
    loadOptional("Task assignees", () => fetchTaskAssignees()),
    loadOptional("Assistant memberships", async () => {
      const result = await supabase
        .from("agent_members")
        .select("agent_email,cs_email,is_assistant")
        .eq("is_assistant", true);
      if (result.error) throw new Error(result.error.message);
      return result.data ?? [];
    }),
    loadOptional("Categories", async () => {
      const result = await supabase
        .from("task_categories")
        .select("id,name,color")
        .eq("is_active", true)
        .order("position", { ascending: true });
      if (result.error) throw new Error(result.error.message);
      return result.data ?? [];
    }),
    loadOptional("SLA rules", async () => {
      const result = await supabase
        .from("task_sla_rules")
        .select("id,priority,category_id,duration_minutes,updated_at");
      if (result.error) throw new Error(result.error.message);
      return result.data ?? [];
    }),
    loadOptional("ACA enrollment options", () => fetchEnrollmentOptionData("aca")),
    loadOptional("Medicare enrollment options", () => fetchEnrollmentOptionData("medicare")),
  ]);

  if (!columnsResult.ok) throw new Error(columnsResult.error);
  const columns = columnsResult.data;
  const columnsReady = Object.values(columns).every((rows) =>
    rows.every((column) => !column.id.startsWith("system-"))
  );
  const emptyOptions: Record<TableScope, TableColumnOption[]> = {
    cs: [],
    aca: [],
    medicare: [],
    lead_pc: [],
    lead_health: [],
  };
  const options = optionsResult.ok && columnsReady ? optionsResult.data : emptyOptions;
  const emptyPeople: never[] = [];
  const agents = agentsResult.ok ? agentsResult.data : emptyPeople;
  const candidates = candidatesResult.ok ? candidatesResult.data : emptyPeople;
  const assignees = assigneesResult.ok ? assigneesResult.data : emptyPeople;
  const memberRows = membersResult.ok ? membersResult.data : [];
  const categoryRows = categoriesResult.ok ? categoriesResult.data : [];
  const slaRows = slaRulesResult.ok ? slaRulesResult.data : [];
  const acaOptionData = acaOptionDataResult.ok
    ? acaOptionDataResult.data
    : emptyEnrollmentOptionData();
  const medicareOptionData = medicareOptionDataResult.ok
    ? medicareOptionDataResult.data
    : emptyEnrollmentOptionData();

  return (
    <ConfigClient
      initialColumns={columns}
      initialOptions={options}
      initialAgents={agents}
      candidates={candidates}
      assignees={assignees}
      initialMembers={memberRows.map((row) => {
        const member = row as {
          agent_email: string;
          cs_email: string;
          is_assistant: boolean;
        };
        return member;
      })}
      initialCategories={categoryRows as TaskCategory[]}
      initialSlaRules={slaRows as TaskSlaRule[]}
      initialOptionData={{ aca: acaOptionData, medicare: medicareOptionData }}
      sectionStatus={{
        columns: {
          available: columnsReady,
          error: columnsReady
            ? undefined
            : "Table columns are using a migration fallback. Editing is disabled until the schema is applied.",
        },
        options: {
          available: optionsResult.ok && columnsReady,
          error: optionsResult.ok
            ? columnsReady
              ? undefined
              : "Custom dropdown values are unavailable until the table-config schema is applied."
            : optionsResult.error,
        },
        categories: {
          available: categoriesResult.ok,
          error: categoriesResult.ok ? undefined : categoriesResult.error,
        },
        assistants: {
          available: agentsResult.ok && candidatesResult.ok && assigneesResult.ok && membersResult.ok,
          error: [agentsResult, candidatesResult, assigneesResult, membersResult]
            .find((result) => !result.ok)?.error,
        },
        sla: {
          available: slaRulesResult.ok,
          error: slaRulesResult.ok ? undefined : slaRulesResult.error,
        },
        enrollmentOptions: {
          cs: { available: true },
          aca: {
            available: acaOptionDataResult.ok,
            error: acaOptionDataResult.ok ? undefined : acaOptionDataResult.error,
          },
          medicare: {
            available: medicareOptionDataResult.ok,
            error: medicareOptionDataResult.ok ? undefined : medicareOptionDataResult.error,
          },
          lead_pc: { available: true },
          lead_health: { available: true },
        },
      }}
    />
  );
}
