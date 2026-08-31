import { cache } from "react";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";

export type LeadAssignee = { email: string; name: string | null };

/**
 * Active accounts whose role grants lead.work or lead.manage — everyone a lead
 * may be handed to, and the only choices the assign control offers.
 *
 * Mirrors fetchTaskAssignees in src/lib/tasks/assignees.ts: role_permissions →
 * user_roles → portal_account, filtered to active accounts. The lead list is
 * simpler because it feeds a picker rather than the task board's role badges,
 * so it stops at email and name.
 */
export const fetchLeadAssignees = cache(async (): Promise<LeadAssignee[]> => {
  const supabase = getSupabaseAdmin();

  const { data: rolePermissions, error: rpError } = await supabase
    .from("role_permissions")
    .select("role_id")
    .in("permission_key", [PERMISSIONS.LEAD_WORK, PERMISSIONS.LEAD_MANAGE]);
  if (rpError) throw new Error(rpError.message);

  const roleIds = [
    ...new Set(
      (rolePermissions ?? []).map((row) => (row as { role_id: string }).role_id)
    ),
  ];
  if (roleIds.length === 0) return [];

  const { data: userRoles, error: urError } = await supabase
    .from("user_roles")
    .select("user_id")
    .in("role_id", roleIds);
  if (urError) throw new Error(urError.message);

  const userIds = [
    ...new Set(
      (userRoles ?? []).map((row) => (row as { user_id: string }).user_id)
    ),
  ];
  if (userIds.length === 0) return [];

  const { data: accounts, error: accError } = await supabase
    .from("portal_account")
    .select("email,name")
    .in("id", userIds)
    .eq("is_active", true);
  if (accError) throw new Error(accError.message);

  return ((accounts ?? []) as { email: string; name: string | null }[])
    .map((row) => ({ email: row.email.trim().toLowerCase(), name: row.name }))
    .sort((a, b) =>
      (a.name ?? a.email).localeCompare(b.name ?? b.email, undefined, {
        sensitivity: "base",
      })
    );
});
