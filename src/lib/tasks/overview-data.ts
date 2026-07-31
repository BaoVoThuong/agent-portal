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
  "id,title,status,priority,category_id,agent_email,assignee_email,todo_started_at,in_progress_at,waiting_started_at,last_activity_at,sla_minutes,overdue_count,in_progress_seconds,waiting_seconds,closed_at,done_reviewed_at,created_at,updated_at,archived_at";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function fetchTaskOverview(now = new Date()): Promise<OverviewSnapshot> {
  const supabase = getSupabaseAdmin();
  const recentDoneSince = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();
  const [accountsResult, rolesResult, rolePermissionsResult, userRolesResult, agentsResult, membersResult, rotationResult, queueMemberResult, categoryResult, activeTaskResult, recentDoneResult, rulesResult, reminderResult] =
    await Promise.all([
      supabase
        .from("portal_account")
        .select("id,email,name,is_active,role"),
      supabase.from("roles").select("id,name,is_active"),
      supabase
        .from("role_permissions")
        .select("role_id,permission_key")
        .in("permission_key", ["task.work", "task.manage"]),
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
        .in("status", ["backlog", "todo", "in_progress", "waiting"]),
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
    rolesResult.error,
    rolePermissionsResult.error,
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
  const roles = (rolesResult.data ?? []) as Array<{
    id: string;
    name: string;
    is_active: boolean;
  }>;
  const rolePermissions = (rolePermissionsResult.data ?? []) as Array<{
    role_id: string;
    permission_key: string;
  }>;
  const userRoles = (userRolesResult.data ?? []) as Array<{
    user_id: string;
    role_id: string;
  }>;

  const activeRoleIds = new Set(
    roles.filter((role) => role.is_active).map((role) => role.id)
  );
  const workRoleIds = new Set(
    rolePermissions
      .filter(
        (row) => row.permission_key === "task.work" && activeRoleIds.has(row.role_id)
      )
      .map((row) => row.role_id)
  );
  const activeAdminRoleIds = new Set(
    roles
      .filter(
        (role) =>
          role.is_active && (role.name === "Admin" || role.name === "Super Admin")
      )
      .map((role) => role.id)
  );
  const workUserIds = new Set(
    userRoles
      .filter((row) => workRoleIds.has(row.role_id))
      .map((row) => row.user_id)
  );
  const adminUserIds = new Set(
    userRoles
      .filter((row) => activeAdminRoleIds.has(row.role_id))
      .map((row) => row.user_id)
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
    const isAdmin = account.role === "admin" || adminUserIds.has(account.id);
    return {
      email,
      name: account.name,
      roleLabel: overviewRoleLabel({
        isAdmin,
        isAgent: taskAgentSet.has(email),
        assistantAgentEmails: assistantAgentsByEmail.get(email) ?? [],
        nameByEmail,
      }),
      isActive: account.is_active,
      canWork: workUserIds.has(account.id),
      isAdmin,
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
  const taskIds = tasks.map((task) => task.id);
  const assigneeRows = (await fetchTaskAssigneeRowsForTaskIds(taskIds, supabase)) ?? [];
  const assigneesByTask = new Map<string, string[]>();
  for (const row of assigneeRows as Array<{ task_id: string; email: string }>) {
    const emails = assigneesByTask.get(row.task_id) ?? [];
    emails.push(normalizeEmail(row.email));
    assigneesByTask.set(row.task_id, [...new Set(emails)]);
  }

  const normalizedTasks = tasks.map((task) => ({
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
