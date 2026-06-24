import { getSupabaseAdmin } from "@/lib/supabase";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export type TaskAssignee = { email: string; name: string | null };
export type TaskAgent = TaskAssignee;

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
  const { data: accounts, error } = await getSupabaseAdmin()
    .from("portal_account")
    .select("email,name,is_active,role")
    .eq("is_active", true)
    .eq("role", "agent");
  if (error) throw new Error(error.message);

  return ((accounts ?? []) as unknown as { email: string; name: string | null }[])
    .map((account) => ({ email: account.email, name: account.name }))
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}
