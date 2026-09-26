import { businessDateKey } from "./business-date";
import { hasGrant } from "@/lib/authz/grants";
import { grantsForRoles, loadRoleDefinitions } from "@/lib/authz/principal";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchTaskAssigneeRowsForTaskIds } from "./assignees";
import { resolveReminderSettings } from "./reminder-settings";
import { aggregateOverview } from "./overview";
import type {
  OverviewAccount,
  OverviewCategory,
  OverviewTaskInput,
  OverviewSnapshot,
} from "./overview-types";
import type { TaskSlaRule } from "./types";

const OVERVIEW_TASK_COLUMNS =
  "id,title,status,priority,category_id,agent_email,assignee_email,todo_started_at,in_progress_at,waiting_started_at,billing_started_at,last_activity_at,sla_minutes,overdue_count,in_progress_seconds,waiting_seconds,billing_seconds,closed_at,done_reviewed_at,created_at,updated_at,archived_at";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type TaskOverviewDateRange = {
  from?: string;
  to?: string;
};

export async function fetchTaskOverview(
  now = new Date(),
  dateRange: TaskOverviewDateRange = {}
): Promise<OverviewSnapshot> {
  const supabase = getSupabaseAdmin();
  const recentDoneSince = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();
  const [accountsResult, userRolesResult, agentsResult, membersResult, rotationResult, queueMemberResult, categoryResult, activeTaskResult, recentDoneResult, rulesResult, reminderResult] =
    await Promise.all([
      supabase
        .from("portal_account")
        .select("id,email,name,is_active,role"),
      supabase.from("user_roles").select("user_id,role_id"),
      supabase.from("task_agents").select("email"),
      supabase.from("agent_members").select("agent_email,cs_email,is_assistant"),
      supabase.from("task_assignment_rotation").select("email,queue_due_at,updated_at"),
      supabase.from("task_assignment_queue_members").select("email,is_enabled"),
      supabase
        .from("task_categories")
        .select("id,name,color")
        .eq("is_active", true),
      supabase
        .from("tasks")
        .select(OVERVIEW_TASK_COLUMNS)
        .is("archived_at", null)
        .in("status", ["backlog", "todo", "in_progress", "waiting", "billing"]),
      supabase
        .from("tasks")
        .select(OVERVIEW_TASK_COLUMNS)
        .is("archived_at", null)
        .in("status", ["done", "cancel"])
        .or(`closed_at.gte.${recentDoneSince},done_reviewed_at.is.null`),
      supabase.from("task_sla_rules").select("priority,category_id,duration_minutes"),
      supabase.from("task_reminder_settings").select("*").maybeSingle(),
    ]);

  const firstError = [
    accountsResult.error,
    userRolesResult.error,
    agentsResult.error,
    membersResult.error,
    rotationResult.error,
    queueMemberResult.error,
    categoryResult.error,
    activeTaskResult.error,
    recentDoneResult.error,
    rulesResult.error,
    reminderResult.error,
  ].find(Boolean);
  if (firstError) throw new Error(firstError.message);

  const accounts = (accountsResult.data ?? []) as Array<{
    id: string;
    email: string;
    name: string | null;
    is_active: boolean;
    role: string;
  }>;
  const userRoles = (userRolesResult.data ?? []) as Array<{
    user_id: string;
    role_id: string;
  }>;

  // Grant của từng account, suy đúng như phiên đăng nhập (role đang hoạt động +
  // cột legacy). Thay cho bộ lọc cũ đọc permission `task.work` và TÊN role
  // "Admin"/"Super Admin" (Phase G).
  const roleIdsByUser = new Map<string, string[]>();
  for (const row of userRoles) {
    roleIdsByUser.set(row.user_id, [...(roleIdsByUser.get(row.user_id) ?? []), row.role_id]);
  }
  const roleById = new Map(
    (await loadRoleDefinitions([...new Set(userRoles.map((row) => row.role_id))])).map(
      (role) => [role.id, role]
    )
  );
  const grantsByUser = new Map(
    accounts.map((account) => [
      account.id,
      grantsForRoles(
        (roleIdsByUser.get(account.id) ?? [])
          .map((roleId) => roleById.get(roleId))
          .filter((role) => role !== undefined)
      ),
    ])
  );
  const rotationByEmail = new Map(
    ((rotationResult.data ?? []) as Array<{
      email: string;
      queue_due_at: string;
      updated_at: string;
    }>).map((row) => [
      normalizeEmail(row.email),
      { queueDueAt: row.queue_due_at, queueLastAssignedAt: row.updated_at },
    ])
  );
  const queueMemberByEmail = new Map(
    ((queueMemberResult.data ?? []) as Array<{
      email: string;
      is_enabled: boolean;
    }>).map((row) => [normalizeEmail(row.email), row.is_enabled])
  );
  const nameByEmail = new Map(
    accounts.map((account) => [
      normalizeEmail(account.email),
      account.name?.trim() || account.email,
    ])
  );
  const taskAgents = ((agentsResult.data ?? []) as Array<{ email: string }>).map((row) =>
    normalizeEmail(row.email)
  );
  const taskAgentSet = new Set(taskAgents);
  const assistantRows = ((membersResult.data ?? []) as Array<{
    agent_email: string;
    cs_email: string;
    is_assistant: boolean;
  }>)
    .filter((row) => row.is_assistant)
    .map((row) => ({
      agentEmail: normalizeEmail(row.agent_email),
      csEmail: normalizeEmail(row.cs_email),
    }));
  const assistantAgentsByEmail = new Map<string, string[]>();
  for (const row of assistantRows) {
    const current = assistantAgentsByEmail.get(row.csEmail) ?? [];
    assistantAgentsByEmail.set(row.csEmail, [...current, row.agentEmail]);
  }

  const normalizedAccounts: OverviewAccount[] = accounts.map((account) => {
    const email = normalizeEmail(account.email);
    const rotation = rotationByEmail.get(email);
    const grants = grantsByUser.get(account.id) ?? [];
    const queueMember = hasGrant(grants, "task.queue.member");
    // Nhãn "Admin": người xem mọi task mà không ở hàng đợi CS. Không bao giờ loại
    // một thành viên hàng đợi khỏi bảng workload — tập đó do grant
    // task.queue.member quyết định (cùng luật với assign_unassigned_task).
    const isAdmin = !queueMember && hasGrant(grants, "task.read", "all");
    const assistantAgents = assistantAgentsByEmail.get(email) ?? [];
    return {
      email,
      name: account.name,
      roleLabel: overviewRoleLabel({
        isAdmin,
        isAgent: taskAgentSet.has(email),
        assistantAgentEmails: assistantAgents,
        nameByEmail,
      }),
      isActive: account.is_active,
      // Nhận việc từ hàng đợi CS chung — cùng grant với assign_unassigned_task.
      canWork: queueMember,
      isAdmin,
      isAssistant: assistantAgents.length > 0,
      queueDueAt: rotation?.queueDueAt ?? null,
      queueLastAssignedAt: rotation?.queueLastAssignedAt ?? null,
      queueEnabled: queueMemberByEmail.get(email) ?? true,
    };
  });
  const categories = (categoryResult.data ?? []) as OverviewCategory[];

  const tasks = [
    ...(activeTaskResult.data ?? []),
    ...(recentDoneResult.data ?? []),
  ] as unknown as OverviewTaskInput[];
  const filteredTasks = tasks.filter((task) =>
    matchesOverviewDateWindow(task, dateRange)
  );
  const taskIds = filteredTasks.map((task) => task.id);
  const assigneeRows = (await fetchTaskAssigneeRowsForTaskIds(taskIds, supabase)) ?? [];
  const assigneesByTask = new Map<string, string[]>();
  for (const row of assigneeRows as Array<{ task_id: string; email: string }>) {
    const emails = assigneesByTask.get(row.task_id) ?? [];
    emails.push(normalizeEmail(row.email));
    assigneesByTask.set(row.task_id, [...new Set(emails)]);
  }

  const normalizedTasks = filteredTasks.map((task) => ({
    ...task,
    agent_email: task.agent_email ? normalizeEmail(task.agent_email) : null,
    assignee_email: task.assignee_email ? normalizeEmail(task.assignee_email) : null,
  }));
  const rules = (rulesResult.data ?? []) as Pick<
    TaskSlaRule,
    "priority" | "category_id" | "duration_minutes"
  >[];
  const reminderSettings = resolveReminderSettings(reminderResult.data);

  return aggregateOverview({
    now,
    accounts: normalizedAccounts,
    categories,
    taskAgents,
    tasks: normalizedTasks,
    assigneesByTask,
    rules,
    reminderSettings,
  });
}

