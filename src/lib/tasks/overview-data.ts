import { getSupabaseAdmin } from "@/lib/supabase";
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
  "id,title,status,priority,category_id,agent_email,assignee_email,todo_started_at,in_progress_at,waiting_started_at,last_activity_at,sla_minutes,overdue_count,in_progress_seconds,waiting_seconds,closed_at,created_at,updated_at,archived_at";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function fetchTaskOverview(now = new Date()): Promise<OverviewSnapshot> {
  const supabase = getSupabaseAdmin();
  const recentDoneSince = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();
  const [accountsResult, rolesResult, rolePermissionsResult, userRolesResult, agentsResult, membersResult, categoryResult, activeTaskResult, recentDoneResult, rulesResult, reminderResult] =
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
      supabase.from("agent_members").select("cs_email,is_assistant"),
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
        .eq("status", "done")
        .gte("closed_at", recentDoneSince),
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

  const normalizedAccounts: OverviewAccount[] = accounts.map((account) => ({
    email: normalizeEmail(account.email),
    name: account.name,
    isActive: account.is_active,
    canWork: workUserIds.has(account.id),
    isAdmin: account.role === "admin" || adminUserIds.has(account.id),
  }));
  const categories = (categoryResult.data ?? []) as OverviewCategory[];

  const tasks = [
    ...(activeTaskResult.data ?? []),
    ...(recentDoneResult.data ?? []),
  ] as unknown as OverviewTaskInput[];
  const taskIds = tasks.map((task) => task.id);
  const assigneeResult =
    taskIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("task_assignees")
          .select("task_id,email")
          .in("task_id", taskIds);
  if (assigneeResult.error) throw new Error(assigneeResult.error.message);
  const assigneeRows = assigneeResult.data ?? [];
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
  const taskAgents = ((agentsResult.data ?? []) as Array<{ email: string }>).map((row) =>
    normalizeEmail(row.email)
  );
  const assistantEmails = [
    ...new Set(
      ((membersResult.data ?? []) as Array<{ cs_email: string; is_assistant: boolean }>)
        .filter((row) => row.is_assistant)
        .map((row) => normalizeEmail(row.cs_email))
    ),
  ];
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
    assistantEmails,
    tasks: normalizedTasks,
    assigneesByTask,
    rules,
    reminderSettings,
  });
}
