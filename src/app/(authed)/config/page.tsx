import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  fetchTaskAgentCandidates,
  fetchTaskAgents,
  fetchTaskAssignees,
} from "@/lib/tasks/assignees";
import { buildLeadActor, canManageLeads, isLeadViewAdmin } from "@/lib/leads/access";
import { fetchLeadVocabulary } from "@/lib/leads/queries";
import { loadConfigAdmin } from "@/lib/table-config/access";
import { configScopesFor } from "@/lib/table-config/scope-access";
import {
  fetchAllTableColumnOptions,
  fetchAllTableColumns,
} from "@/lib/table-config/queries";
import {
  TABLE_SCOPES,
  type TableColumnOption,
  type TableScope,
} from "@/lib/table-config/types";
import { fetchEnrollmentOptionData } from "@/lib/enrollment/options";
import type { TaskCategory, TaskSlaRule } from "@/lib/tasks/types";
import { emptyEnrollmentOptionData } from "./empty-option-data";
import { ConfigClient } from "./_components/ConfigClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Table Configuration",
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


export default async function ConfigPage() {
  // HAI cổng song song, mỗi cổng giữ đúng luật của nó. Gộp làm một là hoặc nới
  // quyền Health cho người không phải task-admin (`loadConfigAdmin` đòi
  // `task.manage` VÀ vai trò admin — xem chú thích ở lib/tasks/access.ts), hoặc
  // chặn mất hai tài khoản trên production chỉ có quyền lead.
  const [admin, session] = await Promise.all([loadConfigAdmin(), auth()]);
  const email = session?.user?.email ?? "";
  const isLeadManager = email
    ? canManageLeads(
        buildLeadActor(session!.user.permissions, email, {
          isAdmin: isLeadViewAdmin(session!.user),
        })
      )
    : false;

  const scopes = configScopesFor({ isTaskAdmin: admin.ok, isLeadManager });
  if (scopes.length === 0) {
    // 401 khi chưa đăng nhập, 403 khi đăng nhập rồi mà không quản bảng nào.
    redirect(!email ? "/api/auth/signin" : "/unauthorized");
  }

  // Ẩn tab KHÔNG ẩn payload. Trang này nạp cả danh bạ công ty
  // (`fetchTaskAgentCandidates` đọc mọi tài khoản đang hoạt động) rồi truyền
  // xuống client. Người chỉ có quyền lead phải nhận đúng mức mà `/leads/config`
  // gửi cho họ hôm qua: rỗng.
  const needsTaskData = scopes.some((scope) => scope !== "lead");
  const needsLeadData = scopes.includes("lead");

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
    leadVocabularyResult,
  ] = await Promise.all([
    loadOptional("Table columns", () => fetchAllTableColumns(supabase)),
    loadOptional("Custom dropdown values", () => fetchAllTableColumnOptions(supabase)),
    loadOptional("Agents", async () => (needsTaskData ? fetchTaskAgents() : [])),
    loadOptional("Agent candidates", async () =>
      needsTaskData ? fetchTaskAgentCandidates() : []
    ),
    loadOptional("Task assignees", async () => (needsTaskData ? fetchTaskAssignees() : [])),
    loadOptional("Assistant memberships", async () => {
      if (!needsTaskData) return [];
      const result = await supabase
        .from("agent_members")
        .select("agent_email,cs_email,is_assistant")
        .eq("is_assistant", true);
      if (result.error) throw new Error(result.error.message);
      return result.data ?? [];
    }),
    loadOptional("Categories", async () => {
      if (!needsTaskData) return [];
      const result = await supabase
        .from("task_categories")
        .select("id,name,color")
        .eq("is_active", true)
        .order("position", { ascending: true });
      if (result.error) throw new Error(result.error.message);
      return result.data ?? [];
    }),
    loadOptional("SLA rules", async () => {
      if (!needsTaskData) return [];
      const result = await supabase
        .from("task_sla_rules")
        .select("id,priority,category_id,duration_minutes,updated_at");
      if (result.error) throw new Error(result.error.message);
      return result.data ?? [];
    }),
    loadOptional("ACA enrollment options", async () =>
      needsTaskData ? fetchEnrollmentOptionData("aca") : emptyEnrollmentOptionData()
    ),
    loadOptional("Medicare enrollment options", async () =>
      needsTaskData ? fetchEnrollmentOptionData("medicare") : emptyEnrollmentOptionData()
    ),
    // Tab Dropdown Values của lead dựng "Lead status" và "Interaction type"
    // thẳng từ đây. `/config` trước không nạp, nên gộp mà quên là màn hình hiện
    // "Lead status (0)" trong khi Settings vẫn trỏ người dùng tới đúng chỗ đó.
    loadOptional("Lead vocabulary", async () =>
      needsLeadData ? fetchLeadVocabulary(supabase) : undefined
    ),
  ]);

  if (!columnsResult.ok) throw new Error(columnsResult.error);
  const columns = columnsResult.data;
  // MỘT cờ cho MỖI scope. Bản trước là một cờ chung cho cả trang, và chính nó
  // đã khoá trình sửa cột của Health CS, ACA, Medicare cùng lúc chỉ vì scope
  // Lead chưa được materialise. Nay có bốn scope trên MỘT trang, nên cờ chung
  // là chuyện chắc chắn xảy ra lại chứ không còn là rủi ro.
  const columnsReadyByScope = Object.fromEntries(
    TABLE_SCOPES.map((scope) => [
      scope,
      (columns[scope] ?? []).every((column) => !column.id.startsWith("system-")),
    ])
  ) as Record<TableScope, boolean>;
  const emptyOptions: Record<TableScope, TableColumnOption[]> = {
    cs: [],
    aca: [],
    medicare: [],
    lead: [],
  };
  // Options nạp đủ cho mọi scope; ConfigClient tự khoá theo scope đang chọn.
  // Cắt sạch options vì MỘT scope chưa sẵn sàng là làm các scope kia mất luôn
  // giá trị dropdown — đúng lỗi cũ ở một dạng khác.
  const options = optionsResult.ok ? optionsResult.data : emptyOptions;
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
  const leadVocabulary = leadVocabularyResult.ok ? leadVocabularyResult.data : undefined;

  return (
    <ConfigClient
      title="Table Configuration"
      scopes={scopes}
      columnsReadyByScope={columnsReadyByScope}
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
      initialLeadVocabulary={leadVocabulary}
      initialOptionData={{ aca: acaOptionData, medicare: medicareOptionData }}
      sectionStatus={{
        columns: {
          // Cờ cấp trang chỉ còn nói "có bảng nào sửa được không", và chỉ xét
          // các bảng NGƯỜI NÀY thấy. Việc khoá từng bảng do
          // columnsReadyByScope làm, trong ConfigClient.
          available: scopes.some((scope) => columnsReadyByScope[scope]),
          error: scopes.some((scope) => columnsReadyByScope[scope])
            ? undefined
            : "Table columns are using a migration fallback. Editing is disabled until the schema is applied.",
        },
        options: {
          available: optionsResult.ok,
          error: optionsResult.ok ? undefined : optionsResult.error,
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
          lead: { available: true },
        },
      }}
    />
  );
}