function matchesOverviewDateWindow(
  task: OverviewTaskInput,
  dateRange: TaskOverviewDateRange
): boolean {
  const dateFrom = normalizeDateKey(dateRange.from);
  const dateTo = normalizeDateKey(dateRange.to);
  if (!dateFrom && !dateTo) return true;

  const createdDate = businessDateKey(task.created_at);
  if (dateKeyInRange(createdDate, dateFrom, dateTo)) return true;

  const isTerminal = task.status === "done" || task.status === "cancel";
  if (isTerminal) {
    return dateKeyInRange(
      businessDateKey(task.closed_at ?? task.updated_at),
      dateFrom,
      dateTo
    );
  }

  return dateFrom !== null && createdDate < dateFrom;
}

function dateKeyInRange(
  dateKey: string,
  dateFrom: string | null,
  dateTo: string | null
): boolean {
  return (!dateFrom || dateKey >= dateFrom) && (!dateTo || dateKey <= dateTo);
}

function normalizeDateKey(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}



function overviewRoleLabel({
  isAdmin,
  isAgent,
  assistantAgentEmails,
  nameByEmail,
}: {
  isAdmin: boolean;
  isAgent: boolean;
  assistantAgentEmails: string[];
  nameByEmail: Map<string, string>;
}): string {
  const labels: string[] = [];
  if (isAdmin) labels.push("Admin");
  if (isAgent) labels.push("Agent");
  for (const agentEmail of assistantAgentEmails) {
    const agentLabel = nameByEmail.get(agentEmail) ?? agentEmail;
    labels.push(`Assistant to ${agentLabel}`);
  }
  return labels.length > 0 ? labels.join(", ") : "Customer Service";
}
