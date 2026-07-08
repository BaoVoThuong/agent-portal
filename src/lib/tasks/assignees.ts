import { getSupabaseAdmin } from "@/lib/supabase";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TaskAssignee = { email: string; name: string | null };
export type TaskAgent = TaskAssignee;
export type TaskAssigneeRow = { task_id: string; email: string; created_at: string };

type SupabaseErrorLike = { code?: string; message?: string };
type AttachAssigneeOptions = { currentEmail?: string | null };

// Active accounts whose role grants task.work or task.manage. Used by the
// assignee picker (manager only).
export async function fetchTaskAssignees(): Promise<TaskAssignee[]> {
  const supabase = getSupabaseAdmin();

  const { data: rp, error: rpErr } = await supabase
    .from("role_permissions")
    .select("role_id")
    .in("permission_key", [PERMISSIONS.TASK_WORK, PERMISSIONS.TASK_MANAGE]);
  if (rpErr) throw new Error(rpErr.message);

  const roleIds = [...new Set((rp ?? []).map((r) => (r as { role_id: string }).role_id))];
  if (roleIds.length === 0) return [];

  const { data: ur, error: urErr } = await supabase
    .from("user_roles")
    .select("user_id")
    .in("role_id", roleIds);
  if (urErr) throw new Error(urErr.message);

  const userIds = [...new Set((ur ?? []).map((r) => (r as { user_id: string }).user_id))];
  if (userIds.length === 0) return [];

  const { data: accounts, error: accErr } = await supabase
    .from("portal_account")
    .select("email,name,is_active")
    .in("id", userIds)
    .eq("is_active", true);
  if (accErr) throw new Error(accErr.message);

  return ((accounts ?? []) as unknown as { email: string; name: string | null }[])
    .map((a) => ({ email: a.email, name: a.name }))
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}

export async function fetchTaskAgents(): Promise<TaskAgent[]> {
  const supabase = getSupabaseAdmin();
  const { data: selected, error: selectedErr } = await supabase
    .from("task_agents")
    .select("email");
  if (selectedErr) throw new Error(selectedErr.message);

  const emails = [...new Set((selected ?? []).map((row) => (row as { email: string }).email))];
  if (emails.length === 0) return [];

  const { data: accounts, error } = await supabase
    .from("portal_account")
    .select("email,name,is_active")
    .in("email", emails)
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  return sortPeople(
    ((accounts ?? []) as unknown as { email: string; name: string | null }[])
      .map((account) => ({ email: account.email, name: account.name }))
  );
}

export async function fetchTaskAgentCandidates(): Promise<TaskAgent[]> {
  const { data: accounts, error } = await getSupabaseAdmin()
    .from("portal_account")
    .select("email,name,is_active")
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  return sortPeople(
    ((accounts ?? []) as unknown as { email: string; name: string | null }[])
      .map((account) => ({ email: account.email, name: account.name }))
  );
}

export async function fetchTaskAssigneeEmails(
  taskId: string,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<string[]> {
  const { data, error } = await supabase
    .from("task_assignees")
    .select("email,created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  if (error) {
    if (isTaskAssigneesMissingError(error)) return [];
    throw new Error(error.message);
  }

  return [
    ...new Set(
      ((data ?? []) as unknown as { email: string }[])
        .map((row) => row.email?.trim())
        .filter(Boolean)
    ),
  ];
}

export async function fetchAssignedTaskIdsForEmail(
  email: string,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<string[]> {
  const { data, error } = await supabase
    .from("task_assignees")
    .select("task_id")
    .eq("email", email);
  if (error) {
    if (isTaskAssigneesMissingError(error)) return [];
    throw new Error(error.message);
  }

  return [
    ...new Set(
      ((data ?? []) as unknown as { task_id: string }[])
        .map((row) => row.task_id)
        .filter(Boolean)
    ),
  ];
}

export async function isTaskAssignee(
  taskId: string,
  email: string,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<boolean> {
  const { data, error } = await supabase
    .from("task_assignees")
    .select("email")
    .eq("task_id", taskId)
    .eq("email", email)
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isTaskAssigneesMissingError(error)) return false;
    throw new Error(error.message);
  }

  return Boolean(data);
}

export async function attachAssigneesToTasks<
  T extends { id: string; assignee_email?: string | null },
>(
  tasks: T[],
  supabase: SupabaseClient = getSupabaseAdmin(),
  options: AttachAssigneeOptions = {}
): Promise<(T & { assignees: string[]; assignee_started_at: string | null })[]> {
  if (tasks.length === 0) return [];

  const ids = tasks.map((task) => task.id);
  const { data, error } = await supabase
    .from("task_assignees")
    .select("task_id,email,created_at")
    .in("task_id", ids)
    .order("created_at", { ascending: true });
  if (error) {
    if (isTaskAssigneesMissingError(error)) return attachLegacyAssignees(tasks);
    throw new Error(error.message);
  }

  const rowsByTask = new Map<string, TaskAssigneeRow[]>();
  for (const row of (data ?? []) as unknown as TaskAssigneeRow[]) {
    const list = rowsByTask.get(row.task_id) ?? [];
    if (!list.some((existing) => existing.email === row.email)) list.push(row);
    rowsByTask.set(row.task_id, list);
  }

  return tasks.map((task) => {
    const rows = rowsByTask.get(task.id) ?? [];
    const fromJunction = rows.map((row) => row.email);
    const legacyFallback =
      fromJunction.length === 0 && task.assignee_email ? [task.assignee_email] : [];
    const currentAssigneeRow = options.currentEmail
      ? rows.find((row) => row.email === options.currentEmail)
      : null;
    const assigneeStartedAt =
      currentAssigneeRow?.created_at ??
      rows[0]?.created_at ??
      ((task as { created_at?: string }).created_at ?? null);

    return {
      ...task,
      assignees: fromJunction.length > 0 ? fromJunction : legacyFallback,
      assignee_started_at:
        fromJunction.length > 0 || legacyFallback.length > 0 ? assigneeStartedAt : null,
    };
  });
}

function sortPeople<T extends TaskAssignee>(people: T[]): T[] {
  return [...people].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}

export function isTaskAssigneesMissingError(error: SupabaseErrorLike): boolean {
  const message = error.message ?? "";
  return (
    (error.code === "PGRST205" || message.includes("schema cache")) &&
    message.includes("task_assignees")
  );
}

function attachLegacyAssignees<T extends { assignee_email?: string | null }>(
  tasks: T[]
): (T & { assignees: string[]; assignee_started_at: string | null })[] {
  return tasks.map((task) => ({
    ...task,
    assignees: task.assignee_email ? [task.assignee_email] : [],
    assignee_started_at: task.assignee_email
      ? ((task as { created_at?: string }).created_at ?? null)
      : null,
  }));
}
