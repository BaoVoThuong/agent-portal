import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";

export type AccessRow = {
  id: string;
  is_active: boolean | null;
  agent_id: string | null;
  user_roles:
    | { roles: { id: string; is_active: boolean; role_permissions: { permission_key: string }[] } | null }[]
    | null;
};

export type UserAccess = {
  userId: string | null;
  permissions: string[];
  isActive: boolean;
  agentId: string | null;
};

/**
 * Permissions come ONLY from the account's active roles. Role names and the
 * legacy portal_account.role column are not read: until 2026-10-09 either one
 * could make someone an admin without any permission being ticked.
 */
export function flattenAccess(row: AccessRow): UserAccess {
  if (row.is_active === false) {
    return { userId: row.id, permissions: [], isActive: false, agentId: row.agent_id ?? null };
  }
  const activeRoles = (row.user_roles ?? [])
    .map((ur) => ur.roles)
    .filter((r): r is NonNullable<typeof r> => Boolean(r) && r!.is_active);
  const permissions = [
    ...new Set(activeRoles.flatMap((r) => r.role_permissions.map((p) => p.permission_key))),
  ];
  return {
    userId: row.id,
    permissions,
    isActive: true,
    agentId: row.agent_id ?? null,
  };
}

export async function getUserAccessByEmail(email: string): Promise<UserAccess> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(PORTAL_ACCOUNT_TABLE)
    .select(
      "id,is_active,agent_id,user_roles(roles(id,is_active,role_permissions(permission_key)))"
    )
    .eq("email", email)
    .maybeSingle();

  if (error || !data) {
    return { userId: null, permissions: [], isActive: false, agentId: null };
  }
  return flattenAccess(data as unknown as AccessRow);
}
