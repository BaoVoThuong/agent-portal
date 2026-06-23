import { getSupabaseAdmin } from "@/lib/supabase";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export type TaskAssignee = { email: string; name: string | null };

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
